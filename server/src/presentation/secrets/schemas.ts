import { z } from 'zod';

const keySchema = z.string().regex(/^[a-z0-9-]+\/[a-z0-9-]+\/[a-z0-9_]+$/, {
  message: 'Format: project-slug/file-slug/field_name (lowercase, digits, dashes, underscores in last segment)',
});

export const putSecretSchema = z.object({
  key: keySchema,
  value: z.string().min(1).max(10000),
});

export const secretKeyQuerySchema = z.object({
  key: keySchema,
});

export type PutSecretBody = z.infer<typeof putSecretSchema>;
