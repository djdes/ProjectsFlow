import { useCallback, useEffect, useState } from 'react';
import { Bot, Info, Loader2 } from 'lucide-react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import { useContainer } from '@/infrastructure/di/container';
import type { DispatcherCandidate } from '@/application/project/ProjectRepository';
import type { Project } from '@/domain/project/Project';

type Props = {
  project: Project;
  // Owner-only — рендерим в read-only режиме для editor/viewer.
  isOwner: boolean;
  // Колбэк после успешного set/unset — родитель обновляет state проекта,
  // чтобы UI сразу показал нового диспетчера.
  onChanged: (project: Project) => void;
};

// Секция «Ralph-диспетчер» на странице проекта. Показывает:
// - текущего диспетчера (или «никто»);
// - dropdown/single-pick для смены (если есть кандидаты);
// - пояснение что диспетчер делает.
//
// Логика выбора:
// - 0 кандидатов → «никто из участников не подключил agent-токен» + ссылка на профиль;
// - 1 кандидат → автовыбран, кнопка «Сделать диспетчером» (или «Снять» если уже);
// - 2+ → select-dropdown.
export function DispatcherSection({ project, isOwner, onChanged }: Props): React.ReactElement {
  const { projectRepository } = useContainer();
  const [candidates, setCandidates] = useState<DispatcherCandidate[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Локальный выбор в дропдауне ДО нажатия «Сохранить». Инициализируем текущим
  // диспетчером — чтобы dropdown показывал актуальное значение.
  const [pendingChoice, setPendingChoice] = useState<string | null>(
    project.dispatcherUserId,
  );

  // Подгрузка кандидатов. viewer+ может смотреть (но менять только owner).
  useEffect(() => {
    let cancelled = false;
    projectRepository.listDispatcherCandidates(project.id).then(
      (list) => {
        if (!cancelled) setCandidates(list);
      },
      (err: unknown) => {
        if (!cancelled) setLoadError((err as Error).message ?? 'Не удалось загрузить');
      },
    );
    return () => {
      cancelled = true;
    };
  }, [project.id, projectRepository]);

  // Если текущий project.dispatcherUserId меняется снаружи (после save) —
  // синхронизируем pendingChoice.
  useEffect(() => {
    setPendingChoice(project.dispatcherUserId);
  }, [project.dispatcherUserId]);

  const save = useCallback(
    async (userId: string | null): Promise<void> => {
      setSaving(true);
      try {
        const updated = await projectRepository.setDispatcher(project.id, userId);
        toast.success(
          userId === null
            ? 'Диспетчер снят — проект в ручном режиме'
            : 'Диспетчер назначен',
        );
        onChanged(updated);
      } catch (err) {
        toast.error((err as Error).message ?? 'Не удалось сохранить');
      } finally {
        setSaving(false);
      }
    },
    [project.id, projectRepository, onChanged],
  );

  const currentDispatcher =
    candidates?.find((c) => c.userId === project.dispatcherUserId) ?? null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Bot className="size-4 text-muted-foreground" />
          Ralph-диспетчер
        </CardTitle>
        <CardDescription>
          Кто автономно выполняет задачи проекта через MCP-агент в режиме <code>/loop</code>.
          При создании задачи дежурный Ralph узнаёт о ней при следующем опросе и берёт в работу.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Loading / error */}
        {candidates === null && !loadError && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Загрузка кандидатов…
          </div>
        )}
        {loadError && (
          <p className="text-sm text-destructive">Ошибка: {loadError}</p>
        )}

        {/* 0 кандидатов */}
        {candidates !== null && candidates.length === 0 && (
          <div className="rounded-md border border-dashed bg-muted/20 p-3 text-sm">
            <div className="flex items-start gap-2">
              <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <div>
                <p className="font-medium">Нет ralph-кандидатов</p>
                <p className="text-muted-foreground">
                  Ни у одного участника нет активного agent-токена. Создай токен в{' '}
                  <a href="/profile" className="text-foreground underline">
                    профиле
                  </a>{' '}
                  и установи MCP — после этого станешь диспетчером.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ≥1 кандидат — текущий статус */}
        {candidates !== null && candidates.length > 0 && (
          <div className="space-y-2">
            <div className="rounded-md border bg-muted/10 p-3 text-sm">
              {project.dispatcherUserId === null ? (
                <p className="text-muted-foreground">
                  Сейчас диспетчер <strong>не назначен</strong> — задачи никто автономно
                  не выполняет.
                </p>
              ) : currentDispatcher ? (
                <p>
                  Текущий диспетчер:{' '}
                  <strong>{currentDispatcher.displayName}</strong>{' '}
                  <span className="text-xs text-muted-foreground">
                    ({currentDispatcher.activeTokenCount}{' '}
                    {currentDispatcher.activeTokenCount === 1 ? 'токен' : 'токенов'})
                  </span>
                </p>
              ) : (
                <p className="text-amber-600 dark:text-amber-400">
                  Назначен юзер, который больше не подключён как ralph-кандидат — назначь
                  кого-то другого или сними.
                </p>
              )}
            </div>

            {/* Owner: контролы выбора */}
            {isOwner && (
              <div className="flex flex-wrap items-center gap-2">
                {candidates.length === 1 ? (
                  // 1 кандидат — single-pick
                  <>
                    {project.dispatcherUserId === candidates[0]!.userId ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void save(null)}
                        disabled={saving}
                      >
                        Снять диспетчера
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        onClick={() => void save(candidates[0]!.userId)}
                        disabled={saving}
                      >
                        {saving && <Loader2 className="size-3.5 animate-spin" />}
                        Назначить {candidates[0]!.displayName} диспетчером
                      </Button>
                    )}
                  </>
                ) : (
                  // 2+ кандидатов — dropdown + кнопки
                  <>
                    <select
                      value={pendingChoice ?? ''}
                      onChange={(e) => setPendingChoice(e.target.value || null)}
                      disabled={saving}
                      className="h-9 rounded-md border bg-background px-2 text-sm"
                    >
                      <option value="">— ручной режим (нет диспетчера) —</option>
                      {candidates.map((c) => (
                        <option key={c.userId} value={c.userId}>
                          {c.displayName} ({c.activeTokenCount}{' '}
                          {c.activeTokenCount === 1 ? 'токен' : 'токенов'})
                        </option>
                      ))}
                    </select>
                    <Button
                      size="sm"
                      onClick={() => void save(pendingChoice)}
                      disabled={saving || pendingChoice === project.dispatcherUserId}
                    >
                      {saving && <Loader2 className="size-3.5 animate-spin" />}
                      Сохранить
                    </Button>
                  </>
                )}
              </div>
            )}
            {!isOwner && (
              <p className="text-xs text-muted-foreground">
                Менять диспетчера может только владелец проекта.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
