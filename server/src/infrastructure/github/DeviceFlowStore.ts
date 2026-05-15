type Entry = {
  deviceCode: string;
  intervalMs: number;
  expiresAt: Date;
};

/**
 * In-memory store для pending device flow'ов. Ключ — userId.
 * Однопроцессный (в multi-instance окружении переехать на Redis).
 */
export class DeviceFlowStore {
  private readonly map = new Map<string, Entry>();

  store(userId: string, deviceCode: string, intervalSec: number, expiresAt: Date): void {
    this.map.set(userId, { deviceCode, intervalMs: intervalSec * 1000, expiresAt });
  }

  get(userId: string): Entry | null {
    return this.map.get(userId) ?? null;
  }

  setInterval(userId: string, newIntervalMs: number): void {
    const entry = this.map.get(userId);
    if (entry) entry.intervalMs = newIntervalMs;
  }

  clear(userId: string): void {
    this.map.delete(userId);
  }
}
