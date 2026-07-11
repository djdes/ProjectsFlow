import type { BoardView, BoardViewType } from '@/domain/project/BoardView';
import type { BoardViewRepository } from '@/application/project/BoardViewRepository';
import { httpClient } from './httpClient';

type BoardViewDto = {
  id: string;
  projectId: string;
  name: string;
  type: BoardViewType;
  sortOrder: number;
  createdAt: string;
};

function fromDto(dto: BoardViewDto): BoardView {
  return {
    id: dto.id,
    projectId: dto.projectId,
    name: dto.name,
    type: dto.type,
    sortOrder: dto.sortOrder,
    createdAt: new Date(dto.createdAt),
  };
}

export class HttpBoardViewRepository implements BoardViewRepository {
  async list(projectId: string): Promise<BoardView[]> {
    const res = await httpClient.get<{ views: BoardViewDto[] }>(`/projects/${projectId}/views`);
    return res.views.map(fromDto);
  }

  async create(projectId: string, name: string, type: BoardViewType): Promise<BoardView> {
    const res = await httpClient.post<{ view: BoardViewDto }>(`/projects/${projectId}/views`, {
      name,
      type,
    });
    return fromDto(res.view);
  }

  async update(
    projectId: string,
    viewId: string,
    patch: { name?: string; type?: BoardViewType },
  ): Promise<BoardView> {
    const res = await httpClient.patch<{ view: BoardViewDto }>(
      `/projects/${projectId}/views/${viewId}`,
      patch,
    );
    return fromDto(res.view);
  }

  async duplicate(projectId: string, viewId: string): Promise<BoardView> {
    const res = await httpClient.post<{ view: BoardViewDto }>(
      `/projects/${projectId}/views/${viewId}/duplicate`,
      {},
    );
    return fromDto(res.view);
  }

  async remove(projectId: string, viewId: string): Promise<void> {
    await httpClient.delete<void>(`/projects/${projectId}/views/${viewId}`);
  }
}
