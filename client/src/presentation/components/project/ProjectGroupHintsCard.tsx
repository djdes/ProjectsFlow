import { useEffect, useState } from 'react';
import { Loader2, MessagesSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import type { Project } from '@/domain/project/Project';
import { useContainer } from '@/infrastructure/di/container';
import { isGroupHintsDirty, parseAliasInput } from './projectGroupHints';

type Props = {
  readonly project: Project;
  readonly onProjectUpdated: (project: Project) => void;
};

// Как бот узнаёт проект в сообщении рабочей Telegram-группы (db/192): привычные названия
// («конфиг», «планер») и короткое описание для ИИ-выбора. Правят владелец/руководитель.
export function ProjectGroupHintsCard({ project, onProjectUpdated }: Props): React.ReactElement {
  const { projectRepository } = useContainer();
  const [aliases, setAliases] = useState(project.aliases.join(', '));
  const [description, setDescription] = useState(project.shortDescription ?? '');
  const [fullRun, setFullRun] = useState(project.groupFullRunDefault);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setAliases(project.aliases.join(', '));
    setDescription(project.shortDescription ?? '');
    setFullRun(project.groupFullRunDefault);
  }, [project.id, project.aliases, project.shortDescription, project.groupFullRunDefault]);

  const parsed = parseAliasInput(aliases);
  const dirty = isGroupHintsDirty(project, { aliases: parsed, description, fullRun });

  const save = async (): Promise<void> => {
    setSaving(true);
    try {
      const updated = await projectRepository.setGroupHints(project.id, {
        aliases: parsed,
        shortDescription: description.trim() || null,
        groupFullRunDefault: fullRun,
      });
      onProjectUpdated({
        ...project,
        aliases: updated.aliases,
        shortDescription: updated.shortDescription,
        groupFullRunDefault: updated.groupFullRunDefault,
      });
      toast.success('Подсказки для Telegram-групп сохранены');
    } catch {
      toast.error('Не удалось сохранить подсказки');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-xl border p-4">
      <div className="flex items-center gap-2">
        <MessagesSquare className="size-4 text-muted-foreground" />
        <p className="text-sm font-semibold">Как называют проект в Telegram-группах</p>
      </div>
      <p className="mbs-0.5 text-xs text-muted-foreground">
        Бот выбирает проект по названию, привычным названиям и их формам («в конфиге»). Если не
        понял — ИИ подберёт проект по описанию.
      </p>
      <div className="mbs-3 grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">Привычные названия</span>
          <input
            value={aliases}
            onChange={(e) => setAliases(e.target.value)}
            placeholder="конфиг, настройки"
            disabled={saving}
            maxLength={1300}
            className="h-10 w-full rounded-lg border bg-background px-3 text-sm"
          />
          <span className="block text-xs text-muted-foreground">Через запятую, до 20.</span>
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">Коротко о проекте</span>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Настройки касс и тарифов"
            disabled={saving}
            maxLength={300}
            className="h-10 w-full rounded-lg border bg-background px-3 text-sm"
          />
        </label>
      </div>
      <label className="mbs-3 flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={fullRun}
          onChange={(e) => setFullRun(e.target.checked)}
          disabled={saving}
          className="mbs-0.5 size-4"
        />
        <span>
          <span className="font-medium">Полный прогон по умолчанию для задач из групп</span>
          <span className="block text-xs text-muted-foreground">
            Задачи воркеру из смешанной группы пойдут полным прогоном (сборка, тесты, проверка).
            Включайте, если для проекта настроен конвейер воркера. Выключено — обычное изменение.
          </span>
        </span>
      </label>
      <div className="mbs-3 flex justify-end">
        <Button size="sm" disabled={!dirty || saving} onClick={() => void save()}>
          {saving && <Loader2 className="me-1.5 size-4 motion-safe:animate-spin" />}
          Сохранить
        </Button>
      </div>
    </section>
  );
}
