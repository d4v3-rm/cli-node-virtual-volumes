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

export class BlobStore {
  public constructor(
    private readonly volumeDirectory: string,
    private readonly logger: Logger,
  ) {}

  public async putHostFile(hostPath: string): Promise<StoredBlobDescriptor> {
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

  private getBlobPath(contentRef: string): string {
    return path.join(
      this.volumeDirectory,
      'blobs',
      contentRef.slice(0, 2),
      contentRef.slice(2),
    );
  }
}
