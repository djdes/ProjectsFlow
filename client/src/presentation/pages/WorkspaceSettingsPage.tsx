import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  CalendarClock,
  Copy,
  History,
  Loader2,
  RefreshCw,
  Send,
  Trash2,
  UserPlus,
} from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import type { WorkspaceRole } from '@/domain/workspace/Workspace';
import type { WorkspaceInvite } from '@/domain/workspace/WorkspaceInvite';
import type {
  WorkspaceAssigneeDigestGroup,
  WorkspaceAssigneeDigestMember,
  WorkspaceAssigneeDigestRecipientMode,
  WorkspaceCommitSyncAction,
  WorkspaceDigestProjectMode,
} from '@/domain/workspace/WorkspaceAssigneeDigest';
import { useContainer } from '@/infrastructure/di/container';
import { useCurrentUser } from '@/presentation/hooks/useCurrentUser';
import { useWorkspaces } from '@/presentation/hooks/useWorkspaces';
import { useRenameWorkspace } from '@/presentation/hooks/useRenameWorkspace';
import { useDeleteWorkspace } from '@/presentation/hooks/useDeleteWorkspace';
import { useWorkspaceMembers } from '@/presentation/hooks/useWorkspaceMembers';
import { useWorkspaceProjects } from '@/presentation/hooks/useWorkspaceProjects';
import { EmojiGrid } from '@/presentation/components/forms/EmojiGrid';
import { InviteDialog } from '@/presentation/components/project/InviteDialog';
import { WorkspaceIcon } from '@/presentation/layout/WorkspaceIcon';
import { avatarColor, getInitials } from '@/presentation/layout/projectIcons';
import type { ScheduleDay } from '@/domain/digest/ScheduleDays';
import { ScheduleDayPicker } from '@/presentation/components/forms/ScheduleDayPicker';

const ROLE_SELECT_CLASS =
  'h-8 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';

const WS_ROLE_LABEL: Record<WorkspaceRole, string> = {
  owner: 'Владелец',
  editor: 'Редактор',
  viewer: 'Наблюдатель',
};

export function WorkspaceSettingsPage(): React.ReactElement {
  const { workspaceId = '' } = useParams<{ workspaceId: string }>();
  const navigate = useNavigate();
  const { data: workspaces, loading } = useWorkspaces();

  const workspace = workspaces?.find((w) => w.id === workspaceId) ?? null;
  const isOwner = workspace?.role === 'owner';
  // Общие настройки пространства принадлежат всей команде. Любой участник может
  // менять название, иконку и рассылку; owner-only остаются роли и удаление.
  const canEditSharedSettings = workspace !== null;
  // Дефолт-хаб: состав участников выводится автоматически (вы + все по общим проектам),
  // и его нельзя удалить. Поэтому ручное управление участниками и «опасная зона» скрыты.
  const isDefault = workspace?.kind === 'default';

  if (loading) {
    return (
      <div className="mx-auto max-w-2xl p-6">
        <div className="h-40 animate-pulse rounded bg-muted" />
      </div>
    );
  }

  if (!workspace) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 p-6">
        {/* Обёртка ради pf-burger-gap: отступ должен двигать кнопку, не перекрывая её
            -ml-3 (им она выровнена по тексту ниже) и не растягивая ghost-подложку. */}
        <div className="pf-burger-gap flex">
          <Button asChild variant="ghost" size="sm" className="-ml-3 gap-1">
            <Link to="/">
              <ArrowLeft />
              На&nbsp;главную
            </Link>
          </Button>
        </div>
        <p className="text-muted-foreground">Пространство не&nbsp;найдено или у&nbsp;вас нет доступа.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 px-4 pb-12 pt-3.5 sm:px-6">
      {/* Обёртка ради pf-burger-gap — см. комментарий в ветке «пространство не найдено».
          Заметно только на узком окне: шире max-w-2xl колонка отъезжает от бургера сама. */}
      <div className="pf-burger-gap flex">
        <Button asChild variant="ghost" size="sm" className="-ml-3 gap-1">
          <Link to="/">
            <ArrowLeft />
            Назад
          </Link>
        </Button>
      </div>

      <div className="flex items-center gap-3">
        <WorkspaceIcon name={workspace.name} icon={workspace.icon} className="size-9 text-base" />
        <h1 className="text-xl font-semibold tracking-tight">{workspace.name}</h1>
      </div>

      <RenameCard
        workspaceId={workspace.id}
        initialName={workspace.name}
        initialIcon={workspace.icon}
        disabled={!canEditSharedSettings}
      />
      <MembersCard workspaceId={workspace.id} canManage={isOwner && !isDefault} autoManaged={isDefault} />
      <AssigneeDigestCard workspaceId={workspace.id} canManage={canEditSharedSettings} />
      {isOwner && !isDefault && <InvitesCard workspaceId={workspace.id} />}
      <ProjectsCard workspaceId={workspace.id} />
      {isOwner && !isDefault && (
        <DangerZoneCard
          workspaceId={workspace.id}
          workspaceName={workspace.name}
          projectCount={workspace.projectCount}
          isLast={(workspaces?.length ?? 1) <= 1}
          onDeleted={() => navigate('/')}
        />
      )}
    </div>
  );
}

