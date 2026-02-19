import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import type { Logger } from 'pino';

import { VolumeError } from '../domain/errors.js';
import { ensureDirectory } from '../utils/fs.js';
import {
  type BlobRow,
  type SqliteVolumeDatabase,
  withVolumeDatabase,
} from './sqlite-volume.js';

export interface StoredBlobDescriptor {
  contentRef: string;
  size: number;
}

type BlobTransferPhase = 'transfer' | 'integrity';

interface BlobTransferProgress {
  bytesTransferred: number;
  totalBytes: number;
  phase: BlobTransferPhase;
}

interface BlobTransferOptions {
  totalBytes?: number;
  onProgress?: (progress: BlobTransferProgress) => Promise<void> | void;
}

const BLOB_CHUNK_SIZE = 256 * 1024;

export class BlobStore {
  public constructor(
    private readonly databasePath: string,
    private readonly logger: Logger,
  ) {}

  public async putHostFile(
    hostPath: string,
    options: BlobTransferOptions = {},
  ): Promise<StoredBlobDescriptor> {
    const temporaryContentRef = `tmp_${randomUUID()}`;
    const createdAt = new Date().toISOString();
    let size = 0;
    let chunkCount = 0;
    let contentRef = '';
    let reusedExistingBlob = false;

    await withVolumeDatabase(this.databasePath, async (database) => {
      await database.exec('BEGIN IMMEDIATE TRANSACTION');

      try {
        await this.insertBlobMetadata(database, temporaryContentRef, 0, 0, createdAt);

        const hash = createHash('sha256');

        for await (const chunk of createReadStream(hostPath, {
          highWaterMark: BLOB_CHUNK_SIZE,
        })) {
          const bufferChunk = Buffer.from(chunk);
          size += bufferChunk.byteLength;
          hash.update(bufferChunk);

          await database.run(
            `INSERT INTO blob_chunks (
               content_ref,
               chunk_index,
               content
             ) VALUES (?, ?, ?)`,
            temporaryContentRef,
            chunkCount,
            bufferChunk,
          );
          chunkCount += 1;

          if (options.onProgress) {
            await options.onProgress({
              bytesTransferred: size,
              totalBytes: options.totalBytes ?? size,
              phase: 'transfer',
            });
          }
        }

        if (options.totalBytes !== undefined && size !== options.totalBytes) {
          throw new VolumeError(
            'INTEGRITY_CHECK_FAILED',
            `Host file changed during import: expected ${options.totalBytes} bytes, read ${size}.`,
            {
              hostPath,
              expectedBytes: options.totalBytes,
              actualBytes: size,
            },
          );
        }

        contentRef = hash.digest('hex');

        const existingBlob = await this.getBlobRow(database, contentRef);
        if (existingBlob) {
          const existingIntegrity = await this.verifyBlobIntegrityInDatabase(
            database,
            existingBlob,
          );

          if (existingIntegrity.contentRef !== contentRef || existingIntegrity.size !== size) {
            await this.deleteBlobRows(database, contentRef);
            await this.promoteTemporaryBlob(
              database,
              temporaryContentRef,
              contentRef,
              size,
              chunkCount,
            );
          } else {
            await this.deleteBlobRows(database, temporaryContentRef);
            reusedExistingBlob = true;
          }
        } else {
          await this.promoteTemporaryBlob(
            database,
            temporaryContentRef,
            contentRef,
            size,
            chunkCount,
          );
        }

        await database.exec('COMMIT');
      } catch (error) {
        await database.exec('ROLLBACK').catch(() => undefined);
        throw error;
      }
    });

    try {
      await this.verifyBlobIntegrity(contentRef, {
        expectedSize: size,
        expectedContentRef: contentRef,
        onProgress: options.onProgress,
      });
    } catch (error) {
      if (!reusedExistingBlob) {
        await this.deleteBlob(contentRef).catch(() => undefined);
      }
      throw error;
    }

    this.logger.debug({ contentRef, hostPath, size, chunkCount }, 'Blob stored from host file.');
    return { contentRef, size };
  }

