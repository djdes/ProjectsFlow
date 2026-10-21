export type ImageGeneration = { id: string; prompt: string; status: 'queued'|'running'|'succeeded'|'failed'; error: string | null; createdAt: string; imageUrl: string | null };
