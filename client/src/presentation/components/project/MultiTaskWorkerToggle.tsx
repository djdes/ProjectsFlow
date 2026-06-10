import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/sonner';
import { useContainer } from '@/infrastructure/di/container';

type Props = {
  projectId: string;
  initialEnabled: boolean;
};

// Переключатель «Мультизадачный воркер» в шапке доски. Когда включён — Ralph-диспетчер
// может выполнять до 3 задач этого проекта одновременно (а не строго одну за раз).
// Менять может любой участник проекта (сервер гейтит viewer+). Оптимистично переключаем
// состояние, при ошибке откатываем. Двухстрочный лейбл: заголовок + подпись «до 3 задач».
export function MultiTaskWorkerToggle({ projectId, initialEnabled }: Props): React.ReactElement {
  const { projectRepository } = useContainer();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [saving, setSaving] = useState(false);

  // Синхронизируемся при смене проекта / перезагрузке данных доски.
  useEffect(() => {
    setEnabled(initialEnabled);
  }, [initialEnabled]);

  const toggle = async (next: boolean): Promise<void> => {
    if (saving) return;
    setSaving(true);
    setEnabled(next); // оптимистично
    try {
      const updated = await projectRepository.setMultiTaskWorker(projectId, next);
      setEnabled(updated.multiTaskWorker);
      toast.success(
        updated.multiTaskWorker
          ? 'Мультизадачный воркер включён — до 3 задач параллельно'
          : 'Мультизадачный воркер выключен',
      );
    } catch (err) {
      setEnabled(!next); // откат
      toast.error((err as Error).message ?? 'Не удалось сохранить');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-center gap-2 rounded-md px-2 py-1 transition-colors hover:bg-accent">
      <Switch
        checked={enabled}
        onCheckedChange={toggle}
        disabled={saving}
        aria-label="Мультизадачный воркер"
      />
      <div className="leading-tight">
        <div className="text-xs font-medium">Мультизадачный воркер</div>
        <div className="text-[10px] text-muted-foreground">до&nbsp;3&nbsp;задач</div>
      </div>
      {saving && <Loader2 className="size-3 animate-spin text-muted-foreground" />}
    </div>
  );
}
