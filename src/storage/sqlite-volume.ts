import path from 'node:path';

import { open, type Database } from 'sqlite';
import sqlite3 from 'sqlite3';

import type { EntryKind } from '../domain/types.js';
import { VolumeError } from '../domain/errors.js';
import { ensureDirectory } from '../utils/fs.js';

export const VOLUME_DATABASE_EXTENSION = '.sqlite';
export const SUPPORTED_VOLUME_SCHEMA_VERSION = 4;

export type SqliteVolumeDatabase = Database<sqlite3.Database, sqlite3.Statement>;

export interface VolumeManifestRow {
  id: string;
  name: string;
  description: string;
  quota_bytes: number;
  logical_used_bytes: number;
  entry_count: number;
  revision: number;
  created_at: string;
  updated_at: string;
}

export interface VolumeEntryRow {
  id: string;
  kind: EntryKind;
  name: string;
  parent_id: string | null;
  created_at: string;
  updated_at: string;
  size: number | null;
  content_ref: string | null;
  imported_from_host_path: string | null;
}

export interface BlobRow {
  content_ref: string;
  reference_count: number;
  size: number;
  chunk_count: number;
  created_at: string;
  content: Buffer | null;
}

const volumeSchema = `
  CREATE TABLE IF NOT EXISTS manifest (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    quota_bytes INTEGER NOT NULL,
    logical_used_bytes INTEGER NOT NULL,
    entry_count INTEGER NOT NULL,
    revision INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS blobs (
    content_ref TEXT PRIMARY KEY,
    reference_count INTEGER NOT NULL DEFAULT 0,
    size INTEGER NOT NULL,
    chunk_count INTEGER NOT NULL DEFAULT 0,
    content BLOB NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS entries (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('directory', 'file')),
    name TEXT NOT NULL,
    parent_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    size INTEGER,
    content_ref TEXT,
    imported_from_host_path TEXT,
    CHECK (
      (parent_id IS NULL AND kind = 'directory' AND name = '/')
      OR parent_id IS NOT NULL
    ),
    CHECK (
      (kind = 'directory' AND size IS NULL AND content_ref IS NULL)
      OR (kind = 'file' AND size IS NOT NULL AND content_ref IS NOT NULL)
    ),
    FOREIGN KEY (parent_id)
      REFERENCES entries(id)
      ON DELETE CASCADE
      DEFERRABLE INITIALLY DEFERRED,
    FOREIGN KEY (content_ref)
      REFERENCES blobs(content_ref)
      ON DELETE NO ACTION
      DEFERRABLE INITIALLY DEFERRED
  );

  CREATE INDEX IF NOT EXISTS idx_entries_parent_kind_name
    ON entries (parent_id, kind, name);

  CREATE UNIQUE INDEX IF NOT EXISTS idx_entries_parent_name_unique
    ON entries (COALESCE(parent_id, '__ROOT__'), name);

  CREATE INDEX IF NOT EXISTS idx_entries_content_ref
    ON entries (content_ref);

  CREATE TABLE IF NOT EXISTS blob_chunks (
    content_ref TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    content BLOB NOT NULL,
    PRIMARY KEY (content_ref, chunk_index),
    FOREIGN KEY (content_ref)
      REFERENCES blobs(content_ref)
      ON DELETE CASCADE
      DEFERRABLE INITIALLY DEFERRED
  );

  CREATE INDEX IF NOT EXISTS idx_blob_chunks_content_ref
    ON blob_chunks (content_ref, chunk_index);
`;

const metadataSchema = `
  CREATE TABLE IF NOT EXISTS schema_metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  );
`;

const getTableColumns = async (
  database: SqliteVolumeDatabase,
  tableName: string,
): Promise<string[]> => {
  const rows = await database.all<{ name: string }[]>(
    `PRAGMA table_info(${tableName})`,
  );

  return rows.map((row) => row.name);
};

