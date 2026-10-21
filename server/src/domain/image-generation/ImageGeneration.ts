export type ImageGeneration = {
  id: string; userId: string; dispatcherUserId: string; prompt: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  claimToken: string | null; storageKey: string | null; errorMessage: string | null;
  createdAt: Date; startedAt: Date | null; finishedAt: Date | null;
};
export class ImageGenerationError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}