  public async exportBlobToHost(
    contentRef: string,
    destinationPath: string,
    options: BlobTransferOptions = {},
  ): Promise<number> {
    const destinationDirectory = path.dirname(destinationPath);
    const temporaryPath = path.join(
      destinationDirectory,
      `${path.basename(destinationPath)}.${process.pid}.${Date.now()}.tmp`,
    );

    await ensureDirectory(destinationDirectory);

    const totalBytes = await withVolumeDatabase(this.databasePath, async (database) => {
      const blobRow = await this.requireBlobRow(database, contentRef);
      const fileHandle = await fs.open(temporaryPath, 'w');
      let bytesTransferred = 0;

      try {
        await this.iterateBlobChunks(database, blobRow, async (chunk) => {
          await fileHandle.write(chunk);
          bytesTransferred += chunk.byteLength;

          if (options.onProgress) {
            await options.onProgress({
              bytesTransferred,
              totalBytes: options.totalBytes ?? blobRow.size,
              phase: 'transfer',
            });
          }
        });
      } catch (error) {
        await fileHandle.close().catch(() => undefined);
        await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
        throw error;
      }

      await fileHandle.close();

      if (bytesTransferred !== blobRow.size) {
        await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
        throw new VolumeError(
          'INTEGRITY_CHECK_FAILED',
          `Blob ${contentRef} exported ${bytesTransferred} bytes instead of ${blobRow.size}.`,
          {
            contentRef,
            expectedBytes: blobRow.size,
            actualBytes: bytesTransferred,
          },
        );
      }

      return blobRow.size;
    });

    await fs.rename(temporaryPath, destinationPath);

    try {
      await this.verifyHostFileIntegrity(destinationPath, {
        expectedContentRef: contentRef,
        expectedSize: totalBytes,
        onProgress: options.onProgress,
      });
    } catch (error) {
      await fs.rm(destinationPath, { force: true }).catch(() => undefined);
      throw error;
    }

    this.logger.debug(
      { contentRef, destinationPath, size: totalBytes },
      'Blob exported to host file.',
    );

    return totalBytes;
  }

  public async putBuffer(buffer: Buffer): Promise<StoredBlobDescriptor> {
    const contentRef = createHash('sha256').update(buffer).digest('hex');
    await this.persistBufferedBlob(contentRef, buffer);
    await this.verifyBlobIntegrity(contentRef, {
      expectedSize: buffer.byteLength,
      expectedContentRef: contentRef,
    });

    return {
      contentRef,
      size: buffer.byteLength,
    };
  }

  public async putKnownBuffer(
    contentRef: string,
    buffer: Buffer,
  ): Promise<StoredBlobDescriptor> {
    const actualContentRef = createHash('sha256').update(buffer).digest('hex');
    if (actualContentRef !== contentRef) {
      throw new VolumeError(
        'INTEGRITY_CHECK_FAILED',
        `Provided content ref ${contentRef} does not match blob payload ${actualContentRef}.`,
        {
          expectedContentRef: contentRef,
          actualContentRef,
        },
      );
    }

    await this.persistBufferedBlob(contentRef, buffer);
    await this.verifyBlobIntegrity(contentRef, {
      expectedSize: buffer.byteLength,
      expectedContentRef: contentRef,
    });

    return {
      contentRef,
      size: buffer.byteLength,
    };
  }

  public async readBuffer(contentRef: string): Promise<Buffer> {
    return withVolumeDatabase(this.databasePath, async (database) => {
      const blobRow = await this.requireBlobRow(database, contentRef);
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;

      await this.iterateBlobChunks(database, blobRow, (chunk) => {
        chunks.push(chunk);
        totalBytes += chunk.byteLength;
        return Promise.resolve();
      });

      return Buffer.concat(chunks, totalBytes);
    });
  }

  public async readPreview(contentRef: string, maxBytes: number): Promise<Buffer> {
    return withVolumeDatabase(this.databasePath, async (database) => {
      const blobRow = await this.requireBlobRow(database, contentRef);
      if (maxBytes <= 0) {
        return Buffer.alloc(0);
      }

      if (blobRow.chunk_count === 0) {
        const inlineContent = blobRow.content ?? Buffer.alloc(0);
        return inlineContent.subarray(0, maxBytes);
      }

      const chunks: Uint8Array[] = [];
      let collectedBytes = 0;

      for (let chunkIndex = 0; chunkIndex < blobRow.chunk_count; chunkIndex += 1) {
        const remainingBytes = maxBytes - collectedBytes;
        if (remainingBytes <= 0) {
          break;
        }

        const chunkRow = await database.get<{ content: Buffer }>(
          `SELECT content
             FROM blob_chunks
            WHERE content_ref = ?
              AND chunk_index = ?`,
          blobRow.content_ref,
          chunkIndex,
        );

        if (!chunkRow) {
          throw new VolumeError(
            'INTEGRITY_CHECK_FAILED',
            `Blob ${contentRef} is missing chunk ${chunkIndex}.`,
            {
              contentRef,
              chunkIndex,
            },
          );
        }

        const chunk = chunkRow.content.subarray(0, remainingBytes);
        chunks.push(chunk);
        collectedBytes += chunk.byteLength;
      }

      return Buffer.concat(chunks, collectedBytes);
    });
  }

