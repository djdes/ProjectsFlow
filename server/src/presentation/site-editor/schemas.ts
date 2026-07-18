import { z } from 'zod';

const stableAttributesSchema = z.record(z.string().max(64), z.string().max(200))
  .refine((value) => Object.keys(value).length <= 20, 'too many attributes');

export const locatorSchema = z.object({
  cssPath: z.string().min(1).max(1000),
  tagName: z.string().min(1).max(64),
  stableAttributes: stableAttributesSchema.default({}),
  textFingerprint: z.string().max(512).optional(),
  ancestorFingerprint: z.string().max(512).optional(),
}).strict();

export const patchKindSchema = z.enum(['text', 'style', 'attribute', 'visibility', 'command']);

export const createPatchSchema = z.object({
  route: z.string().min(1).max(500),
  baseRevision: z.number().int().min(0).max(2_147_483_647),
  idempotencyKey: z.string().min(8).max(100).regex(/^[A-Za-z0-9._:-]+$/),
  patch: z.object({
    locator: locatorSchema,
    kind: patchKindSchema,
    payload: z.record(z.string(), z.unknown()),
  }).strict(),
}).strict();

export const updatePatchSchema = z.object({
  baseRevision: z.number().int().min(0).max(2_147_483_647),
  patch: z.object({
    locator: locatorSchema.optional(),
    kind: patchKindSchema.optional(),
    payload: z.record(z.string(), z.unknown()).optional(),
  }).strict().refine((value) => Object.keys(value).length > 0, 'empty patch'),
}).strict();

export const deletePatchSchema = z.object({
  baseRevision: z.number().int().min(0).max(2_147_483_647),
}).strict();

export const createJobSchema = z.object({
  route: z.string().min(1).max(500),
  locator: locatorSchema,
  domSnapshot: z.string().max(50_000),
  computedStyles: z.record(z.string().max(64), z.string().max(500))
    .refine((value) => Object.keys(value).length <= 50, 'too many computed styles'),
  prompt: z.string().min(1).max(4000),
  operation: z.enum([
    'rewrite_text',
    'restyle',
    'regenerate_element',
    'regenerate_section',
    'replace_icon',
    'edit_code',
  ]),
  artifactVersion: z.string().min(1).max(128),
}).strict();

export const claimJobSchema = z.object({
  artifactVersion: z.string().min(1).max(128),
}).strict();

export const completeJobSchema = z.object({
  artifactVersion: z.string().min(1).max(128),
  status: z.enum(['succeeded', 'failed']),
  result: z.record(z.string(), z.unknown()).optional().nullable(),
  error: z.string().max(500).optional().nullable(),
}).strict().superRefine((value, ctx) => {
  if (value.status === 'failed' && !value.error) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['error'], message: 'error required for failed job' });
  }
});
