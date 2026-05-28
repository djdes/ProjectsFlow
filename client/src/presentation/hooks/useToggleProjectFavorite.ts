import { toast } from '@/components/ui/sonner';
import { useContainer } from '@/infrastructure/di/container';
import { useProjectsContext } from './ProjectsProvider';

// Оптимистичный toggle favorite с откатом по ошибке. Прокидываем новое значение —
// удобнее, чем читать текущее в хуке (компонент уже знает project.isFavorite).
export function useToggleProjectFavorite(): {
  toggle: (projectId: string, favorite: boolean) => Promise<void>;
} {
  const { toggleProjectFavorite } = useContainer();
  const { applyToggleFavorite } = useProjectsContext();

  const toggle = async (projectId: string, favorite: boolean): Promise<void> => {
    applyToggleFavorite(projectId, favorite);
    try {
      await toggleProjectFavorite.execute(projectId, favorite);
    } catch {
      applyToggleFavorite(projectId, !favorite);
      toast.error(
        favorite
          ? 'Не удалось добавить в избранное'
          : 'Не удалось убрать из избранного',
      );
    }
  };

  return { toggle };
}