const hasColumn = async (
  database: SqliteVolumeDatabase,
  tableName: string,
  columnName: string,
): Promise<boolean> => {
  const columns = await getTableColumns(database, tableName);
  return columns.includes(columnName);
};

const hasIndex = async (
  database: SqliteVolumeDatabase,
  indexName: string,
): Promise<boolean> => {
  const row = await database.get<{ name: string }>(
    `SELECT name
       FROM sqlite_master
      WHERE type = 'index'
        AND name = ?`,
    indexName,
  );

  return row !== undefined;
};

const getSchemaVersion = async (database: SqliteVolumeDatabase): Promise<number> => {
  const metadataTables = await database.all<{ name: string }[]>(
    `SELECT name
       FROM sqlite_master
      WHERE type = 'table'
        AND name IN ('schema_metadata', 'schema_migrations')`,
  );

  if (metadataTables.length === 0) {
    return 0;
  }

  const row = await database.get<{ value: string }>(
    `SELECT value
       FROM schema_metadata
      WHERE key = 'schema_version'`,
  );
  if (!row) {
    return 0;
  }

  const parsedVersion = Number.parseInt(row.value, 10);
  return Number.isNaN(parsedVersion) ? 0 : parsedVersion;
};

const recordSchemaMigration = async (
  database: SqliteVolumeDatabase,
  version: number,
  name: string,
): Promise<void> => {
  await database.run(
    `INSERT OR IGNORE INTO schema_migrations (
       version,
       name,
       applied_at
     ) VALUES (?, ?, ?)`,
    version,
    name,
    new Date().toISOString(),
  );
};

const migrateBlobSchema = async (database: SqliteVolumeDatabase): Promise<void> => {
  if (!(await hasColumn(database, 'blobs', 'chunk_count'))) {
    await database.exec(
      'ALTER TABLE blobs ADD COLUMN chunk_count INTEGER NOT NULL DEFAULT 0',
    );
  }
};

const migrateBlobReferenceCountSchema = async (
  database: SqliteVolumeDatabase,
): Promise<void> => {
  if (!(await hasColumn(database, 'blobs', 'reference_count'))) {
    await database.exec(
      'ALTER TABLE blobs ADD COLUMN reference_count INTEGER NOT NULL DEFAULT 0',
    );
  }

  await database.exec(`
    UPDATE blobs
       SET reference_count = COALESCE(
         (
           SELECT COUNT(*)
             FROM entries
            WHERE entries.content_ref = blobs.content_ref
         ),
         0
       )
  `);
};

const migrateManifestRevisionSchema = async (
  database: SqliteVolumeDatabase,
): Promise<void> => {
  if (!(await hasColumn(database, 'manifest', 'revision'))) {
    await database.exec(
      'ALTER TABLE manifest ADD COLUMN revision INTEGER NOT NULL DEFAULT 0',
    );
  }
};

const validateEntriesForRelationalMigration = async (
  database: SqliteVolumeDatabase,
): Promise<void> => {
  const duplicateSiblings = await database.all<
    { parent_key: string; name: string; count: number }[]
  >(
    `SELECT COALESCE(parent_id, '__ROOT__') AS parent_key,
            name,
            COUNT(*) AS count
       FROM entries
      GROUP BY COALESCE(parent_id, '__ROOT__'), name
     HAVING COUNT(*) > 1`,
  );

  if (duplicateSiblings.length > 0) {
    throw new VolumeError(
      'INVALID_OPERATION',
      'Cannot apply relational constraints because duplicate sibling names exist.',
      {
        duplicates: duplicateSiblings.slice(0, 10),
      },
    );
  }

  const invalidRoots = await database.all<{ id: string; kind: string; name: string }[]>(
    `SELECT id, kind, name
       FROM entries
      WHERE parent_id IS NULL
        AND (kind <> 'directory' OR name <> '/')`,
  );

  if (invalidRoots.length > 0) {
    throw new VolumeError(
      'INVALID_OPERATION',
      'Cannot apply relational constraints because invalid root entries exist.',
      {
        entries: invalidRoots.slice(0, 10),
      },
    );
  }

  const invalidPayloadEntries = await database.all<
    { id: string; kind: string; size: number | null; content_ref: string | null }[]
  >(
    `SELECT id, kind, size, content_ref
       FROM entries
      WHERE (kind = 'directory' AND (size IS NOT NULL OR content_ref IS NOT NULL))
         OR (kind = 'file' AND (size IS NULL OR content_ref IS NULL))`,
  );

  if (invalidPayloadEntries.length > 0) {
    throw new VolumeError(
      'INVALID_OPERATION',
      'Cannot apply relational constraints because some entries have invalid payload metadata.',
      {
        entries: invalidPayloadEntries.slice(0, 10),
      },
    );
  }
};

