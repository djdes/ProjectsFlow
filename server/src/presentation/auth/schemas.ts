import { z } from 'zod';

const emailSchema = z.string().trim().toLowerCase().email('Некорректный email').max(255);

export const registerSchema = z.object({
  email: emailSchema,
  displayName: z.string().trim().min(1, 'Введите имя').max(80),
  password: z.string().min(8, 'Пароль минимум 8 символов').max(200),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
});

export const updateProfileSchema = z.object({
  email: emailSchema,
  displayName: z.string().trim().min(1).max(80),
});

export type RegisterBody = z.infer<typeof registerSchema>;
export type LoginBody = z.infer<typeof loginSchema>;
export type UpdateProfileBody = z.infer<typeof updateProfileSchema>;
