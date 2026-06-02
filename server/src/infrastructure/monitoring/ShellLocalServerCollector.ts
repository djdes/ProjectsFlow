import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { promises as fs } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import * as os from 'node:os';
import type {
  LocalCollectResult,
  LocalServerCollector,
} from '../../application/monitoring/LocalServerCollector.js';
import type { ProjectServer } from '../../domain/monitoring/ProjectServer.js';
import type {
  DiskUsage,
  LogTail,
  LogTails,
  Pm2ProcessSnapshot,
  SnapshotMetrics,
  SystemSnapshot,
} from '../../domain/monitoring/ServerSnapshot.js';
import { redactSecrets } from '../../domain/monitoring/redactSecrets.js';

const execFileAsync = promisify(execFile);

const PM2_BIN = process.env['PM2_BIN'] ?? 'pm2';
const CMD_TIMEOUT_MS = Number(process.env['MONITOR_CMD_TIMEOUT_MS'] ?? 5000);
const CMD_MAX_BUFFER = 4 * 1024 * 1024;
const TAIL_BYTES = Number(process.env['MONITOR_TAIL_BYTES'] ?? 16384);
const TAIL_LINES = Number(process.env['MONITOR_TAIL_LINES'] ?? 200);
const ALLOWED_LOG_ROOTS = (process.env['MONITOR_LOG_ALLOWED_ROOTS'] ?? '/var/log,/var/www')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const PSEUDO_FS = new Set(['tmpfs', 'devtmpfs', 'udev', 'overlay', 'squashfs', 'shm', 'none']);

// Сбор метрик локального хоста. Безопасно: execFile (argv-only, без shell), таймауты,
// allowlist путей логов, мягкая деградация при недоступных источниках.
export class ShellLocalServerCollector implements LocalServerCollector {
  async collect(server: ProjectServer): Promise<LocalCollectResult> {
    const errors: string[] = [];

    const pm2 = await this.collectPm2(server, errors);
    const system = await this.collectSystem(errors);
    const logs = await this.collectLogs(server, pm2.rawByName, errors);

    const metrics: SnapshotMetrics = { pm2: pm2.processes, system };
    return { reachable: true, metrics, logs, errors };
  }

  private async collectPm2(
    server: ProjectServer,
    errors: string[],
  ): Promise<{ processes: Pm2ProcessSnapshot[]; rawByName: Map<string, Pm2Raw> }> {
    const rawByName = new Map<string, Pm2Raw>();
    try {
      const { stdout } = await execFileAsync(PM2_BIN, ['jlist'], {
        timeout: CMD_TIMEOUT_MS,
        maxBuffer: CMD_MAX_BUFFER,
      });
      const parsed = JSON.parse(stdout) as unknown;
      if (!Array.isArray(parsed)) return { processes: [], rawByName };
      const filter = server.pm2ProcessNames;
      const processes: Pm2ProcessSnapshot[] = [];
      for (const entry of parsed) {
        const e = entry as Pm2Raw;
        const name = typeof e?.name === 'string' ? e.name : 'unknown';
        if (filter && filter.length > 0 && !filter.includes(name)) continue;
        rawByName.set(name, e);
        const env = e.pm2_env ?? {};
        const monit = e.monit ?? {};
        const uptimeMs =
          typeof env.pm_uptime === 'number' && env.status === 'online'
            ? Math.max(0, Date.now() - env.pm_uptime)
            : null;
        processes.push({
          name,
          pid: typeof e.pid === 'number' ? e.pid : null,
          status: typeof env.status === 'string' ? env.status : 'unknown',
          uptimeMs,
          restarts: typeof env.restart_time === 'number' ? env.restart_time : null,
          cpuPct: typeof monit.cpu === 'number' ? monit.cpu : null,
          memoryBytes: typeof monit.memory === 'number' ? monit.memory : null,
        });
      }
      return { processes, rawByName };
    } catch (err) {
      errors.push(`pm2: ${errMsg(err)}`);
      return { processes: [], rawByName };
    }
  }

