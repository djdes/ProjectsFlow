import { z } from 'zod';

export const cancelAgentJobBodySchema = z.object({
  reason: z.string().trim().max(500).optional(),
});
export type CancelAgentJobBody = z.infer<typeof cancelAgentJobBodySchema>;
