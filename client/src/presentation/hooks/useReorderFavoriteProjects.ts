import { toast } from '@/components/ui/sonner';
import { useContainer } from '@/infrastructure/di/container';
import { useProjectsContext } from './ProjectsProvider';

// Симметрия useReorderProjects, но для секции «Избранное». prevOrderIds — порядок до
// перетаскивания (для rollback), nextOrderIds — желаемый порядок. Оба массива содержат
// только id favorites.
export function useReorderFavoriteProjects(): {
  reorder: (prevOrderIds: readonly string[], nextOrderIds: readonly string[]) => Promise<void>;
} {
  const { reorderFavoriteProjects } = useContainer();
  const { applyReorderFavorites } = useProjectsContext();

  const reorder = async (
    prevOrderIds: readonly string[],
    nextOrderIds: readonly string[],
  ): Promise<void> => {
    applyReorderFavorites(nextOrderIds);
    try {
      await reorderFavoriteProjects.execute(nextOrderIds);
    } catch {
      applyReorderFavorites(prevOrderIds);
      toast.error('Не удалось сохранить порядок избранного');
    }
  };

  return { reorder };
}
