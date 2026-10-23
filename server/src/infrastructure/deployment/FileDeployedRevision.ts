import { readFile } from 'node:fs/promises';
import type { DeployedRevision } from '../../application/deployment/DeploymentStatusRepository.js';

export class FileDeployedRevision implements DeployedRevision {
  constructor(private readonly file: string | URL) {}
  async read(): Promise<string | null> {
    try {
      const value = JSON.parse(await readFile(this.file, 'utf8')) as { revision?: unknown };
      return typeof value.revision === 'string' && /^[a-f0-9]{40}$/i.test(value.revision) ? value.revision : null;
    } catch { return null; }
  }
}