  public async deleteBlob(contentRef: string): Promise<void> {
    await withVolumeDatabase(this.databasePath, async (database) => {
      await database.exec('BEGIN IMMEDIATE TRANSACTION');

      try {
        await this.deleteBlobRows(database, contentRef);
        await database.exec('COMMIT');
      } catch (error) {
        await database.exec('ROLLBACK').catch(() => undefined);
        throw error;
      }
    });

    this.logger.debug({ contentRef }, 'Blob deleted.');
  }

  public async verifyBlobIntegrity(
    contentRef: string,
    options: {
      expectedContentRef?: string;
      expectedSize?: number;
      onProgress?: BlobTransferOptions['onProgress'];
    } = {},
  ): Promise<StoredBlobDescriptor> {
    return withVolumeDatabase(this.databasePath, async (database) => {
      const blobRow = await this.requireBlobRow(database, contentRef);
      const verifiedBlob = await this.verifyBlobIntegrityInDatabase(database, blobRow, {
        expectedContentRef: options.expectedContentRef ?? contentRef,
        expectedSize: options.expectedSize,
        onProgress: options.onProgress,
      });

      return {
        contentRef: verifiedBlob.contentRef,
        size: verifiedBlob.size,
      };
    });
  }

  private async persistBufferedBlob(contentRef: string, buffer: Buffer): Promise<void> {
    const existingBlob = await this.getBlobMetadata(contentRef);
    if (existingBlob) {
      return;
    }

    const chunkCount = Math.ceil(buffer.byteLength / BLOB_CHUNK_SIZE);
    const createdAt = new Date().toISOString();

    await withVolumeDatabase(this.databasePath, async (database) => {
      await database.exec('BEGIN IMMEDIATE TRANSACTION');

      try {
        await this.insertBlobMetadata(
          database,
          contentRef,
          buffer.byteLength,
          chunkCount,
          createdAt,
        );

        for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
          const offset = chunkIndex * BLOB_CHUNK_SIZE;
          const chunk = buffer.subarray(offset, offset + BLOB_CHUNK_SIZE);
          await database.run(
            `INSERT INTO blob_chunks (
               content_ref,
               chunk_index,
               content
             ) VALUES (?, ?, ?)`,
            contentRef,
            chunkIndex,
            chunk,
          );
        }

        await database.exec('COMMIT');
      } catch (error) {
        await database.exec('ROLLBACK').catch(() => undefined);
        throw error;
      }
    });
  }

  private async verifyHostFileIntegrity(
    hostPath: string,
    options: {
      expectedContentRef: string;
      expectedSize: number;
      onProgress?: BlobTransferOptions['onProgress'];
    },
  ): Promise<void> {
    const hash = createHash('sha256');
    let bytesTransferred = 0;

    for await (const chunk of createReadStream(hostPath, {
      highWaterMark: BLOB_CHUNK_SIZE,
    })) {
      const bufferChunk = Buffer.from(chunk);
      bytesTransferred += bufferChunk.byteLength;
      hash.update(bufferChunk);

      if (options.onProgress) {
        await options.onProgress({
          bytesTransferred,
          totalBytes: options.expectedSize,
          phase: 'integrity',
        });
      }
    }

    const actualContentRef = hash.digest('hex');
    if (
      actualContentRef !== options.expectedContentRef ||
      bytesTransferred !== options.expectedSize
    ) {
      throw new VolumeError(
        'INTEGRITY_CHECK_FAILED',
        `Export integrity check failed for ${hostPath}.`,
        {
          hostPath,
          expectedContentRef: options.expectedContentRef,
          actualContentRef,
          expectedSize: options.expectedSize,
          actualSize: bytesTransferred,
        },
      );
    }
  }

  private async getBlobMetadata(contentRef: string): Promise<BlobRow | null> {
    return withVolumeDatabase(this.databasePath, async (database) =>
      this.getBlobRow(database, contentRef),
    );
  }

  private async getBlobRow(
    database: SqliteVolumeDatabase,
    contentRef: string,
  ): Promise<BlobRow | null> {
    const row = await database.get<BlobRow>(
      `SELECT
         content_ref,
         size,
         chunk_count,
         created_at,
         content
       FROM blobs
      WHERE content_ref = ?`,
      contentRef,
    );

    return row ?? null;
  }

  private async requireBlobRow(
    database: SqliteVolumeDatabase,
    contentRef: string,
  ): Promise<BlobRow> {
    const row = await this.getBlobRow(database, contentRef);
    if (!row) {
      throw new VolumeError('NOT_FOUND', `Blob ${contentRef} does not exist.`, {
        contentRef,
      });
    }

    return row;
  }

  private async iterateBlobChunks(
    database: SqliteVolumeDatabase,
    blobRow: BlobRow,
    onChunk: (chunk: Buffer) => Promise<void>,
  ): Promise<void> {
    if (blobRow.chunk_count === 0) {
      await onChunk(blobRow.content ?? Buffer.alloc(0));
      return;
    }

    for (let chunkIndex = 0; chunkIndex < blobRow.chunk_count; chunkIndex += 1) {
      const chunkRow = await database.get<{ content: Buffer }>(
        `SELECT content
           FROM blob_chunks
          WHERE content_ref = ?
            AND chunk_index = ?`,
        blobRow.content_ref,
        chunkIndex,
      );

      if (!chunkRow) {
        throw new VolumeError(
          'INTEGRITY_CHECK_FAILED',
          `Blob ${blobRow.content_ref} is missing chunk ${chunkIndex}.`,
          {
            contentRef: blobRow.content_ref,
            chunkIndex,
          },
        );
      }

      await onChunk(chunkRow.content);
    }
  }

  private async verifyBlobIntegrityInDatabase(
    database: SqliteVolumeDatabase,
    blobRow: BlobRow,
    options: {
      expectedContentRef?: string;
      expectedSize?: number;
      onProgress?: BlobTransferOptions['onProgress'];
    } = {},
  ): Promise<{ contentRef: string; size: number }> {
    const hash = createHash('sha256');
    let bytesTransferred = 0;

    await this.iterateBlobChunks(database, blobRow, async (chunk) => {
      bytesTransferred += chunk.byteLength;
      hash.update(chunk);

      if (options.onProgress) {
        await options.onProgress({
          bytesTransferred,
          totalBytes: options.expectedSize ?? blobRow.size,
          phase: 'integrity',
        });
      }
    });

    const actualContentRef = hash.digest('hex');
    const expectedContentRef = options.expectedContentRef ?? blobRow.content_ref;
    const expectedSize = options.expectedSize ?? blobRow.size;

    if (actualContentRef !== expectedContentRef || bytesTransferred !== expectedSize) {
      throw new VolumeError(
        'INTEGRITY_CHECK_FAILED',
        `Integrity verification failed for blob ${blobRow.content_ref}.`,
        {
          contentRef: blobRow.content_ref,
          expectedContentRef,
          actualContentRef,
          expectedSize,
          actualSize: bytesTransferred,
        },
      );
    }

    return {
      contentRef: actualContentRef,
      size: bytesTransferred,
    };
  }

  private async insertBlobMetadata(
    database: SqliteVolumeDatabase,
    contentRef: string,
    size: number,
    chunkCount: number,
    createdAt: string,
  ): Promise<void> {
    await database.run(
      `INSERT INTO blobs (
         content_ref,
         size,
         chunk_count,
         content,
         created_at
       ) VALUES (?, ?, ?, ?, ?)`,
      contentRef,
      size,
      chunkCount,
      Buffer.alloc(0),
      createdAt,
    );
  }

  private async promoteTemporaryBlob(
    database: SqliteVolumeDatabase,
    temporaryContentRef: string,
    contentRef: string,
    size: number,
    chunkCount: number,
  ): Promise<void> {
    await database.run(
      `UPDATE blobs
          SET size = ?,
              chunk_count = ?,
              content_ref = ?
        WHERE content_ref = ?`,
      size,
      chunkCount,
      contentRef,
      temporaryContentRef,
    );
    await database.run(
      `UPDATE blob_chunks
          SET content_ref = ?
        WHERE content_ref = ?`,
      contentRef,
      temporaryContentRef,
    );
  }

  private async deleteBlobRows(
    database: SqliteVolumeDatabase,
    contentRef: string,
  ): Promise<void> {
    await database.run('DELETE FROM blob_chunks WHERE content_ref = ?', contentRef);
    await database.run('DELETE FROM blobs WHERE content_ref = ?', contentRef);
  }
}
