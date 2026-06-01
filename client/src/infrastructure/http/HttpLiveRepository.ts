import type { LiveRepository } from '@/application/live/LiveRepository';
import type { LiveSession } from '@/domain/live/LiveSession';
import type { LiveEvent } from '@/domain/live/LiveEvent';
import type { LiveFileDiff } from '@/domain/live/LiveFileDiff';
import { httpClient } from './httpClient';

// Wire-DTO: даты — ISO-строки (как в HttpTaskRepository). Поля nullable graceful.
type LiveSessionDto = Omit<LiveSession, 'startedAt' | 'endedAt'> & {
  startedAt: string;
  endedAt: string | null;
};

type LiveEventDto = Omit<LiveEvent, 'createdAt'> & {
  createdAt: string;
};

type LiveFileDiffDto = LiveFileDiff;

function sessionFromDto(dto: LiveSessionDto): LiveSession {
  return {
    ...dto,
    startedAt: new Date(dto.startedAt),
    endedAt: dto.endedAt ? new Date(dto.endedAt) : null,
  };
}

function eventFromDto(dto: LiveEventDto): LiveEvent {
  return { ...dto, createdAt: new Date(dto.createdAt) };
}

export class HttpLiveRepository implements LiveRepository {
  async listSessions(projectId: string, taskId: string): Promise<LiveSession[]> {
    const { sessions } = await httpClient.get<{ sessions: LiveSessionDto[] }>(
      `/projects/${projectId}/tasks/${taskId}/live/sessions`,
    );
    return sessions.map(sessionFromDto);
  }

  async listEvents(
    projectId: string,
    taskId: string,
    sessionId: string,
    afterSeq?: number,
    limit?: number,
  ): Promise<LiveEvent[]> {
    const qs = new URLSearchParams();
    if (afterSeq !== undefined) qs.set('afterSeq', String(afterSeq));
    if (limit !== undefined) qs.set('limit', String(limit));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    const { events } = await httpClient.get<{ events: LiveEventDto[] }>(
      `/projects/${projectId}/tasks/${taskId}/live/sessions/${sessionId}/events${suffix}`,
    );
    return events.map(eventFromDto);
  }

  async listFileDiffs(
    projectId: string,
    taskId: string,
    sessionId: string,
  ): Promise<LiveFileDiff[]> {
    const { files } = await httpClient.get<{ files: LiveFileDiffDto[] }>(
      `/projects/${projectId}/tasks/${taskId}/live/sessions/${sessionId}/file-diffs`,
    );
    return files;
  }
}
