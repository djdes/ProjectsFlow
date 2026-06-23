import { useState } from 'react';
import type { Project } from '@/domain/project/Project';
import { useContainer } from '@/infrastructure/di/container';
import { useProjectsContext } from './ProjectsProvider';

// «Дублировать» проект (оболочка без задач): создаём новый «<имя> копия» и переносим
// эмодзи-иконку. Задачи/участники/история НЕ копируются (см. план). Реализовано
// композицией существующих use-case'ов create + update — отдельного бэкенд-эндпоинта нет.
export function useDuplicateProject(): {
  submit: (source: Pick<Project, 'name' | 'icon'>) => Promise<Project>;
  saving: boolean;
  error: Error | null;
} {
  const { createProject, updateProject } = useContainer();
  const { applyAppend, applyReplace } = useProjectsContext();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const submit = async (source: Pick<Project, 'name' | 'icon'>): Promise<Project> => {
    setSaving(true);
    setError(null);
    try {
      const created = await createProject.execute(`${source.name} копия`);
      applyAppend(created);
      if (source.icon) {
        const withIcon = await updateProject.execute(created.id, { icon: source.icon });
        applyReplace(withIcon);
        return withIcon;
      }
      return created;
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
