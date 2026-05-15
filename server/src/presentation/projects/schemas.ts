import { z } from 'zod';

export const createProjectSchema = z.object({
  name: z.string().trim().min(1, 'Введите название').max(80),
});

// Мягкая валидация URL: пытаемся распарсить как URL.
// Поддерживаем http(s) и git+ssh-форму (parse() это принимает с протоколом).
const urlOrNullSchema = z
  .string()
  .trim()
  .max(500)
  .refine(
    (s) => {
      if (s.length === 0) return false;
      try {
        new URL(s);
        return true;
      } catch {
        return false;
      }
    },
    { message: 'Введите корректный URL' },
  )
  .nullable();

export const updateProjectSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    gitRepoUrl: urlOrNullSchema.optional(),
  })
  .refine((obj) => Object.keys(obj).length > 0, { message: 'Нечего обновлять' });

export type CreateProjectBody = z.infer<typeof createProjectSchema>;
export type UpdateProjectBody = z.infer<typeof updateProjectSchema>;