const recreateBlobChunksTableWithForeignKey = async (
  database: SqliteVolumeDatabase,
): Promise<void> => {
  await database.exec(`
    CREATE TABLE blob_chunks_next (
      content_ref TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      content BLOB NOT NULL,
      PRIMARY KEY (content_ref, chunk_index),
      FOREIGN KEY (content_ref)
        REFERENCES blobs(content_ref)
        ON DELETE CASCADE
        DEFERRABLE INITIALLY DEFERRED
    )
  `);
  await database.exec(`
    INSERT INTO blob_chunks_next (
      content_ref,
      chunk_index,
      content
    )
    SELECT
      content_ref,
      chunk_index,
      content
    FROM blob_chunks
  `);
  await database.exec('DROP TABLE blob_chunks');
  await database.exec('ALTER TABLE blob_chunks_next RENAME TO blob_chunks');
  await database.exec(
    `CREATE INDEX IF NOT EXISTS idx_blob_chunks_content_ref
       ON blob_chunks (content_ref, chunk_index)`,
  );
};

const recreateEntriesTableWithConstraints = async (
  database: SqliteVolumeDatabase,
): Promise<void> => {
  await database.exec(`
    CREATE TABLE entries_next (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('directory', 'file')),
      name TEXT NOT NULL,
      parent_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      size INTEGER,
      content_ref TEXT,
      imported_from_host_path TEXT,
      CHECK (
        (parent_id IS NULL AND kind = 'directory' AND name = '/')
        OR parent_id IS NOT NULL
      ),
      CHECK (
        (kind = 'directory' AND size IS NULL AND content_ref IS NULL)
        OR (kind = 'file' AND size IS NOT NULL AND content_ref IS NOT NULL)
      ),
      FOREIGN KEY (parent_id)
        REFERENCES entries(id)
        ON DELETE CASCADE
        DEFERRABLE INITIALLY DEFERRED,
      FOREIGN KEY (content_ref)
        REFERENCES blobs(content_ref)
        ON DELETE NO ACTION
        DEFERRABLE INITIALLY DEFERRED
    )
  `);
  await database.exec(`
    INSERT INTO entries_next (
      id,
      kind,
      name,
      parent_id,
      created_at,
      updated_at,
      size,
      content_ref,
      imported_from_host_path
    )
    SELECT
      id,
      kind,
      name,
      parent_id,
      created_at,
      updated_at,
      size,
      content_ref,
      imported_from_host_path
    FROM entries
  `);
  await database.exec('DROP TABLE entries');
  await database.exec('ALTER TABLE entries_next RENAME TO entries');
  await database.exec(
    `CREATE INDEX IF NOT EXISTS idx_entries_parent_kind_name
       ON entries (parent_id, kind, name)`,
  );
  await database.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_entries_parent_name_unique
       ON entries (COALESCE(parent_id, '__ROOT__'), name)`,
  );
  await database.exec(
    `CREATE INDEX IF NOT EXISTS idx_entries_content_ref
       ON entries (content_ref)`,
  );
};

const migrateRelationalConstraintSchema = async (
  database: SqliteVolumeDatabase,
): Promise<void> => {
  const entryForeignKeys = await database.all<
    { table: string; from: string }[]
  >('PRAGMA foreign_key_list(entries)');
  const blobChunkForeignKeys = await database.all<
    { table: string; from: string }[]
  >('PRAGMA foreign_key_list(blob_chunks)');
  const hasSiblingUniqueIndex = await hasIndex(
    database,
    'idx_entries_parent_name_unique',
  );
  const hasEntryParentForeignKey = entryForeignKeys.some(
    (row) => row.table === 'entries' && row.from === 'parent_id',
  );
  const hasEntryBlobForeignKey = entryForeignKeys.some(
    (row) => row.table === 'blobs' && row.from === 'content_ref',
  );
  const hasBlobChunkForeignKey = blobChunkForeignKeys.some(
    (row) => row.table === 'blobs' && row.from === 'content_ref',
  );

  if (
    hasSiblingUniqueIndex &&
    hasEntryParentForeignKey &&
    hasEntryBlobForeignKey &&
    hasBlobChunkForeignKey
  ) {
    return;
  }

  await validateEntriesForRelationalMigration(database);
  await recreateBlobChunksTableWithForeignKey(database);
  await recreateEntriesTableWithConstraints(database);
};

const applySchemaMigrations = async (
  database: SqliteVolumeDatabase,
): Promise<void> => {
  await database.exec('BEGIN IMMEDIATE TRANSACTION');

  try {
    await database.exec(metadataSchema);
    await database.exec(volumeSchema);

    const currentVersion = await getSchemaVersion(database);

    if (currentVersion > SUPPORTED_VOLUME_SCHEMA_VERSION) {
      throw new VolumeError(
        'INVALID_OPERATION',
        `Database schema version ${currentVersion} is newer than the supported runtime schema ${SUPPORTED_VOLUME_SCHEMA_VERSION}.`,
        {
          currentSchemaVersion: currentVersion,
          supportedSchemaVersion: SUPPORTED_VOLUME_SCHEMA_VERSION,
        },
      );
    }

    if (currentVersion < 1) {
      await recordSchemaMigration(database, 1, 'bootstrap-volume-schema');
    }

    if (currentVersion < 2) {
      await migrateBlobSchema(database);
      await migrateManifestRevisionSchema(database);
      await recordSchemaMigration(database, 2, 'manifest-revision-and-blob-metadata');
    }

    if (currentVersion < 3) {
      await migrateRelationalConstraintSchema(database);
      await recordSchemaMigration(database, 3, 'relational-storage-constraints');
    }

    if (currentVersion < 4) {
      await migrateBlobReferenceCountSchema(database);
      await recordSchemaMigration(database, 4, 'blob-reference-counts');
    }

    await database.run(
      `INSERT INTO schema_metadata (key, value)
       VALUES ('schema_version', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      String(SUPPORTED_VOLUME_SCHEMA_VERSION),
    );

    await database.exec('COMMIT');
  } catch (error) {
    await database.exec('ROLLBACK').catch(() => undefined);
    throw error;
  }
};

export const getVolumeDatabasePath = (dataDir: string, volumeId: string): string =>
  path.join(dataDir, 'volumes', `${volumeId}${VOLUME_DATABASE_EXTENSION}`);

export const withVolumeDatabase = async <T>(
  databasePath: string,
  callback: (database: SqliteVolumeDatabase) => Promise<T>,
): Promise<T> => {
  await ensureDirectory(path.dirname(databasePath));

  const database = await open({
    filename: databasePath,
    driver: sqlite3.Database,
  });

  try {
    database.configure('busyTimeout', 5000);
    await database.exec('PRAGMA foreign_keys = ON;');
    await database.exec('PRAGMA journal_mode = WAL;');
    await database.exec('PRAGMA synchronous = FULL;');
    await database.exec('PRAGMA temp_store = MEMORY;');
    await applySchemaMigrations(database);

    return await callback(database);
  } finally {
    await database.close();
  }
};
