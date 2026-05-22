import { toast } from '@/components/ui/sonner';
import { useContainer } from '@/infrastructure/di/container';
import { useProjectsContext } from './ProjectsProvider';

// Оптимистичная пересортировка проектов с откатом при ошибке. prevOrderIds — порядок до
// перетаскивания (для rollback), nextOrderIds — желаемый порядок.
export function useReorderProjects(): {
  reorder: (prevOrderIds: readonly string[], nextOrderIds: readonly string[]) => Promise<void>;
} {
  const { reorderProjects } = useContainer();
  const { applyReorder } = useProjectsContext();

  const reorder = async (
    prevOrderIds: readonly string[],
    nextOrderIds: readonly string[],
  ): Promise<void> => {
    applyReorder(nextOrderIds);
    try {
      await reorderProjects.execute(nextOrderIds);
    } catch {
      applyReorder(prevOrderIds);
      toast.error('Не удалось сохранить порядок проектов');
    }
  };

  return { reorder };
}
