import { z } from 'zod';

const emailSchema = z.string().trim().toLowerCase().email('Некорректный email').max(255);

export const requestMagicLinkSchema = z.object({
  email: emailSchema,
});

export const consumeMagicLinkSchema = z.object({
  token: z.string().trim().min(1).max(200),
});

export const updateProfileSchema = z.object({
  email: emailSchema,
  displayName: z.string().trim().min(1).max(80),
});

export type RequestMagicLinkBody = z.infer<typeof requestMagicLinkSchema>;
export type ConsumeMagicLinkBody = z.infer<typeof consumeMagicLinkSchema>;
export type UpdateProfileBody = z.infer<typeof updateProfileSchema>;
