import path from 'node:path';

import { open, type Database } from 'sqlite';
import sqlite3 from 'sqlite3';

import type { EntryKind } from '../domain/types.js';
import { ensureDirectory } from '../utils/fs.js';

export const VOLUME_DATABASE_EXTENSION = '.sqlite';

export type SqliteVolumeDatabase = Database<sqlite3.Database, sqlite3.Statement>;

export interface VolumeManifestRow {
  id: string;
  name: string;
  description: string;
  quota_bytes: number;
  logical_used_bytes: number;
  entry_count: number;
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
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
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
    imported_from_host_path TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_entries_parent_kind_name
    ON entries (parent_id, kind, name);

  CREATE INDEX IF NOT EXISTS idx_entries_content_ref
    ON entries (content_ref);

  CREATE TABLE IF NOT EXISTS blobs (
    content_ref TEXT PRIMARY KEY,
    size INTEGER NOT NULL,
    chunk_count INTEGER NOT NULL DEFAULT 0,
    content BLOB NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS blob_chunks (
    content_ref TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    content BLOB NOT NULL,
    PRIMARY KEY (content_ref, chunk_index)
  );

  CREATE INDEX IF NOT EXISTS idx_blob_chunks_content_ref
    ON blob_chunks (content_ref, chunk_index);
`;

const migrateBlobSchema = async (database: SqliteVolumeDatabase): Promise<void> => {
  const blobColumns = await database.all<{ name: string }[]>(
    'PRAGMA table_info(blobs)',
  );
  const hasChunkCount = blobColumns.some((column) => column.name === 'chunk_count');

  if (!hasChunkCount) {
    await database.exec(
      'ALTER TABLE blobs ADD COLUMN chunk_count INTEGER NOT NULL DEFAULT 0',
    );
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
    await database.exec('PRAGMA journal_mode = DELETE;');
    await database.exec('PRAGMA synchronous = NORMAL;');
    await database.exec('PRAGMA temp_store = MEMORY;');
    await database.exec(volumeSchema);
    await migrateBlobSchema(database);

    return await callback(database);
  } finally {
    await database.close();
  }
};
