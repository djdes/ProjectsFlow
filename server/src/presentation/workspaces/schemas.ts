import { z } from 'zod';

export const createWorkspaceSchema = z.object({
  name: z.string().min(1),
  icon: z.string().max(16).nullable().optional(),
});

export const updateWorkspaceSchema = z.object({
  name: z.string().min(1).optional(),
  icon: z.string().max(16).nullable().optional(),
});

export const setCurrentSchema = z.object({
  workspaceId: z.string().min(1),
});

export const addMemberSchema = z.object({
  email: z.string().email(),
  role: z.enum(['owner', 'editor', 'viewer']).optional(),
});

export const changeRoleSchema = z.object({
  role: z.enum(['owner', 'editor', 'viewer']),
});

export const moveProjectSchema = z.object({
  targetWorkspaceId: z.string().min(1),
});
