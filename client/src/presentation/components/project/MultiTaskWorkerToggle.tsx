import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/sonner';
import { useContainer } from '@/infrastructure/di/container';

type Props = {
  projectId: string;
  initialEnabled: boolean;
};

// Переключатель «Мультизадачный воркер» в диалоге «Автоматизация». Когда включён —
// Ralph-диспетчер может выполнять до 3 задач этого проекта одновременно (а не строго
// одну за раз). Менять может любой участник проекта (сервер гейтит viewer+).
// Оптимистично переключаем состояние, при ошибке откатываем. PATCH идёт сразу,
// отдельной кнопки «Сохранить» не требует.
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

  // Та же разметка, что у SwitchRow автоматизации — выглядит родной строкой диалога.
  return (
    <div className="flex items-center justify-between rounded-md border px-3 py-2.5">
      <div className="pr-3">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium">Мультизадачный воркер</span>
          {saving && <Loader2 className="size-3 animate-spin text-muted-foreground" />}
        </div>
        <p className="text-xs text-muted-foreground">
          Диспетчер ведёт до 3 задач проекта параллельно.
        </p>
      </div>
      <Switch
        checked={enabled}
        onCheckedChange={toggle}
        disabled={saving}
        aria-label="Мультизадачный воркер"
      />
    </div>
  );
}
