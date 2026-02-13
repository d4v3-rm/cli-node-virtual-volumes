import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import type { Logger } from 'pino';

import { ensureDirectory, pathExists } from '../utils/fs.js';

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

export class BlobStore {
  public constructor(
    private readonly volumeDirectory: string,
    private readonly logger: Logger,
  ) {}

  public async putHostFile(
    hostPath: string,
    options: BlobTransferOptions = {},
  ): Promise<StoredBlobDescriptor> {
    const temporaryDirectory = path.join(this.volumeDirectory, 'tmp');
    await ensureDirectory(temporaryDirectory);

    const temporaryPath = path.join(
      temporaryDirectory,
      `blob-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`,
    );

    const hash = createHash('sha256');
    let size = 0;

    const meteredTransform = new Transform({
      transform(chunk, _encoding, callback) {
        const bufferChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += bufferChunk.byteLength;
        hash.update(bufferChunk);
        if (options.onProgress) {
          void options.onProgress({
            bytesTransferred: size,
            totalBytes: options.totalBytes ?? size,
          });
        }
        callback(null, bufferChunk);
      },
    });

    await pipeline(
      createReadStream(hostPath),
      meteredTransform,
      createWriteStream(temporaryPath),
    );

    const contentRef = hash.digest('hex');
    const finalPath = this.getBlobPath(contentRef);

    await ensureDirectory(path.dirname(finalPath));

    if (await pathExists(finalPath)) {
      await fs.unlink(temporaryPath);
    } else {
      await fs.rename(temporaryPath, finalPath);
    }

    this.logger.debug({ contentRef, hostPath, size }, 'Blob stored from host file.');

    return { contentRef, size };
  }

  public async exportBlobToHost(
    contentRef: string,
    destinationPath: string,
    options: BlobTransferOptions = {},
  ): Promise<number> {
    const blobPath = this.getBlobPath(contentRef);
    const totalBytes =
      options.totalBytes ?? (await fs.stat(blobPath)).size;
    const destinationDirectory = path.dirname(destinationPath);
    const temporaryPath = path.join(
      destinationDirectory,
      `${path.basename(destinationPath)}.${process.pid}.${Date.now()}.tmp`,
    );
    let bytesTransferred = 0;

    await ensureDirectory(destinationDirectory);

    const meteredTransform = new Transform({
      transform(chunk, _encoding, callback) {
        const bufferChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytesTransferred += bufferChunk.byteLength;
        if (options.onProgress) {
          void options.onProgress({
            bytesTransferred,
            totalBytes,
          });
        }
        callback(null, bufferChunk);
      },
    });

    try {
      await pipeline(
        createReadStream(blobPath),
        meteredTransform,
        createWriteStream(temporaryPath),
      );
      await fs.rename(temporaryPath, destinationPath);
    } catch (error) {
      await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
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
    const finalPath = this.getBlobPath(contentRef);

    await ensureDirectory(path.dirname(finalPath));

    if (!(await pathExists(finalPath))) {
      await fs.writeFile(finalPath, buffer);
    }

    return {
      contentRef,
      size: buffer.byteLength,
    };
  }

  public async readBuffer(contentRef: string): Promise<Buffer> {
    return fs.readFile(this.getBlobPath(contentRef));
  }

  public async readPreview(
    contentRef: string,
    maxBytes: number,
  ): Promise<Buffer> {
    const fileHandle = await fs.open(this.getBlobPath(contentRef), 'r');
    const buffer = Buffer.alloc(maxBytes);

    try {
      const { bytesRead } = await fileHandle.read(buffer, 0, maxBytes, 0);
      return buffer.subarray(0, bytesRead);
    } finally {
      await fileHandle.close();
    }
  }

  public async deleteBlob(contentRef: string): Promise<void> {
    const blobPath = this.getBlobPath(contentRef);
    await fs.rm(blobPath, { force: true });
    await this.pruneEmptyBlobDirectories(path.dirname(blobPath));
    this.logger.debug({ contentRef }, 'Blob deleted.');
  }

  private getBlobPath(contentRef: string): string {
    return path.join(
      this.volumeDirectory,
      'blobs',
      contentRef.slice(0, 2),
      contentRef.slice(2),
    );
  }

  private async pruneEmptyBlobDirectories(directoryPath: string): Promise<void> {
    const blobsRoot = path.join(this.volumeDirectory, 'blobs');
    let currentDirectory = directoryPath;

    while (currentDirectory.startsWith(blobsRoot) && currentDirectory !== blobsRoot) {
      const entries = await fs.readdir(currentDirectory).catch(() => null);
      if (entries === null || entries.length > 0) {
        return;
      }

      await fs.rmdir(currentDirectory).catch(() => undefined);
      currentDirectory = path.dirname(currentDirectory);
    }
  }
}
