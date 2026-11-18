import { useCallback, useEffect, useState } from 'react';
import { Check, Loader2, MessagesSquare, Plus, Unlink, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/sonner';
import { useContainer } from '@/infrastructure/di/container';
import type { TelegramWorkGroup, TelegramWorkGroups } from '@/domain/workspace/TelegramWorkGroup';
import { TelegramGroupConnectDialog } from './TelegramGroupConnectDialog';
import {
  addableProjects,
  findNewGroup,
  groupLabel,
  groupProjects,
  parseChatIdInput,
  splitGroupsByStatus,
} from './telegramWorkGroups';

type WorkspaceProject = { readonly id: string; readonly name: string };

/**
 * Рабочие Telegram-группы пространства (db/181): в них бот принимает задачи пространства,
 * а людей без аккаунта или вне пространства подключает кнопкой. Подключение — ссылкой (бот сам
 * узнаёт id группы) или вручную по id из команды /id.
 */
export function TelegramWorkGroupsCard({
  workspaceId,
  canManage,
}: {
  workspaceId: string;
  // Владелец или руководитель: рабочая группа открывает вход в пространство.
  canManage: boolean;
}): React.ReactElement {
  const { workspaceRepository } = useContainer();
  const [data, setData] = useState<TelegramWorkGroups | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const [knownChatIds, setKnownChatIds] = useState<number[]>([]);
  const [manualId, setManualId] = useState('');
  const [busyChatId, setBusyChatId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [projects, setProjects] = useState<readonly WorkspaceProject[]>([]);

  const load = useCallback(async (): Promise<TelegramWorkGroups> => {
    const next = await workspaceRepository.listTelegramGroups(workspaceId);
    setData(next);
    return next;
  }, [workspaceId, workspaceRepository]);

  useEffect(() => {
    load().catch((error: unknown) =>
      toast.error((error as Error).message || 'Не удалось загрузить Telegram-группы'),
    );
  }, [load]);

  // Проекты пространства — для чипов и «Добавить проект» у групп (db/189).
  useEffect(() => {
    let cancelled = false;
    workspaceRepository
      .listProjects(workspaceId)
      .then((list) => {
        if (!cancelled) setProjects(list);
      })
      .catch(() => {
        if (!cancelled) setProjects([]);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, workspaceRepository]);

  const replaceGroup = (group: TelegramWorkGroup): void => {
    setData((prev) =>
      prev ? { ...prev, groups: prev.groups.map((g) => (g.chatId === group.chatId ? group : g)) } : prev,
    );
  };

  const confirm = async (group: TelegramWorkGroup): Promise<void> => {
    setBusyChatId(group.chatId);
    try {
      replaceGroup(await workspaceRepository.confirmTelegramGroup(workspaceId, group.chatId));
      toast.success(`Группа «${groupLabel(group)}» подключена`);
    } catch (error) {
      toast.error((error as Error).message || 'Не удалось подключить группу');
    } finally {
      setBusyChatId(null);
    }
  };

  const reject = async (group: TelegramWorkGroup): Promise<void> => {
    setBusyChatId(group.chatId);
    try {
      await workspaceRepository.removeTelegramGroup(workspaceId, group.chatId);
      toast.success(`Группа «${groupLabel(group)}» отклонена`);
      await load();
    } catch (error) {
      toast.error((error as Error).message || 'Не удалось отклонить группу');
    } finally {
      setBusyChatId(null);
    }
  };

  // Список проектов группы сохраняется сразу, без отдельной кнопки (spec, раздел 2).
  const saveProjects = async (group: TelegramWorkGroup, projectIds: readonly string[]): Promise<void> => {
    const previous = group;
    replaceGroup({ ...group, projectIds });
    try {
      replaceGroup(await workspaceRepository.setTelegramGroupProjects(workspaceId, group.chatId, projectIds));
    } catch (error) {
      replaceGroup(previous);
      toast.error((error as Error).message || 'Не удалось сохранить проекты группы');
    }
  };

  const openConnect = (): void => {
    setKnownChatIds(data?.groups.map((group) => group.chatId) ?? []);
    setConnectOpen(true);
  };

  const add = async (chatId: number): Promise<void> => {
    setAdding(true);
    try {
      const group = await workspaceRepository.addTelegramGroup(workspaceId, chatId);
      toast.success(`Группа «${groupLabel(group)}» подключена`);
      setManualId('');
      await load();
    } catch (error) {
      toast.error((error as Error).message || 'Не удалось подключить группу');
    } finally {
      setAdding(false);
    }
  };

  const addManual = (): void => {
    const chatId = parseChatIdInput(manualId);
    if (chatId === null) {
      toast.error('Id группы — отрицательное число, например -1001234567890');
      return;
    }
    void add(chatId);
  };

  const remove = async (chatId: number): Promise<void> => {
    setBusyChatId(chatId);
    try {
      await workspaceRepository.removeTelegramGroup(workspaceId, chatId);
      toast.success('Группа отключена: бот больше не принимает в ней задачи пространства');
      await load();
    } catch (error) {
      toast.error((error as Error).message || 'Не удалось отключить группу');
    } finally {
      setBusyChatId(null);
    }
  };

  const { drafts, connected } = splitGroupsByStatus(data?.groups ?? []);
  const mainGroup = data?.mainGroup ?? null;
  const mainIsWork = mainGroup !== null && (data?.groups.some((g) => g.chatId === mainGroup.chatId) ?? false);
  const bot = data?.botUsername ?? 'ProjectsFlow_Bot';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessagesSquare className="size-5 text-muted-foreground" />
          Рабочие Telegram-группы
        </CardTitle>
        <CardDescription>
          В&nbsp;этих группах бот принимает задачи пространства: пишут <code>@{bot}</code> и&nbsp;текст&nbsp;— бот
          перефразирует и&nbsp;поставит задачу. Кто ещё не&nbsp;подключён, получит кнопку «Подключиться»:
          регистрация, вступление в&nbsp;пространство и&nbsp;привязка Telegram&nbsp;— за&nbsp;минуту.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {drafts.length > 0 && (
          <ul className="space-y-2">
            {drafts.map((group) => (
              <li
                key={group.chatId}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-approval/40 bg-approval/5 px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">Новая группа «{groupLabel(group)}» ждёт подтверждения</div>
                  <div className="text-xs text-muted-foreground">
                    Бота добавили в&nbsp;группу. Пока её не&nbsp;подключат, задачи из&nbsp;неё не&nbsp;принимаются.
                  </div>
                </div>
                {canManage && (
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      aria-label={`Подключить «${groupLabel(group)}»`}
                      disabled={busyChatId === group.chatId}
                      onClick={() => void confirm(group)}
                    >
                      {busyChatId === group.chatId ? (
                        <Loader2 className="size-4 motion-safe:animate-spin" />
                      ) : (
                        <Check className="size-4" />
                      )}
                      Подключить
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      aria-label={`Отклонить «${groupLabel(group)}»`}
                      disabled={busyChatId === group.chatId}
                      onClick={() => void reject(group)}
                    >
                      Отклонить
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {data === null ? (
          <Skeleton className="h-16" />
        ) : connected.length === 0 ? (
          <p className="text-sm text-muted-foreground">Рабочих групп пока нет.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg bg-panel">
            {connected.map((group) => (
              <li key={group.chatId} className="flex flex-wrap items-center gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{groupLabel(group)}</div>
                  <div className="font-mono text-xs text-muted-foreground">{group.chatId}</div>
                  {group.status === 'disconnected' ? (
                    <div className="text-xs text-muted-foreground">Бота удалили из&nbsp;группы&nbsp;— задачи не&nbsp;принимаются.</div>
                  ) : (
                    <GroupProjects
                      group={group}
                      projects={projects}
                      canManage={canManage}
                      onChange={(projectIds) => void saveProjects(group, projectIds)}
                    />
                  )}
                </div>
                {canManage && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={busyChatId === group.chatId}
                    onClick={() => void remove(group.chatId)}
                  >
                    {busyChatId === group.chatId ? (
                      <Loader2 className="size-4 motion-safe:animate-spin" />
                    ) : (
                      <Unlink className="size-4" />
                    )}
                    Отключить
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}

        {canManage && mainGroup !== null && !mainIsWork && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg bg-panel px-3 py-2 text-sm">
            <span className="min-w-0 flex-1">
              Основная группа сводок «{groupLabel(mainGroup)}» пока не&nbsp;рабочая.
            </span>
            <Button type="button" variant="outline" size="sm" disabled={adding} onClick={() => void add(mainGroup.chatId)}>
              Сделать рабочей
            </Button>
          </div>
        )}

        {canManage ? (
          <>
            <Button type="button" onClick={openConnect}>
              <Plus className="size-4" />
              Подключить группу
            </Button>
            <details className="rounded-lg bg-panel px-3 py-2 text-sm">
              <summary className="cursor-pointer select-none text-muted-foreground">
                Не получается? Добавить по ID
              </summary>
              <ol className="mbs-2 list-decimal space-y-1 ps-5 text-muted-foreground">
                <li>Добавьте @{bot} в группу.</li>
                <li>
                  Напишите в группе <code>/id</code>&nbsp;— бот ответит её ID.
                </li>
                <li>Вставьте ID сюда. Добавить группу может её администратор, а Telegram должен быть привязан в профиле.</li>
              </ol>
              <div className="mbs-2 flex gap-2">
                <Input
                  value={manualId}
                  inputMode="numeric"
                  placeholder="-1001234567890"
                  className="font-mono text-xs"
                  aria-label="ID Telegram-группы"
                  onChange={(event) => setManualId(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') addManual();
                  }}
                />
                <Button type="button" variant="outline" disabled={adding || manualId.trim() === ''} onClick={addManual}>
                  {adding ? <Loader2 className="size-4 motion-safe:animate-spin" /> : null}
                  Добавить
                </Button>
              </div>
            </details>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            Подключают группы владелец и руководители пространства.
          </p>
        )}
      </CardContent>
      {canManage && (
        <TelegramGroupConnectDialog
          open={connectOpen}
          onOpenChange={setConnectOpen}
          workspaceId={workspaceId}
          purpose="work"
          detect={async () => findNewGroup(knownChatIds, (await load()).groups)}
          onConnected={(group) => {
            setConnectOpen(false);
            toast.success(`Группа «${groupLabel(group)}» подключена`);
          }}
        />
      )}
    </Card>
  );
}

// Проекты группы (db/189): чипы + «Добавить проект». Пусто — все проекты пространства.
function GroupProjects({
  group,
  projects,
  canManage,
  onChange,
}: {
  group: TelegramWorkGroup;
  projects: readonly WorkspaceProject[];
  canManage: boolean;
  onChange: (projectIds: readonly string[]) => void;
}): React.ReactElement {
  const chips = groupProjects(group.projectIds, projects);
  const addable = addableProjects(group.projectIds, projects);
  return (
    <div className="mbs-1.5 flex flex-wrap items-center gap-1.5">
      {chips.length === 0 ? (
        <span className="text-xs text-muted-foreground">Все проекты пространства</span>
      ) : (
        chips.map((project) => (
          <span key={project.id} className="pf-tag pf-tone-gray inline-flex items-center gap-1 text-2xs">
            {project.name}
            {canManage && (
              <button
                type="button"
                className="rounded-sm text-muted-foreground hover:text-foreground"
                aria-label={`Убрать проект «${project.name}» из группы`}
                onClick={() => onChange(group.projectIds.filter((id) => id !== project.id))}
              >
                <X className="size-3" />
              </button>
            )}
          </span>
        ))
      )}
      {canManage && addable.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs">
              <Plus className="size-3" />
              Добавить проект
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {addable.map((project) => (
              <DropdownMenuItem key={project.id} onSelect={() => onChange([...group.projectIds, project.id])}>
                {project.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
