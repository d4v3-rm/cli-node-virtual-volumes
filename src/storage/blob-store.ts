import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import type { Logger } from 'pino';

import { VolumeError } from '../domain/errors.js';
import { ensureDirectory } from '../utils/fs.js';
import { withVolumeDatabase } from './sqlite-volume.js';

export interface StoredBlobDescriptor {
  contentRef: string;
  size: number;
}

interface BlobTransferProgress {
  bytesTransferred: number;
  totalBytes: number;
}

interface BlobTransferOptions {
  totalBytes?: number;
  onProgress?: (progress: BlobTransferProgress) => Promise<void> | void;
}

const EXPORT_CHUNK_SIZE = 64 * 1024;

export class BlobStore {
  public constructor(
    private readonly databasePath: string,
    private readonly logger: Logger,
  ) {}

  public async putHostFile(
    hostPath: string,
    options: BlobTransferOptions = {},
  ): Promise<StoredBlobDescriptor> {
    const hash = createHash('sha256');
    const chunks: Uint8Array[] = [];
    let size = 0;

    for await (const chunk of createReadStream(hostPath)) {
      const bufferChunk = Buffer.from(chunk);
      chunks.push(bufferChunk);
      size += bufferChunk.byteLength;
      hash.update(bufferChunk);

      if (options.onProgress) {
        await options.onProgress({
          bytesTransferred: size,
          totalBytes: options.totalBytes ?? size,
        });
      }
    }

    const contentRef = hash.digest('hex');
    const buffer = Buffer.concat(chunks, size);
    await this.persistBlob(contentRef, buffer);

    this.logger.debug({ contentRef, hostPath, size }, 'Blob stored from host file.');
    return { contentRef, size };
  }

  public async exportBlobToHost(
    contentRef: string,
    destinationPath: string,
    options: BlobTransferOptions = {},
  ): Promise<number> {
    const buffer = await this.readBuffer(contentRef);
    const totalBytes = options.totalBytes ?? buffer.byteLength;
    const destinationDirectory = path.dirname(destinationPath);
    const temporaryPath = path.join(
      destinationDirectory,
      `${path.basename(destinationPath)}.${process.pid}.${Date.now()}.tmp`,
    );

    await ensureDirectory(destinationDirectory);

    const fileHandle = await fs.open(temporaryPath, 'w');
    let bytesTransferred = 0;

    try {
      while (bytesTransferred < buffer.byteLength) {
        const nextOffset = Math.min(
          bytesTransferred + EXPORT_CHUNK_SIZE,
          buffer.byteLength,
        );
        const nextChunk = buffer.subarray(bytesTransferred, nextOffset);
        await fileHandle.write(nextChunk);
        bytesTransferred += nextChunk.byteLength;

        if (options.onProgress) {
          await options.onProgress({
            bytesTransferred,
            totalBytes,
          });
        }
      }
    } catch (error) {
      await fileHandle.close().catch(() => undefined);
      await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }

    await fileHandle.close();
    await fs.rename(temporaryPath, destinationPath);

    this.logger.debug(
      { contentRef, destinationPath, size: totalBytes },
      'Blob exported to host file.',
    );

    return totalBytes;
  }

  public async putBuffer(buffer: Buffer): Promise<StoredBlobDescriptor> {
    const contentRef = createHash('sha256').update(buffer).digest('hex');
    await this.persistBlob(contentRef, buffer);

    return {
      contentRef,
      size: buffer.byteLength,
    };
  }

  public async putKnownBuffer(
    contentRef: string,
    buffer: Buffer,
  ): Promise<StoredBlobDescriptor> {
    await this.persistBlob(contentRef, buffer);

    return {
      contentRef,
      size: buffer.byteLength,
    };
  }

  public async readBuffer(contentRef: string): Promise<Buffer> {
    return withVolumeDatabase(this.databasePath, async (database) => {
      const row = await database.get<{ content: Buffer }>(
        'SELECT content FROM blobs WHERE content_ref = ?',
        contentRef,
      );

      if (!row) {
        throw new VolumeError('NOT_FOUND', `Blob ${contentRef} does not exist.`, {
          contentRef,
        });
      }

      return row.content;
    });
  }

  public async readPreview(contentRef: string, maxBytes: number): Promise<Buffer> {
    return withVolumeDatabase(this.databasePath, async (database) => {
      const row = await database.get<{ preview: Buffer }>(
        'SELECT substr(content, 1, ?) AS preview FROM blobs WHERE content_ref = ?',
        maxBytes,
        contentRef,
      );

      if (!row) {
        throw new VolumeError('NOT_FOUND', `Blob ${contentRef} does not exist.`, {
          contentRef,
        });
      }

      return row.preview;
    });
  }

  public async deleteBlob(contentRef: string): Promise<void> {
    await withVolumeDatabase(this.databasePath, async (database) => {
      await database.run('DELETE FROM blobs WHERE content_ref = ?', contentRef);
    });
    this.logger.debug({ contentRef }, 'Blob deleted.');
  }

  private async persistBlob(contentRef: string, buffer: Buffer): Promise<void> {
    await withVolumeDatabase(this.databasePath, async (database) => {
      await database.run(
        `INSERT OR IGNORE INTO blobs (
           content_ref,
           size,
           content,
           created_at
         ) VALUES (?, ?, ?, ?)`,
        contentRef,
        buffer.byteLength,
        buffer,
        new Date().toISOString(),
      );
    });
  }
}