  private async collectSystem(errors: string[]): Promise<SystemSnapshot> {
    const load = os.loadavg();
    const total = os.totalmem();
    const free = os.freemem();
    const used = total - free;
    const disks = await this.collectDisks(errors);
    const extra = await this.collectProcMetrics();
    return {
      load1: round2(load[0] ?? 0),
      load5: round2(load[1] ?? 0),
      load15: round2(load[2] ?? 0),
      cpuCount: os.cpus().length,
      memTotalBytes: total,
      memUsedBytes: used,
      memUsedPct: total > 0 ? round2((used / total) * 100) : null,
      uptimeSeconds: Math.floor(os.uptime()),
      disks,
      ...extra,
    };
  }

  // Доп. метрики из /proc (Linux): swap, CPU%, сеть, процессы, FD. Всё best-effort.
  private async collectProcMetrics(): Promise<Partial<SystemSnapshot>> {
    if (process.platform === 'win32') return {};
    const out: {
      cpuUsedPct?: number | null;
      swapTotalBytes?: number | null;
      swapUsedBytes?: number | null;
      swapUsedPct?: number | null;
      netRxBytes?: number | null;
      netTxBytes?: number | null;
      processCount?: number | null;
      openFds?: number | null;
    } = {};

    try {
      const mem = await fs.readFile('/proc/meminfo', 'utf8');
      const kb = (key: string): number | null => {
        const m = mem.match(new RegExp(`^${key}:\\s+(\\d+)`, 'm'));
        return m ? Number(m[1]) * 1024 : null;
      };
      const st = kb('SwapTotal');
      const sf = kb('SwapFree');
      if (st !== null) {
        out.swapTotalBytes = st;
        if (sf !== null) {
          out.swapUsedBytes = st - sf;
          out.swapUsedPct = st > 0 ? round2(((st - sf) / st) * 100) : 0;
        }
      }
    } catch {
      /* нет /proc/meminfo — пропускаем */
    }

    try {
      out.cpuUsedPct = await this.cpuUsedPct();
    } catch {
      /* skip */
    }

    try {
      const dev = await fs.readFile('/proc/net/dev', 'utf8');
      let rx = 0;
      let tx = 0;
      for (const line of dev.split('\n')) {
        const m = line.match(/^\s*([\w-]+):\s*(.+)$/);
        if (!m || m[1] === 'lo') continue;
        const cols = m[2]!.trim().split(/\s+/).map(Number);
        rx += cols[0] ?? 0;
        tx += cols[8] ?? 0;
      }
      out.netRxBytes = rx;
      out.netTxBytes = tx;
    } catch {
      /* skip */
    }

    try {
      const entries = await fs.readdir('/proc');
      out.processCount = entries.filter((e) => /^\d+$/.test(e)).length;
    } catch {
      /* skip */
    }

    try {
      const fnr = await fs.readFile('/proc/sys/fs/file-nr', 'utf8');
      const n = Number(fnr.trim().split(/\s+/)[0]);
      if (Number.isFinite(n)) out.openFds = n;
    } catch {
      /* skip */
    }

    return out;
  }

  // Мгновенная загрузка CPU всей машины (%) по двум семплам /proc/stat с паузой 100мс.
  private async cpuUsedPct(): Promise<number | null> {
    const sample = async (): Promise<{ idle: number; total: number }> => {
      const stat = await fs.readFile('/proc/stat', 'utf8');
      const first = stat.split('\n')[0] ?? '';
      const parts = first.trim().split(/\s+/).slice(1).map(Number);
      const idle = (parts[3] ?? 0) + (parts[4] ?? 0); // idle + iowait
      const total = parts.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
      return { idle, total };
    };
    const a = await sample();
    await new Promise((r) => setTimeout(r, 100));
    const b = await sample();
    const dt = b.total - a.total;
    const di = b.idle - a.idle;
    if (dt <= 0) return null;
    return round2((1 - di / dt) * 100);
  }

