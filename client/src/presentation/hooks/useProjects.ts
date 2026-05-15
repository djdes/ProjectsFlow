import type { Project } from '@/domain/project/Project';
import { useProjectsContext } from './ProjectsProvider';

export function useProjects(): {
  data: Project[] | null;
  loading: boolean;
  error: Error | null;
} {
  const { data, loading, error } = useProjectsContext();
  return { data, loading, error };
}
