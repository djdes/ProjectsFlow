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
  healthUrl: z.string().max(500).nullish(),
  enabled: z.boolean().optional(),
  collectIntervalSeconds: z.number().int().min(30).max(86400).optional(),
});

export const historyQuerySchema = z.object({
  since: z.string().datetime().optional(),
  until: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(2000).default(500),
});

export const logKindSchema = z.enum(['pm2_out', 'pm2_err', 'nginx_access', 'nginx_error']);

// Пороги алертов (PUT /alert-rules).
export const alertRulesSchema = z.object({
  rules: z
    .array(
      z.object({
        ruleKind: z.enum([
          'process_down',
          'disk_usage',
          'restart_spike',
          'snapshot_stale',
          'http_down',
          'ssl_expiry',
        ]),
        enabled: z.boolean(),
        threshold: z.number().nullable(),
        severity: z.enum(['info', 'warning', 'critical']),
      }),
    )
    .max(20),
});

// «Тихий час» (POST /servers/:id/mute). minutes=null снимает заглушку. ≤ 7 дней.
export const muteSchema = z.object({
  minutes: z.number().int().min(0).max(10080).nullable(),
});

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
    cpuUsedPct: z.number().nullable().optional(),
    memTotalBytes: z.number().nullable(),
    memUsedBytes: z.number().nullable(),
    memUsedPct: z.number().nullable(),
    swapTotalBytes: z.number().nullable().optional(),
    swapUsedBytes: z.number().nullable().optional(),
    swapUsedPct: z.number().nullable().optional(),
    netRxBytes: z.number().nullable().optional(),
    netTxBytes: z.number().nullable().optional(),
    processCount: z.number().nullable().optional(),
    openFds: z.number().nullable().optional(),
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
      .object({
        pm2: z.array(pm2ProcSchema).max(200),
        system: systemSchema,
        http: z
          .object({
            url: z.string().max(500),
            ok: z.boolean(),
            statusCode: z.number().nullable(),
            latencyMs: z.number().nullable(),
            error: z.string().max(300).nullable().optional(),
          })
          .strict()
          .nullable()
          .optional(),
        ssl: z
          .object({
            host: z.string().max(255),
            daysLeft: z.number().nullable(),
            expiresAt: z.string().max(40).nullable(),
            error: z.string().max(300).nullable().optional(),
          })
          .strict()
          .nullable()
          .optional(),
      })
      .strict()
      .nullable()
      .optional(),
    logs: logTailsSchema.optional(),
    dbHealth: z
      .object({
        reachable: z.boolean(),
        connections: z.number().nullable(),
        sizeBytes: z.number().nullable(),
        maxConnections: z.number().nullable().optional(),
        uptimeSeconds: z.number().nullable().optional(),
        slowQueries: z.number().nullable().optional(),
        version: z.string().max(100).nullable().optional(),
      })
      .strict()
      .nullable()
      .optional(),
    errors: z.array(z.string().max(500)).max(50).optional(),
  })
  .strict();
