import { z } from 'zod';

export const createAgentTokenSchema = z.object({
  name: z.string().trim().min(1, 'Введите название').max(120),
});

export type CreateAgentTokenBody = z.infer<typeof createAgentTokenSchema>;
