import { z } from 'zod';

// --- session API: конфиг сервера ---
export const serverConfigSchema = z.object({
  name: z.string().min(1).max(120),
  kind: z.enum(['local', 'remote']),
  host: z.string().max(255).nullish(),
  sshPort: z.number().int().min(1).max(65535).optional(),
  sshUser: z.string().max(120).nullish(),
  sshCredentialRef: z.string().max(500).nullish(),
  pm2ProcessNames: z.array(z.string().max(120)).max(50).nullish(),
  nginxAccessLogPath: z.string().max(500).nullish(),
  nginxErrorLogPath: z.string().max(500).nullish(),
  deployPath: z.string().max(500).nullish(),
  enabled: z.boolean().optional(),
  collectIntervalSeconds: z.number().int().min(30).max(86400).optional(),
});

export const historyQuerySchema = z.object({
  since: z.string().datetime().optional(),
  until: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(2000).default(500),
});

export const logKindSchema = z.enum(['pm2_out', 'pm2_err', 'nginx_access', 'nginx_error']);

// query-маппинг → ключ LogTails.
export const LOG_KIND_TO_KEY = {
  pm2_out: 'pm2Out',
  pm2_err: 'pm2Err',
  nginx_access: 'nginxAccess',
  nginx_error: 'nginxError',
} as const;

// --- agent ingest: строгая схема пушимого снимка ---
const pm2ProcSchema = z
  .object({
    name: z.string().max(120),
    pid: z.number().int().nullable(),
    status: z.string().max(40),
    uptimeMs: z.number().nullable(),
    restarts: z.number().nullable(),
    cpuPct: z.number().nullable(),
    memoryBytes: z.number().nullable(),
  })
  .strict();

const diskSchema = z
  .object({
    mount: z.string().max(255),
    totalBytes: z.number(),
    usedBytes: z.number(),
    availableBytes: z.number(),
    usedPct: z.number(),
  })
  .strict();

const systemSchema = z
  .object({
    load1: z.number().nullable(),
    load5: z.number().nullable(),
    load15: z.number().nullable(),
    cpuCount: z.number().int().nullable(),
    memTotalBytes: z.number().nullable(),
    memUsedBytes: z.number().nullable(),
    memUsedPct: z.number().nullable(),
    uptimeSeconds: z.number().nullable(),
    disks: z.array(diskSchema).max(50),
  })
  .strict()
  .nullable();

const logTailSchema = z
  .object({
    available: z.boolean(),
    reason: z.string().max(32).optional(),
    lines: z.string().max(64 * 1024).optional(),
    bytes: z.number().optional(),
  })
  .strict()
  .nullable();

const logTailsSchema = z
  .object({
    pm2Out: logTailSchema,
    pm2Err: logTailSchema,
    nginxAccess: logTailSchema,
    nginxError: logTailSchema,
  })
  .strict()
  .nullable();

export const ingestSnapshotSchema = z
  .object({
    serverName: z.string().min(1).max(120),
    collectedAt: z.string().datetime(),
    reachable: z.boolean(),
    metrics: z
      .object({ pm2: z.array(pm2ProcSchema).max(200), system: systemSchema })
      .strict()
      .nullable()
      .optional(),
    logs: logTailsSchema.optional(),
    dbHealth: z
      .object({
        reachable: z.boolean(),
        connections: z.number().nullable(),
        sizeBytes: z.number().nullable(),
      })
      .strict()
      .nullable()
      .optional(),
    errors: z.array(z.string().max(500)).max(50).optional(),
  })
  .strict();