function RenameCard({
  workspaceId,
  initialName,
  initialIcon,
  disabled,
}: {
  workspaceId: string;
  initialName: string;
  initialIcon: string | null;
  disabled: boolean;
}): React.ReactElement {
  const { submit, saving } = useRenameWorkspace();
  const [name, setName] = useState(initialName);
  const [icon, setIcon] = useState<string | null>(initialIcon);

  useEffect(() => {
    setName(initialName);
    setIcon(initialIcon);
  }, [initialName, initialIcon]);

  const trimmed = name.trim();
  const dirty = trimmed !== initialName || icon !== initialIcon;

  const save = async (): Promise<void> => {
    try {
      await submit(workspaceId, { name: trimmed, icon });
      toast.success('Пространство обновлено');
    } catch (e) {
      toast.error((e as Error).message || 'Не удалось сохранить');
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Название и&nbsp;иконка</CardTitle>
        <CardDescription>Видны в&nbsp;переключателе пространств.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <WorkspaceIcon name={trimmed || '?'} icon={icon} className="size-11 text-lg" />
          <div className="flex-1 space-y-2">
            <Label htmlFor="wsName">Название</Label>
            <Input
              id="wsName"
              value={name}
              maxLength={120}
              disabled={disabled}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
        </div>
        {!disabled && (
          <>
            <EmojiGrid value={icon} onChange={setIcon} />
            <div className="flex justify-end">
              <Button onClick={() => void save()} disabled={saving || !dirty || trimmed.length === 0}>
                {saving ? 'Сохраняем…' : 'Сохранить'}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

type AssigneeDigestDraft = {
  enabled: boolean;
  hour: number;
  minute: number;
  daysOfWeek: ScheduleDay[];
  groupChatId: string;
  groupTitle: string;
  recipientMode: WorkspaceAssigneeDigestRecipientMode;
  recipientUserIds: string[];
  projectMode: WorkspaceDigestProjectMode;
  projectIds: string[];
  commitSyncEnabled: boolean;
  commitSyncHour: number;
  commitSyncMinute: number;
  commitSyncAction: WorkspaceCommitSyncAction;
  eodReminderEnabled: boolean;
  eodReminderHour: number;
  eodReminderMinute: number;
};

function AssigneeDigestCard({
  workspaceId,
  canManage,
}: {
  workspaceId: string;
  canManage: boolean;
}): React.ReactElement {
  const { workspaceRepository } = useContainer();
  const [draft, setDraft] = useState<AssigneeDigestDraft | null>(null);
  const [members, setMembers] = useState<WorkspaceAssigneeDigestMember[]>([]);
  const [groups, setGroups] = useState<WorkspaceAssigneeDigestGroup[]>([]);
  const [projects, setProjects] = useState<Array<{ id: string; name: string; icon: string | null }>>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [applyingCommitSync, setApplyingCommitSync] = useState(false);
  const [resolving, setResolving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      workspaceRepository.getAssigneeDigest(workspaceId),
      workspaceRepository.listAssigneeDigestGroups(workspaceId).catch(() => []),
      workspaceRepository.listProjects(workspaceId),
    ])
      .then(([result, history, workspaceProjects]) => {
        if (cancelled) return;
        setDraft({
          enabled: result.settings.enabled,
          hour: result.settings.hour,
          minute: result.settings.minute,
          daysOfWeek: result.settings.daysOfWeek,
          groupChatId:
            result.settings.telegramGroupChatId === null
              ? ''
              : String(result.settings.telegramGroupChatId),
          groupTitle: result.settings.telegramGroupTitle ?? '',
          recipientMode: result.settings.recipientMode,
          recipientUserIds: result.settings.recipientUserIds,
          projectMode: result.settings.projectMode,
          projectIds: result.settings.projectIds,
          commitSyncEnabled: result.settings.commitSyncEnabled,
          commitSyncHour: result.settings.commitSyncHour,
          commitSyncMinute: result.settings.commitSyncMinute,
          commitSyncAction: result.settings.commitSyncAction,
          eodReminderEnabled: result.settings.eodReminderEnabled,
          eodReminderHour: result.settings.eodReminderHour,
          eodReminderMinute: result.settings.eodReminderMinute,
        });
        setMembers(result.members);
        setGroups(history);
        setProjects(workspaceProjects);
      })
      .catch((error) => toast.error((error as Error).message || 'Не удалось загрузить рассылку'))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, workspaceRepository]);

  const update = (patch: Partial<AssigneeDigestDraft>): void => {
    setDraft((current) => (current ? { ...current, ...patch } : current));
  };

  const selectedEligible = draft
    ? draft.recipientUserIds.filter((id) =>
        members.some((member) => member.userId === id && member.hasTelegram),
      )
    : [];

  const validate = (
    requireGroup = Boolean(
      draft?.enabled || draft?.commitSyncEnabled || draft?.eodReminderEnabled,
    ),
  ): boolean => {
    if (!draft) return false;
    const chatId = Number(draft.groupChatId.trim());
    if (requireGroup && (!draft.groupChatId.trim() || !Number.isInteger(chatId))) {
      toast.error('Укажите корректный chat_id Telegram-группы');
      return false;
    }
    if (
      requireGroup &&
      draft.projectMode === 'selected' &&
      draft.projectIds.length === 0
    ) {
      toast.error('Выберите хотя бы один проект');
      return false;
    }
    if (
      draft.enabled &&
      draft.recipientMode === 'selected' &&
      selectedEligible.length === 0
    ) {
      toast.error('Выберите хотя бы одного участника');
      return false;
    }
    return true;
  };

  const save = async (): Promise<boolean> => {
    if (!draft || !validate()) return false;
    setSaving(true);
    try {
      const settings = await workspaceRepository.saveAssigneeDigest(workspaceId, {
        enabled: draft.enabled,
        hour: draft.hour,
        minute: draft.minute,
        daysOfWeek: draft.daysOfWeek,
        telegramGroupChatId:
          draft.groupChatId.trim() && Number.isInteger(Number(draft.groupChatId.trim()))
            ? Number(draft.groupChatId.trim())
            : null,
        telegramGroupTitle: draft.groupTitle.trim() || null,
        recipientMode: draft.recipientMode,
        recipientUserIds: selectedEligible,
        projectMode: draft.projectMode,
        projectIds: draft.projectIds,
        commitSyncEnabled: draft.commitSyncEnabled,
        commitSyncHour: draft.commitSyncHour,
        commitSyncMinute: draft.commitSyncMinute,
        commitSyncAction: draft.commitSyncAction,
        eodReminderEnabled: draft.eodReminderEnabled,
        eodReminderHour: draft.eodReminderHour,
        eodReminderMinute: draft.eodReminderMinute,
      });
      update({
        enabled: settings.enabled,
        hour: settings.hour,
        minute: settings.minute,
        daysOfWeek: settings.daysOfWeek,
        recipientUserIds: settings.recipientUserIds,
        projectMode: settings.projectMode,
        projectIds: settings.projectIds,
        commitSyncEnabled: settings.commitSyncEnabled,
        commitSyncHour: settings.commitSyncHour,
        commitSyncMinute: settings.commitSyncMinute,
        commitSyncAction: settings.commitSyncAction,
        eodReminderEnabled: settings.eodReminderEnabled,
        eodReminderHour: settings.eodReminderHour,
        eodReminderMinute: settings.eodReminderMinute,
      });
      toast.success('Рассылка по ответственным сохранена');
      return true;
    } catch (error) {
      toast.error((error as Error).message || 'Не удалось сохранить рассылку');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const sendNow = async (): Promise<void> => {
    if (sending || !validate(true) || !(await save())) return;
    setSending(true);
    try {
      const result = await workspaceRepository.sendAssigneeDigestNow(workspaceId);
      if (result.sentCount === 0) {
        if (result.skippedRecipientUserIds.length > 0) {
          toast.error(
            `Не удалось отправить сообщения: у ${result.skippedRecipientUserIds.length} участников Telegram не подключён или недоступен`,
          );
        } else {
          toast.message(
            result.projectCount === 0
              ? 'Нет проектов, включённых в рассылку'
              : 'Нет открытых задач для выбранных участников',
          );
        }
        return;
      }
      toast.success(
        `Отправлено сообщений: ${result.sentCount} · задач: ${result.taskCount}`,
      );
      if (result.skippedRecipientUserIds.length > 0) {
        toast.warning(
          `Не удалось отправить для ${result.skippedRecipientUserIds.length} участников без доступного Telegram`,
        );
      }
    } catch (error) {
      toast.error((error as Error).message || 'Не удалось отправить тест');
    } finally {
      setSending(false);
    }
  };

  // Мастер-действие: применить сверку коммитов (вкл/выкл + время + дни + режим) КО ВСЕМ проектам
  // пространства разом. Пишет per-project конфиг напрямую, поэтому в каждом окне автоматизации
  // отразится именно это. Дни берём из общего набора «Дни отправки» (draft.daysOfWeek).
  const applyCommitSyncToAll = async (): Promise<void> => {
    if (applyingCommitSync || !draft) return;
    setApplyingCommitSync(true);
    try {
      const { affected } = await workspaceRepository.applyCommitSyncToAll(workspaceId, {
        enabled: draft.commitSyncEnabled,
        hour: draft.commitSyncHour,
        minute: draft.commitSyncMinute,
        daysOfWeek: draft.daysOfWeek,
        action: draft.commitSyncAction,
      });
      toast.success(
        draft.commitSyncEnabled
          ? `Сверка коммитов включена во всех проектах (${affected})`
          : `Сверка коммитов выключена во всех проектах (${affected})`,
      );
    } catch (error) {
      toast.error((error as Error).message || 'Не удалось применить ко всем проектам');
    } finally {
      setApplyingCommitSync(false);
    }
  };

  const resolveTitle = async (): Promise<void> => {
    if (!draft) return;
    const chatId = Number(draft.groupChatId.trim());
    if (!Number.isInteger(chatId)) {
      toast.error('Сначала укажите корректный chat_id');
      return;
    }
    setResolving(true);
    try {
      const result = await workspaceRepository.resolveAssigneeDigestGroup(
        workspaceId,
        chatId,
      );
      if (result.title) update({ groupTitle: result.title });
      else toast.message('Бот не смог получить название группы');
    } catch (error) {
      toast.error((error as Error).message || 'Не удалось получить название группы');
    } finally {
      setResolving(false);
    }
  };

  const toggleRecipient = (userId: string): void => {
    if (!draft) return;
    update({
      recipientUserIds: draft.recipientUserIds.includes(userId)
        ? draft.recipientUserIds.filter((id) => id !== userId)
        : [...draft.recipientUserIds, userId],
    });
  };

  const toggleProject = (projectId: string): void => {
    if (!draft) return;
    update({
      projectIds: draft.projectIds.includes(projectId)
        ? draft.projectIds.filter((id) => id !== projectId)
        : [...draft.projectIds, projectId],
    });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1.5">
            <CardTitle className="flex items-center gap-2">
              <CalendarClock className="size-5 text-primary" />
              Telegram-расписание пространства
            </CardTitle>
            <CardDescription>
              Ежедневная таблица по ответственным, сверка выполненных задач и вечернее
              напоминание. Всё публикуется в общей Telegram-группе пространства в выбранные дни.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {loading || !draft ? (
          <div className="h-32 animate-pulse rounded bg-muted" />
        ) : (
          <>
            <div className="space-y-2">
              <Label>Telegram-группа пространства</Label>
              <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                <div className="flex min-w-0 gap-1.5">
                  <Input
                    value={draft.groupChatId}
                    disabled={!canManage}
                    inputMode="numeric"
                    placeholder="-1003920622527"
                    className="font-mono text-xs"
                    onChange={(event) => update({ groupChatId: event.target.value })}
                  />
                  {groups.length > 0 && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          disabled={!canManage}
                          aria-label="Ранее использованные Telegram-группы"
                        >
                          <History className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="max-h-64 w-72 overflow-auto">
                        <DropdownMenuLabel>Ранее использованные группы</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        {groups.map((group) => (
                          <DropdownMenuItem
                            key={group.chatId}
                            onSelect={() =>
                              update({
                                groupChatId: String(group.chatId),
                                ...(group.title ? { groupTitle: group.title } : {}),
                              })
                            }
                          >
                            <div className="min-w-0">
                              <div className="truncate">{group.title || 'Без названия'}</div>
                              <div className="font-mono text-xs text-muted-foreground">
                                {group.chatId}
                              </div>
                            </div>
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
                <Input
                  value={draft.groupTitle}
                  disabled={!canManage}
                  placeholder="Название группы"
                  maxLength={255}
                  onChange={(event) => update({ groupTitle: event.target.value })}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  disabled={!canManage || resolving}
                  onClick={() => void resolveTitle()}
                  aria-label="Получить название группы"
                >
                  {resolving ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <RefreshCw className="size-4" />
                  )}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Бот ProjectsFlow_Bot должен быть добавлен в группу. Для супергруппы chat_id
                обычно начинается с −100.
              </p>
            </div>

            <div className="space-y-3 border-t pt-4">
              <div className="flex flex-wrap items-center gap-3">
                <Switch
                  checked={draft.enabled}
                  disabled={!canManage}
                  onCheckedChange={(enabled) => update({ enabled })}
                  aria-label="Включить ежедневную таблицу"
                />
                <Label className="min-w-32">Ежедневная таблица</Label>
                <Input
                  type="number"
                  min={0}
                  max={23}
                  value={draft.hour}
                  disabled={!canManage}
                  className="w-16"
                  onChange={(event) =>
                    update({
                      hour: Math.min(23, Math.max(0, Number(event.target.value) || 0)),
                    })
                  }
                />
                <span>:</span>
                <Input
                  type="number"
                  min={0}
                  max={59}
                  value={draft.minute}
                  disabled={!canManage}
                  className="w-16"
                  onChange={(event) =>
                    update({
                      minute: Math.min(59, Math.max(0, Number(event.target.value) || 0)),
                    })
                  }
                />
              </div>
              <div className="flex flex-wrap items-center gap-3 rounded-md border px-3 py-2">
                <Switch
                  checked={draft.commitSyncEnabled}
                  disabled={!canManage}
                  onCheckedChange={(commitSyncEnabled) => update({ commitSyncEnabled })}
                />
                <Label className="min-w-32">Сверка коммитов</Label>
                <Input
                  type="number"
                  min={0}
                  max={23}
                  value={draft.commitSyncHour}
                  disabled={!canManage}
                  className="w-16"
                  onChange={(event) =>
                    update({
                      commitSyncHour: Math.min(
                        23,
                        Math.max(0, Number(event.target.value) || 0),
                      ),
                    })
                  }
                />
                <span>:</span>
                <Input
                  type="number"
                  min={0}
                  max={59}
                  value={draft.commitSyncMinute}
                  disabled={!canManage}
                  className="w-16"
                  onChange={(event) =>
                    update({
                      commitSyncMinute: Math.min(
                        59,
                        Math.max(0, Number(event.target.value) || 0),
                      ),
                    })
                  }
                />
                <span className="text-xs text-muted-foreground">
                  расписание сверки по умолчанию для всех проектов
                </span>
                <div className="flex w-full flex-col gap-1.5">
                  <span className="text-xs font-medium text-muted-foreground">
                    Что делать при совпадении коммитов
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {(
                      [
                        {
                          value: 'auto',
                          title: 'Переносить автоматически',
                          hint: 'Задачи с совпавшими коммитами закрываются сами.',
                        },
                        {
                          value: 'propose',
                          title: 'Просто оповестить',
                          hint: 'Бот предложит закрыть — переносите вручную.',
                        },
                      ] as const
                    ).map((option) => (
                      <label
                        key={option.value}
                        className={cn(
                          'flex min-w-[13rem] flex-1 items-start gap-2 rounded-md border px-3 py-2 text-sm transition-colors',
                          draft.commitSyncAction === option.value
                            ? 'border-primary bg-primary/5'
                            : 'border-input hover:bg-accent',
                          canManage ? 'cursor-pointer' : 'cursor-not-allowed opacity-55',
                        )}
                      >
                        <input
                          type="radio"
                          name={`commit-sync-action-${workspaceId}`}
                          className="mt-0.5"
                          checked={draft.commitSyncAction === option.value}
                          disabled={!canManage}
                          onChange={() => update({ commitSyncAction: option.value })}
                        />
                        <span className="min-w-0">
                          <span className="block font-medium text-foreground">{option.title}</span>
                          <span className="block text-xs text-muted-foreground">{option.hint}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!canManage || applyingCommitSync}
                  onClick={() => void applyCommitSyncToAll()}
                >
                  {applyingCommitSync && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
                  Применить ко всем проектам
                </Button>
                <span className="w-full text-xs text-muted-foreground">
                  Запишет тумблер, время, дни (из «Дней отправки» ниже) и режим сверки во все
                  проекты пространства — в каждом окне автоматизации отразится это. Дальше каждый
                  проект можно донастроить отдельно.
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-3 rounded-md border px-3 py-2">
                <Switch
                  checked={draft.eodReminderEnabled}
                  disabled={!canManage}
                  onCheckedChange={(eodReminderEnabled) => update({ eodReminderEnabled })}
                />
                <Label className="min-w-32">Перед уходом</Label>
                <Input
                  type="number"
                  min={0}
                  max={23}
                  value={draft.eodReminderHour}
                  disabled={!canManage}
                  className="w-16"
                  onChange={(event) =>
                    update({
                      eodReminderHour: Math.min(
                        23,
                        Math.max(0, Number(event.target.value) || 0),
                      ),
                    })
                  }
                />
                <span>:</span>
                <Input
                  type="number"
                  min={0}
                  max={59}
                  value={draft.eodReminderMinute}
                  disabled={!canManage}
                  className="w-16"
                  onChange={(event) =>
                    update({
                      eodReminderMinute: Math.min(
                        59,
                        Math.max(0, Number(event.target.value) || 0),
                      ),
                    })
                  }
                />
                <span className="text-xs text-muted-foreground">
                  напомнить обновить статусы в группе
                </span>
              </div>
              <div className="space-y-2 rounded-md border px-3 py-3">
                <div>
                  <Label>Дни отправки</Label>
                  <p className="text-xs text-muted-foreground">
                    Одинаково для таблицы, сверки коммитов и вечернего напоминания.
                  </p>
                </div>
                <ScheduleDayPicker
                  value={draft.daysOfWeek}
                  disabled={!canManage}
                  onChange={(daysOfWeek) => update({ daysOfWeek })}
                />
              </div>
            </div>

            <div className="space-y-3 border-t pt-4">
              <Label>Проекты для всех трёх рассылок</Label>
              <div className="flex flex-wrap gap-4 text-sm">
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="radio"
                    name={`assignee-digest-projects-${workspaceId}`}
                    checked={draft.projectMode === 'all'}
                    disabled={!canManage}
                    onChange={() => update({ projectMode: 'all' })}
                  />
                  Все проекты
                </label>
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="radio"
                    name={`assignee-digest-projects-${workspaceId}`}
                    checked={draft.projectMode === 'selected'}
                    disabled={!canManage}
                    onChange={() => update({ projectMode: 'selected' })}
                  />
                  Только выбранные
                </label>
              </div>
              {draft.projectMode === 'selected' && (
                <div className="grid gap-2 sm:grid-cols-2">
                  {projects.map((project) => (
                    <label
                      key={project.id}
                      className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm"
                    >
                      <Checkbox
                        checked={draft.projectIds.includes(project.id)}
                        disabled={!canManage}
                        onCheckedChange={() => toggleProject(project.id)}
                      />
                      <span>{project.icon ?? '📁'}</span>
                      <span className="min-w-0 flex-1 truncate">{project.name}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-3 border-t pt-4">
              <Label>Кому формировать сообщения</Label>
              <div className="flex flex-wrap gap-4 text-sm">
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="radio"
                    name={`assignee-digest-recipients-${workspaceId}`}
                    checked={draft.recipientMode === 'all'}
                    disabled={!canManage}
                    onChange={() => update({ recipientMode: 'all' })}
                  />
                  Всем участникам с задачами
                </label>
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="radio"
                    name={`assignee-digest-recipients-${workspaceId}`}
                    checked={draft.recipientMode === 'selected'}
                    disabled={!canManage}
                    onChange={() => update({ recipientMode: 'selected' })}
                  />
                  Только выбранным
                </label>
              </div>

              {draft.recipientMode === 'selected' && (
                <div className="grid gap-2 sm:grid-cols-2">
                  {members.map((member) => {
                    const label = member.displayName ?? member.email ?? 'Участник';
                    return (
                      <label
                        key={member.userId}
                        className={cn(
                          'flex items-center gap-2 rounded-md border px-3 py-2 text-sm',
                          member.hasTelegram
                            ? 'cursor-pointer'
                            : 'cursor-not-allowed opacity-55',
                        )}
                      >
                        <Checkbox
                          checked={draft.recipientUserIds.includes(member.userId)}
                          disabled={!canManage || !member.hasTelegram}
                          onCheckedChange={() => toggleRecipient(member.userId)}
                        />
                        <span className="min-w-0 flex-1 truncate">{label}</span>
                        <span className="truncate text-xs text-muted-foreground">
                          {member.telegramUsername
                            ? `@${member.telegramUsername.replace(/^@/, '')}`
                            : member.hasTelegram
                              ? 'Telegram подключён'
                              : 'Нет Telegram'}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            {canManage && (
              <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
                <Button
                  variant="outline"
                  disabled={saving || sending}
                  onClick={() => void save()}
                >
                  {saving && !sending ? <Loader2 className="size-4 animate-spin" /> : null}
                  Сохранить
                </Button>
                <Button disabled={saving || sending} onClick={() => void sendNow()}>
                  {sending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Send className="size-4" />
                  )}
                  Отправить сейчас
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function MembersCard({
  workspaceId,
  canManage,
  autoManaged = false,
}: {
  workspaceId: string;
  canManage: boolean;
  // Дефолт-хаб: состав выводится автоматически, ручное управление скрыто.
  autoManaged?: boolean;
}): React.ReactElement {
  const { members, loading, add, changeRole, remove } = useWorkspaceMembers(workspaceId);
  const { user: currentUser } = useCurrentUser();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<WorkspaceRole>('editor');
  const [adding, setAdding] = useState(false);

  const handleAdd = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    setAdding(true);
    try {
      await add(trimmed, role);
      setEmail('');
      toast.success('Участник добавлен');
    } catch (err) {
      toast.error((err as Error).message || 'Не удалось добавить участника');
    } finally {
      setAdding(false);
    }
  };

  const handleRole = async (userId: string, next: WorkspaceRole): Promise<void> => {
    try {
      await changeRole(userId, next);
    } catch (err) {
      toast.error((err as Error).message || 'Не удалось сменить роль');
    }
  };

  // Подтверждение удаления участника (U7): раньше — удаление одним кликом по корзине.
  const [pendingRemove, setPendingRemove] = useState<{ userId: string; label: string } | null>(
    null,
  );

  const handleRemove = async (userId: string): Promise<void> => {
    try {
      await remove(userId);
    } catch (err) {
      toast.error((err as Error).message || 'Не удалось удалить участника');
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Участники</CardTitle>
        <CardDescription>
          {autoManaged
            ? 'Это пространство по умолчанию. Состав формируется автоматически: вы и все, с кем у вас есть общие проекты.'
            : 'Доступ к пространству и его проектам.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="h-16 animate-pulse rounded bg-muted" />
        ) : (
          <ul className="divide-y">
            {(members ?? []).map((m) => (
              <li key={m.userId} className="flex items-center gap-3 py-2">
                <Avatar className="size-8">
                  <AvatarFallback className={avatarColor(m.displayName ?? m.email)}>
                    {getInitials(m.displayName ?? m.email)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{m.displayName ?? '—'}</div>
                  <div className="truncate text-xs text-muted-foreground">{m.email}</div>
                </div>
                {canManage ? (
                  <>
                    <select
                      className={ROLE_SELECT_CLASS}
                      value={m.role}
                      onChange={(e) => void handleRole(m.userId, e.target.value as WorkspaceRole)}
                      aria-label="Роль участника"
                    >
                      <option value="owner">Владелец</option>
                      <option value="editor">Редактор</option>
                      <option value="viewer">Наблюдатель</option>
                    </select>
                    <button
                      type="button"
                      onClick={() =>
                        setPendingRemove({
                          userId: m.userId,
                          label: m.displayName ?? m.email ?? 'участника',
                        })
                      }
                      aria-label="Удалить участника"
                      title="Удалить"
                      className="grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </>
                ) : (
                  <>
                    <span className="text-xs text-muted-foreground">{WS_ROLE_LABEL[m.role]}</span>
                    {currentUser?.id === m.userId && m.role !== 'owner' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-xs text-muted-foreground hover:text-destructive"
                        onClick={() => {
                          if (
                            window.confirm(
                              'Выйти из пространства? Доступ вернёт только новое приглашение.',
                            )
                          ) {
                            void handleRemove(m.userId);
                          }
                        }}
                      >
                        Выйти
                      </Button>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        )}

        {canManage && (
          <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-2 border-t pt-4">
            <div className="min-w-0 flex-1 space-y-1.5">
              <Label htmlFor="memberEmail">Добавить по&nbsp;email</Label>
              <Input
                id="memberEmail"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="user@example.com"
              />
            </div>
            <select
              className={ROLE_SELECT_CLASS}
              value={role}
              onChange={(e) => setRole(e.target.value as WorkspaceRole)}
              aria-label="Роль нового участника"
            >
              <option value="editor">Редактор</option>
              <option value="viewer">Наблюдатель</option>
            </select>
            <Button type="submit" disabled={adding || email.trim().length === 0}>
              {adding ? 'Добавляем…' : 'Добавить'}
            </Button>
          </form>
        )}
      </CardContent>

      <Dialog open={pendingRemove !== null} onOpenChange={(o) => !o && setPendingRemove(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Удалить участника?</DialogTitle>
            <DialogDescription>
              {pendingRemove ? (
                <>
                  <span className="font-medium text-foreground">{pendingRemove.label}</span> потеряет
                  доступ к пространству и его проектам. Действие можно отменить, снова пригласив
                  участника.
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingRemove(null)}>
              Отмена
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                const id = pendingRemove?.userId;
                setPendingRemove(null);
                if (id) void handleRemove(id);
              }}
            >
              Удалить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function ProjectsCard({ workspaceId }: { workspaceId: string }): React.ReactElement {
  const { projects, loading, move } = useWorkspaceProjects(workspaceId);
  const { data: workspaces } = useWorkspaces();
  const targets = (workspaces ?? []).filter((w) => w.id !== workspaceId);

  const handleMove = async (projectId: string, targetId: string): Promise<void> => {
    if (!targetId) return;
    try {
      await move(projectId, targetId);
      toast.success('Проект перенесён');
    } catch (e) {
      toast.error((e as Error).message || 'Не удалось перенести проект');
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Проекты</CardTitle>
        <CardDescription>Проекты этого пространства. Перенос — только для&nbsp;владельца проекта.</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="h-16 animate-pulse rounded bg-muted" />
        ) : (projects?.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">В&nbsp;пространстве пока нет проектов.</p>
        ) : (
          <ul className="divide-y">
            {(projects ?? []).map((p) => (
              <li key={p.id} className="flex items-center gap-3 py-2">
                <WorkspaceIcon name={p.name} icon={p.icon} className="size-6" />
                <span className="min-w-0 flex-1 truncate text-sm">{p.name}</span>
                {targets.length > 0 && (
                  <select
                    className={ROLE_SELECT_CLASS}
                    defaultValue=""
                    onChange={(e) => {
                      const target = e.target.value;
                      e.target.value = '';
                      void handleMove(p.id, target);
                    }}
                    aria-label={`Перенести проект «${p.name}»`}
                  >
                    <option value="" disabled>
                      Перенести в…
                    </option>
                    {targets.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name}
                      </option>
                    ))}
                  </select>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function DangerZoneCard({
  workspaceId,
  workspaceName,
  projectCount,
  isLast,
  onDeleted,
}: {
  workspaceId: string;
  workspaceName: string;
  projectCount: number;
  isLast: boolean;
  onDeleted: () => void;
}): React.ReactElement {
  const { submit, saving } = useDeleteWorkspace();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const blockedReason =
    projectCount > 0
      ? 'Сначала перенесите или удалите проекты пространства.'
      : isLast
        ? 'Нельзя удалить единственное пространство.'
        : null;

  const doDelete = async (): Promise<void> => {
    try {
      await submit(workspaceId);
      toast.success('Пространство удалено');
      setConfirmOpen(false);
      onDeleted();
    } catch (e) {
      toast.error((e as Error).message || 'Не удалось удалить пространство');
    }
  };

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle className="text-destructive">Опасная зона</CardTitle>
        <CardDescription>Удаление пространства необратимо.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <Button
          variant="outline"
          className={cn('gap-2 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive')}
          disabled={blockedReason !== null}
          onClick={() => setConfirmOpen(true)}
        >
          <Trash2 className="size-4" />
          Удалить пространство
        </Button>
        {blockedReason && <p className="text-xs text-muted-foreground">{blockedReason}</p>}
      </CardContent>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Удалить «{workspaceName}»?</DialogTitle>
            <DialogDescription>
              Пространство будет удалено безвозвратно. Это действие нельзя отменить.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Отмена
            </Button>
            <Button
              variant="outline"
              className="gap-2 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
              disabled={saving}
              onClick={() => void doDelete()}
            >
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
              Удалить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function InvitesCard({ workspaceId }: { workspaceId: string }): React.ReactElement {
  const { workspaceRepository } = useContainer();
  const [invites, setInvites] = useState<WorkspaceInvite[] | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    workspaceRepository
      .listInvites(workspaceId)
      .then((list) => {
        if (!cancelled) setInvites(list);
      })
      .catch(() => {
        if (!cancelled) setInvites([]);
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceRepository, workspaceId]);

  const handleCreated = (invite: WorkspaceInvite): void => {
    setInvites((prev) => [...(prev ?? []), invite]);
    if (invite.url) {
      void navigator.clipboard.writeText(invite.url).then(
        () => toast.success('Ссылка скопирована'),
        () => toast.success('Приглашение создано'),
      );
    }
  };

  const copyUrl = async (invite: WorkspaceInvite): Promise<void> => {
    if (!invite.url) {
      // Для существующих pending-инвайтов сервер не отдаёт token/url — только в момент create.
      toast.error('Ссылка доступна только в момент создания. Отзови и создай новое.');
      return;
    }
    try {
      await navigator.clipboard.writeText(invite.url);
      toast.success('Скопировано');
    } catch {
      toast.error('Не удалось скопировать.');
    }
  };

  const revoke = async (invite: WorkspaceInvite): Promise<void> => {
    if (!window.confirm('Отозвать приглашение?')) return;
    try {
      await workspaceRepository.deleteInvite(workspaceId, invite.id);
      setInvites((prev) => (prev ?? []).filter((i) => i.id !== invite.id));
      toast.success('Приглашение отозвано');
    } catch (e) {
      toast.error(`Не удалось: ${(e as Error).message}`);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Приглашения</CardTitle>
        <CardDescription>
          Токен-ссылки в пространство: получатель открывает ссылку и получает доступ ко всем
          проектам. Срок действия — 7 дней.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button size="sm" variant="outline" onClick={() => setDialogOpen(true)}>
          <UserPlus className="size-4" />
          Создать приглашение
        </Button>
        {invites !== null && invites.length > 0 && (
          <ul className="divide-y">
            {invites.map((inv) => (
              <li key={inv.id} className="flex items-center gap-3 py-2">
                <div className="min-w-0 flex-1 text-sm">
                  <p className="truncate">
                    {inv.email ?? <span className="italic text-muted-foreground">без email</span>}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {inv.role === 'editor' ? 'редактор' : 'наблюдатель'} · истекает{' '}
                    {inv.expiresAt.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  onClick={() => void copyUrl(inv)}
                  aria-label="Скопировать ссылку"
                >
                  <Copy className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 text-destructive hover:text-destructive"
                  onClick={() => void revoke(inv)}
                  aria-label="Отозвать"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <InviteDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        workspaceId={workspaceId}
        onCreated={handleCreated}
      />
    </Card>
  );
}
