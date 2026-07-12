import type {
  TaskProperty,
  TaskPropertyOption,
  TaskPropertyType,
  TaskPropertyValue,
} from '@/domain/task/TaskProperty';
import type { TaskPropertyRepository } from '@/application/task/TaskPropertyRepository';
import { httpClient } from './httpClient';

type PropertyDto = {
  id: string;
  projectId: string;
  name: string;
  type: TaskPropertyType;
  options: TaskPropertyOption[];
  position: number;
};

export class HttpTaskPropertyRepository implements TaskPropertyRepository {
  async list(
    projectId: string,
  ): Promise<{ properties: TaskProperty[]; values: TaskPropertyValue[] }> {
    return httpClient.get<{ properties: PropertyDto[]; values: TaskPropertyValue[] }>(
      `/projects/${projectId}/properties`,
    );
  }

  async create(
    projectId: string,
    input: { name: string; type: TaskPropertyType; options?: TaskPropertyOption[] },
  ): Promise<TaskProperty> {
    const res = await httpClient.post<{ property: PropertyDto }>(
      `/projects/${projectId}/properties`,
      input,
    );
    return res.property;
  }

  async update(
    projectId: string,
    propertyId: string,
    patch: { name?: string; options?: TaskPropertyOption[] },
  ): Promise<TaskProperty> {
    const res = await httpClient.patch<{ property: PropertyDto }>(
      `/projects/${projectId}/properties/${propertyId}`,
      patch,
    );
    return res.property;
  }

  async remove(projectId: string, propertyId: string): Promise<void> {
    await httpClient.delete<void>(`/projects/${projectId}/properties/${propertyId}`);
  }

  async setValue(
    projectId: string,
    taskId: string,
    propertyId: string,
    value: string,
  ): Promise<void> {
    await httpClient.put<void>(
      `/projects/${projectId}/tasks/${taskId}/properties/${propertyId}`,
      { value },
    );
  }
}
