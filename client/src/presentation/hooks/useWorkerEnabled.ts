import { useWorkspaces } from '@/presentation/hooks/useWorkspaces';

/**
 * Включён ли AI-воркер в активном пространстве (db/152).
 *
 * Пока список пространств не загрузился — `true`: доска рисуется до ответа, и стартовать
 * с «выключено» значит мигать пропавшей колонкой «Воркер» у всех, у кого он включён.
 * Ошибка загрузки трактуется так же — прежнее поведение безопаснее внезапно урезанного.
 */
export function useWorkerEnabled(): boolean {
  const { data: workspaces } = useWorkspaces();
  const current = (workspaces ?? []).find((w) => w.isCurrent);
  return current ? current.workerEnabled : true;
}