  private async collectDisks(errors: string[]): Promise<DiskUsage[]> {
    if (process.platform === 'win32') return [];
    try {
      const { stdout } = await execFileAsync('df', ['-Pk'], {
        timeout: CMD_TIMEOUT_MS,
        maxBuffer: CMD_MAX_BUFFER,
      });
      const lines = stdout.trim().split('\n').slice(1);
      const disks: DiskUsage[] = [];
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 6) continue;
        const fsName = parts[0] ?? '';
        const blocks = Number(parts[1]);
        const usedKb = Number(parts[2]);
        const availKb = Number(parts[3]);
        const mount = parts.slice(5).join(' ');
        if (PSEUDO_FS.has(fsName)) continue;
        if (/^\/(dev|sys|proc|run)(\/|$)/.test(mount)) continue;
        if (!Number.isFinite(blocks) || blocks <= 0) continue;
        disks.push({
          mount,
          totalBytes: blocks * 1024,
          usedBytes: usedKb * 1024,
          availableBytes: availKb * 1024,
          usedPct: round2((usedKb / blocks) * 100),
        });
      }
      return disks;
    } catch (err) {
      errors.push(`df: ${errMsg(err)}`);
      return [];
    }
  }

  private async collectLogs(
    server: ProjectServer,
    rawByName: Map<string, Pm2Raw>,
    errors: string[],
  ): Promise<LogTails> {
    // Пути pm2-логов берём из самого pm2 (pm_out_log_path/pm_err_log_path первого
    // совпавшего процесса) — это реальные файлы, без догадок.
    let pm2OutPath: string | null = null;
    let pm2ErrPath: string | null = null;
    const first = rawByName.values().next().value as Pm2Raw | undefined;
    if (first?.pm2_env) {
      pm2OutPath = first.pm2_env.pm_out_log_path ?? null;
      pm2ErrPath = first.pm2_env.pm_err_log_path ?? null;
    }
    pm2OutPath = process.env['MONITOR_PM2_OUT_LOG'] ?? pm2OutPath;
    pm2ErrPath = process.env['MONITOR_PM2_ERR_LOG'] ?? pm2ErrPath;

    return {
      pm2Out: await this.tail(pm2OutPath, errors),
      pm2Err: await this.tail(pm2ErrPath, errors),
      nginxAccess: await this.tail(server.nginxAccessLogPath, errors),
      nginxError: await this.tail(server.nginxErrorLogPath, errors),
    };
  }

  private async tail(path: string | null | undefined, errors: string[]): Promise<LogTail | null> {
    if (!path) return { available: false, reason: 'no_path' };
    if (!this.isAllowed(path)) return { available: false, reason: 'forbidden' };
    try {
      const stat = await fs.stat(path);
      if (!stat.isFile()) return { available: false, reason: 'not_found' };
      const size = stat.size;
      if (size === 0) return { available: false, reason: 'empty' };
      const start = Math.max(0, size - TAIL_BYTES);
      const fh = await fs.open(path, 'r');
      try {
        const len = size - start;
        const buf = Buffer.alloc(len);
        await fh.read(buf, 0, len, start);
        let text = buf.toString('utf8');
        const allLines = text.split('\n');
        text = allLines.slice(-TAIL_LINES).join('\n');
        return { available: true, lines: redactSecrets(text), bytes: len };
      } finally {
        await fh.close();
      }
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'ENOENT') return { available: false, reason: 'not_found' };
      if (code === 'EACCES' || code === 'EPERM') return { available: false, reason: 'forbidden' };
      errors.push(`log ${path}: ${errMsg(err)}`);
      return { available: false, reason: 'error' };
    }
  }

  private isAllowed(path: string): boolean {
    if (!path.startsWith('/') || path.includes('..')) return false;
    const norm = resolvePath(path);
    return ALLOWED_LOG_ROOTS.some((root) => norm === root || norm.startsWith(`${root}/`));
  }
}

type Pm2Raw = {
  name?: string;
  pid?: number;
  pm2_env?: {
    status?: string;
    pm_uptime?: number;
    restart_time?: number;
    pm_out_log_path?: string;
    pm_err_log_path?: string;
  };
  monit?: { cpu?: number; memory?: number };
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
