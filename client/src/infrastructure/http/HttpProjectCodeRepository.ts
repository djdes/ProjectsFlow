import type {
  ProjectCodeFile,
  ProjectCodeRepository,
  ProjectCodeTree,
  SaveProjectCodeFileInput,
  SaveProjectCodeFileResult,
} from '@/application/project-code/ProjectCodeRepository';
import { httpClient } from './httpClient';

export class HttpProjectCodeRepository implements ProjectCodeRepository {
  getTree(projectId: string): Promise<ProjectCodeTree> {
    return httpClient.get(`/projects/${encodeURIComponent(projectId)}/repository/tree`);
  }

  getFile(projectId: string, path: string): Promise<ProjectCodeFile> {
    return httpClient.get(
      `/projects/${encodeURIComponent(projectId)}/repository/file?path=${encodeURIComponent(path)}`,
    );
  }

  saveFile(projectId: string, input: SaveProjectCodeFileInput): Promise<SaveProjectCodeFileResult> {
    return httpClient.put(`/projects/${encodeURIComponent(projectId)}/repository/file`, input);
  }
}
