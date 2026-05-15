import { useState } from 'react';
import type { Project } from '@/domain/project/Project';
import { useContainer } from '@/infrastructure/di/container';
import { useProjectsContext } from './ProjectsProvider';

export function useCreateProject(): {
  submit: (name: string) => Promise<Project>;
  saving: boolean;
  error: Error | null;
} {
  const { createProject } = useContainer();
  const { applyAppend } = useProjectsContext();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const submit = async (name: string): Promise<Project> => {
    setSaving(true);
    setError(null);
    try {
      const project = await createProject.execute(name);
      applyAppend(project);
      return project;
    } catch (e) {
      const err = e as Error;
      setError(err);
      throw err;
    } finally {
      setSaving(false);
    }
  };

  return { submit, saving, error };
}
