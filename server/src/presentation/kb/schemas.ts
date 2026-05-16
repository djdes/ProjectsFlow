import { z } from 'zod';

export const fullNameSchema = z.string().regex(/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/, {
  message: 'Format: owner/repo',
});

export const connectKbSchema = z.object({
  fullName: fullNameSchema,
});

export const pathSchema = z.string().regex(/^[a-z0-9_./-]+\.md$/i, {
  message: 'Path must be lowercase, end with .md',
});

export const writeDocSchema = z.object({
  path: pathSchema,
  frontmatter: z.record(z.unknown()),
  body: z.string().max(500_000),
  sha: z.string().nullable(),
});

export const bulkCredentialSchema = z.object({
  rawText: z.string().min(1).max(20_000),
  fileSlugOverride: z.string().trim().min(1).max(80).nullable().optional(),
  // optional: client-side preview позволяет переопределить эвристику секрет/не-секрет
  secretOverrides: z.record(z.boolean()).nullable().optional(),
});

export type ConnectKbBody = z.infer<typeof connectKbSchema>;
export type WriteDocBody = z.infer<typeof writeDocSchema>;
export type BulkCredentialBody = z.infer<typeof bulkCredentialSchema>;
