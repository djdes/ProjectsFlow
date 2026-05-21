import type { AgentJobRepository } from '../../application/agentJob/AgentJobRepository';
import type { AgentJob } from '../../domain/agentJob/AgentJob';

export class HttpAgentJobRepository implements AgentJobRepository {
  async enqueue(projectId: string, taskId: string): Promise<AgentJob> {
    const res = await fetch(`/api/projects/${projectId}/tasks/${taskId}/agent`, {
      method: 'POST',
      credentials: 'include',
    });
    if (!res.ok) throw await asError(res);
    const body = (await res.json()) as { job: AgentJob };
    return body.job;
  }

  async cancel(projectId: string, jobId: string, reason?: string): Promise<void> {
    const res = await fetch(`/api/projects/${projectId}/agent-jobs/${jobId}`, {
      method: 'DELETE',
      credentials: 'include',
      headers: reason ? { 'Content-Type': 'application/json' } : undefined,
      body: reason ? JSON.stringify({ reason }) : undefined,
    });
    if (!res.ok) throw await asError(res);
  }
}

async function asError(res: Response): Promise<Error> {
  try {
    const body = (await res.json()) as { error?: string; message?: string };
    return new Error(body.message ?? body.error ?? `HTTP ${res.status}`);
  } catch {
    return new Error(`HTTP ${res.status}`);
  }
}
