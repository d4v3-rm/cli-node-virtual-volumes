import fs from 'node:fs/promises';
import path from 'node:path';

export const ensureDirectory = async (directoryPath: string): Promise<void> => {
  await fs.mkdir(directoryPath, { recursive: true });
};

export const pathExists = async (targetPath: string): Promise<boolean> => {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
};

export const readJsonFile = async <T>(filePath: string): Promise<T> => {
  const content = await fs.readFile(filePath, 'utf8');
  return JSON.parse(content) as T;
};

export const writeJsonAtomic = async (
  filePath: string,
  payload: unknown,
): Promise<void> => {
  await ensureDirectory(path.dirname(filePath));

  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporaryPath, JSON.stringify(payload, null, 2), 'utf8');
  await fs.rename(temporaryPath, filePath);
};
