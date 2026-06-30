import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  Bot,
  CalendarClock,
  GitCommitHorizontal,
  History,
  Layers3,
  Loader2,
  RefreshCw,
  Rocket,
  Send,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Input } from '@/components/ui/input';
import { AutoGrowTextarea } from '@/components/ui/auto-grow-textarea';
import { Label } from '@/components/ui/label';
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
import { useContainer } from '@/infrastructure/di/container';
import type {
  AutomationConfig,
  AutomationLimitKind,
  DeployMethod,
  GitAuthorMode,
} from '@/domain/automation/AutomationConfig';
import type {
  DigestChannelKind,
  DigestGroupHistory,
  DigestTgTarget,
  SaveDigestSettingsInput,
} from '@/application/digest/DigestSettingsRepository';
import type { TaskStatus } from '@/domain/task/Task';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  // У проекта назначен диспетчер? Без него автоматизация не «оживёт» (некому выполнять).
  hasDispatcher: boolean;
  // Текущее значение «мультизадачного воркера» (на открытии — источник истины).
  multiTaskWorker: boolean;
};

type DraftCriterion = {
  key: string;
  label: string;
  enabled: boolean;
  systemPrompt: string;
  userHint: string;
};

type Draft = {
  enabled: boolean;
  limitKind: AutomationLimitKind;
  limitCount: number;
  limitMinutes: number;
  pauseMinMinutes: number;
  pauseMaxMinutes: number;
  // Публикация/деплой.
  gitAuthorMode: GitAuthorMode;
  gitAuthorName: string;
  gitAuthorEmail: string;
  ignoreClaudeMd: boolean;
  ultracodeReviewEnabled: boolean;
  deployMethod: DeployMethod;
  deployCommand: string;
  // Ежедневная авто-обработка статусов задач по коммитам (db/072).
  commitSyncEnabled: boolean;
  commitSyncHour: number;
  commitSyncMinute: number;
  commitSyncThresholdHours: number;
  criteria: DraftCriterion[];
};

const RUN_STATUS_LABEL: Record<AutomationConfig['runStatus'], string> = {
  idle: 'не запускалась',
  running: 'идёт',
  completed: 'лимит достигнут',
  stopped: 'остановлена',
};

// Дефолтная команда деплоя — она же placeholder поля ssh_manual (один источник, чтобы
// seed и плейсхолдер не разъехались).
const DEFAULT_DEPLOY_COMMAND = 'npm run deploy';

// Колонки-кандидаты для ежедневной сводки (визуальные статусы канбана).
const DIGEST_STATUS_OPTIONS: { status: TaskStatus; label: string }[] = [
  { status: 'backlog', label: 'Черновики' },
  { status: 'manual', label: 'Вручную' },
  { status: 'todo', label: 'Воркер' },
  { status: 'done', label: 'Готово' },
];

const DIGEST_CHANNEL_OPTIONS: { key: DigestChannelKind; label: string }[] = [
  { key: 'email', label: 'Почта' },
  { key: 'telegram', label: 'Telegram' },
  { key: 'notification', label: 'Уведомления на сайте' },
];

// Черновик настроек дайджеста (group chat_id храним строкой — допускаем '-100…').
type DigestDraft = {
  groupChatId: string;
  groupTitle: string;
  enabled: boolean;
  hour: number;
  minute: number;
  recipientUserIds: string[];
  channels: DigestChannelKind[];
  tgTargets: DigestTgTarget[];
  statuses: TaskStatus[];
};

// Набор «включённых автоматизаций», которыми управляет мастер-переключатель. Снимок
// сохраняется перед выключением мастера, чтобы при повторном включении вернуть как было.
type EnabledSet = {
  dispatcher: boolean;
  multiTaskWorker: boolean;
  digest: boolean;
  commitSync: boolean;
};

function toggle<T>(arr: T[], v: T): T[] {
  return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
}

// chat_id корректен (непустой и целочисленный — у групп отрицательный).
function isValidChatId(raw: string): boolean {
  const t = raw.trim();
  return t !== '' && Number.isInteger(Number(t));
}

// Черновик → payload сохранения (chat_id строкой → number|null).
function digestToPayload(d: DigestDraft): SaveDigestSettingsInput {
  return {
    telegramGroupChatId: d.groupChatId.trim() === '' ? null : Number(d.groupChatId.trim()),
    telegramGroupTitle: d.groupTitle.trim() || null,
    daily: {
      enabled: d.enabled,
      hour: d.hour,
      minute: d.minute,
      recipientUserIds: d.recipientUserIds,
      channels: d.channels,
      tgTargets: d.tgTargets,
      statuses: d.statuses,
    },
  };
}

// Карточка одной автоматизации/группы настроек. Шапка (иконка + заголовок + описание +
// опциональный Switch), под ней — раскрываемое тело. Единый каркас даёт чёткую визуальную
// сегментацию: каждый блок видно как самостоятельный.
function AutomationCard({
  icon: Icon,
  title,
  description,
  toggle: toggleProps,
  tone = 'default',
  children,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  toggle?: {
    checked: boolean;
    onCheckedChange: (v: boolean) => void;
    busy?: boolean;
    disabled?: boolean;
    ariaLabel?: string;
  };
  tone?: 'default' | 'master';
  children?: React.ReactNode;
}): React.ReactElement {
  const isMaster = tone === 'master';
  return (
    <section
      className={cn(
        'rounded-lg border bg-card shadow-sm transition-colors',
        isMaster && 'border-primary/40 bg-primary/[0.04]',
      )}
    >
      <div className="flex items-start gap-3 p-3.5">
        <span
          className={cn(
            'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md',
            isMaster ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground',
          )}
        >
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h3 className={cn('text-sm font-semibold leading-tight', isMaster && 'text-[0.95rem]')}>
              {title}
            </h3>
            {toggleProps?.busy && (
              <Loader2 className="size-3 animate-spin text-muted-foreground" />
            )}
          </div>
          {description && (
            <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{description}</p>
          )}
        </div>
        {toggleProps && (
          <Switch
            checked={toggleProps.checked}
            onCheckedChange={toggleProps.onCheckedChange}
            disabled={toggleProps.disabled}
            aria-label={toggleProps.ariaLabel ?? title}
          />
        )}
      </div>
      {children && <div className="border-t px-3.5 py-3">{children}</div>}
    </section>
  );
}

// Заголовок группы контролов внутри карточки (для подсекций: «Критерии», «Лимит» и т.д.).
function FieldGroupLabel({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </p>
  );
}

// Лёгкая строка-тумблер для вложенных переключателей внутри карточки (без собственной
// карточной обводки — чтобы читалось как часть блока, а не отдельный блок).
function NestedSwitchRow({
  title,
  description,
  checked,
  onCheckedChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
}): React.ReactElement {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md bg-muted/40 px-3 py-2.5">
      <div className="min-w-0">
        <Label className="text-sm font-medium">{title}</Label>
        <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} aria-label={title} />
    </div>
  );
}

function toDraft(config: AutomationConfig): Draft {
  return {
    enabled: config.enabled,
    limitKind: config.limitKind,
    limitCount: config.limitCount ?? 5,
    limitMinutes: config.limitMinutes ?? 60,
    pauseMinMinutes: Math.max(1, Math.round(config.pauseMinSeconds / 60)),
    pauseMaxMinutes: Math.max(1, Math.round(config.pauseMaxSeconds / 60)),
    gitAuthorMode: config.gitAuthorMode,
    gitAuthorName: config.gitAuthorName ?? '',
    gitAuthorEmail: config.gitAuthorEmail ?? '',
    ignoreClaudeMd: config.ignoreClaudeMd,
    ultracodeReviewEnabled: config.ultracodeReviewEnabled,
    deployMethod: config.deployMethod,
    deployCommand: config.deployCommand ?? DEFAULT_DEPLOY_COMMAND,
    commitSyncEnabled: config.commitSyncEnabled,
    commitSyncHour: config.commitSyncHour,
    commitSyncMinute: config.commitSyncMinute,
    commitSyncThresholdHours: config.commitSyncThresholdHours,
    criteria: config.criteria.map((c) => ({
      key: c.key,
      label: c.label,
      enabled: c.enabled,
      systemPrompt: c.systemPrompt,
      userHint: c.userHint ?? '',
    })),
  };
}

// Диалог настроек автоматизации. Сайт хранит конфиг + редактируемые промпты; диспетчер
// (ralph) сам генерирует и выполняет задачи, когда у проекта нет открытых задач.
export function AutomationDialog({
  open,
  onOpenChange,
  projectId,
  hasDispatcher,
  multiTaskWorker: multiTaskWorkerInitial,
}: Props): React.ReactElement {
  const { automationRepository, digestSettingsRepository, projectRepository } = useContainer();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [digest, setDigest] = useState<DigestDraft | null>(null);
  const [members, setMembers] = useState<{ id: string; name: string }[]>([]);
  const [sendingNow, setSendingNow] = useState(false);
  // Мультизадачный воркер сохраняется отдельным PATCH'ом сразу (как и раньше) — поэтому
  // держим его в собственном стейте, а не в draft. Мастер-переключатель агрегирует его.
  const [multiTaskWorker, setMultiTaskWorker] = useState(multiTaskWorkerInitial);
  const [mtwSaving, setMtwSaving] = useState(false);
  // История ранее введённых Telegram-групп юзера (подсказки для поля chat_id).
  const [groupHistory, setGroupHistory] = useState<DigestGroupHistory[]>([]);
  const [resolvingTitle, setResolvingTitle] = useState(false);
  const [runInfo, setRunInfo] = useState<Pick<
    AutomationConfig,
    'runStatus' | 'tasksCreated'
  > | null>(null);
  // Снимок набора включённых автоматизаций перед выключением мастера — чтобы повторное
  // включение мастера вернуло ровно то, что было (а не включало всё подряд).
  const lastEnabledSetRef = useRef<EnabledSet | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setMultiTaskWorker(multiTaskWorkerInitial);
    lastEnabledSetRef.current = null;
    Promise.all([
      automationRepository.get(projectId),
      digestSettingsRepository.get(projectId),
      projectRepository.listMembers(projectId).catch(() => []),
      digestSettingsRepository.listGroups(projectId).catch(() => [] as DigestGroupHistory[]),
    ])
      .then(([config, digestSettings, memberList, groups]) => {
        if (cancelled) return;
        setDraft(toDraft(config));
        setRunInfo({ runStatus: config.runStatus, tasksCreated: config.tasksCreated });
        setMembers(memberList.map((m) => ({ id: m.userId, name: m.user.displayName })));
        setGroupHistory(groups);
        setDigest({
          groupChatId: digestSettings.telegramGroupChatId === null
            ? ''
            : String(digestSettings.telegramGroupChatId),
          groupTitle: digestSettings.telegramGroupTitle ?? '',
          enabled: digestSettings.daily.enabled,
          hour: digestSettings.daily.hour,
          minute: digestSettings.daily.minute,
          recipientUserIds: digestSettings.daily.recipientUserIds,
          channels: digestSettings.daily.channels,
          tgTargets: digestSettings.daily.tgTargets,
          statuses: digestSettings.daily.statuses,
        });
      })
      .catch((e) => {
        if (!cancelled) setError(`Не удалось загрузить настройки: ${(e as Error).message}`);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    open,
    projectId,
    multiTaskWorkerInitial,
    automationRepository,
    digestSettingsRepository,
    projectRepository,
  ]);

  const updateDigest = (patch: Partial<DigestDraft>): void => {
    setDigest((prev) => (prev ? { ...prev, ...patch } : prev));
  };

  const update = (patch: Partial<Draft>): void => {
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev));
  };

  const updateCriterion = (key: string, patch: Partial<DraftCriterion>): void => {
    setDraft((prev) =>
      prev
        ? {
            ...prev,
            criteria: prev.criteria.map((c) => (c.key === key ? { ...c, ...patch } : c)),
          }
        : prev,
    );
  };

  // Мультизадачный воркер — оптимистичный PATCH сразу (без кнопки «Сохранить»), как и раньше.
  const toggleMultiTaskWorker = async (next: boolean): Promise<void> => {
    if (mtwSaving) return;
    setMtwSaving(true);
    setMultiTaskWorker(next); // оптимистично
    try {
      const updated = await projectRepository.setMultiTaskWorker(projectId, next);
      setMultiTaskWorker(updated.multiTaskWorker);
    } catch (err) {
      setMultiTaskWorker(!next); // откат
      toast.error((err as Error).message ?? 'Не удалось сохранить');
    } finally {
      setMtwSaving(false);
    }
  };

  // Мастер-переключатель — ПРОИЗВОДНОЕ состояние: включён, если включена хотя бы одна из
  // агрегируемых автоматизаций (диспетчер, мультизадачный воркер, ежедневная сводка,
  // авто-обработка по коммитам).
  const masterOn =
    !!draft &&
    (draft.enabled ||
      multiTaskWorker ||
      (digest?.enabled ?? false) ||
      draft.commitSyncEnabled);

  // Действие мастера:
  //  • выключение → запоминаем текущий набор и выключаем ВСЕ агрегируемые автоматизации;
  //  • включение → восстанавливаем последний запомненный набор; если его не было
  //    (всё всегда было выключено) — включаем минимально только диспетчер.
  // Изменения диспетчера/сводки/коммит-синка идут в черновик (применятся по «Сохранить»);
  // мультизадачный воркер сохраняется сразу (его собственный PATCH).
  const handleMasterToggle = (next: boolean): void => {
    if (!draft) return;
    if (!next) {
      lastEnabledSetRef.current = {
        dispatcher: draft.enabled,
        multiTaskWorker,
        digest: digest?.enabled ?? false,
        commitSync: draft.commitSyncEnabled,
      };
      update({ enabled: false, commitSyncEnabled: false });
      if (digest?.enabled) updateDigest({ enabled: false });
      if (multiTaskWorker) void toggleMultiTaskWorker(false);
      return;
    }
    const prev = lastEnabledSetRef.current;
    const hasPrev =
      !!prev && (prev.dispatcher || prev.multiTaskWorker || prev.digest || prev.commitSync);
    const restore: EnabledSet = hasPrev
      ? prev!
      : { dispatcher: true, multiTaskWorker: false, digest: false, commitSync: false };
    update({ enabled: restore.dispatcher, commitSyncEnabled: restore.commitSync });
    if (digest) updateDigest({ enabled: restore.digest });
    if (restore.multiTaskWorker !== multiTaskWorker) void toggleMultiTaskWorker(restore.multiTaskWorker);
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (!draft) return;

    // Валидация перед сохранением.
    if (draft.pauseMaxMinutes < draft.pauseMinMinutes) {
      setError('Максимальная пауза не может быть меньше минимальной');
      return;
    }
    if (draft.enabled && !draft.criteria.some((c) => c.enabled)) {
      setError('Выберите хотя бы один критерий');
      return;
    }
    if (
      draft.gitAuthorMode === 'custom' &&
      (draft.gitAuthorName.trim().length === 0 || draft.gitAuthorEmail.trim().length === 0)
    ) {
      setError('Укажите имя и email для своего git-автора');
      return;
    }
    if (draft.deployMethod === 'ssh_manual' && draft.deployCommand.trim().length === 0) {
      setError('Укажите команду деплоя для SSH-метода');
      return;
    }
    if (digest && digest.groupChatId.trim() !== '' && !Number.isInteger(Number(digest.groupChatId.trim()))) {
      setError('ID Telegram-группы должен быть целым числом (для групп он отрицательный)');
      return;
    }
    if (digest && digest.enabled && digest.recipientUserIds.length === 0 && !digest.tgTargets.includes('group')) {
      setError('Выберите получателей ежедневной сводки (или отправку в группу)');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const updated = await automationRepository.save(projectId, {
        enabled: draft.enabled,
        limitKind: draft.limitKind,
        limitCount: draft.limitKind === 'count' ? draft.limitCount : null,
        limitMinutes: draft.limitKind === 'time' ? draft.limitMinutes : null,
        pauseMinSeconds: draft.pauseMinMinutes * 60,
        pauseMaxSeconds: draft.pauseMaxMinutes * 60,
        ralphMode: 'silent',
        gitAuthorMode: draft.gitAuthorMode,
        gitAuthorName:
          draft.gitAuthorMode === 'custom' ? draft.gitAuthorName.trim() : null,
        gitAuthorEmail:
          draft.gitAuthorMode === 'custom' ? draft.gitAuthorEmail.trim() : null,
        ignoreClaudeMd: draft.ignoreClaudeMd,
        ultracodeReviewEnabled: draft.ultracodeReviewEnabled,
        deployMethod: draft.deployMethod,
        deployCommand:
          draft.deployMethod === 'ssh_manual' ? draft.deployCommand.trim() : null,
        commitSyncEnabled: draft.commitSyncEnabled,
        commitSyncHour: draft.commitSyncHour,
        commitSyncMinute: draft.commitSyncMinute,
        commitSyncThresholdHours: draft.commitSyncThresholdHours,
        criteria: draft.criteria.map((c) => ({
          key: c.key,
          enabled: c.enabled,
          systemPrompt: c.systemPrompt,
          userHint: c.userHint.trim().length > 0 ? c.userHint : null,
        })),
      });
      setRunInfo({ runStatus: updated.runStatus, tasksCreated: updated.tasksCreated });
      if (digest) {
        await digestSettingsRepository.save(projectId, digestToPayload(digest));
      }
      onOpenChange(false);
      toast.success(
        draft.enabled ? 'Автоматизация включена' : 'Настройки автоматизации сохранены',
      );
    } catch (err) {
      setError(`Не удалось сохранить: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  // «Отправить сейчас»: сохраняет текущие настройки и шлёт сводку немедленно (тест).
  const handleSendNow = async (): Promise<void> => {
    if (!digest || sendingNow) return;
    if (digest.groupChatId.trim() !== '' && !Number.isInteger(Number(digest.groupChatId.trim()))) {
      setError('ID Telegram-группы должен быть целым числом (для групп он отрицательный)');
      return;
    }
    if (digest.recipientUserIds.length === 0 && !digest.tgTargets.includes('group')) {
      setError('Выберите получателей сводки (или отправку в группу)');
      return;
    }
    setSendingNow(true);
    setError(null);
    try {
      await digestSettingsRepository.save(projectId, digestToPayload(digest));
      const res = await digestSettingsRepository.sendNow(projectId);
      if (res.taskCount > 0) toast.success(`Сводка отправлена (${res.taskCount} задач)`);
      else toast.message('В выбранных колонках нет задач — отправлять нечего');
    } catch (e) {
      setError(`Не удалось отправить: ${(e as Error).message}`);
    } finally {
      setSendingNow(false);
    }
  };

  // Резолв названия группы по chat_id через бота (getChat). Мягкий фоллбэк — не валит UI.
  const handleResolveTitle = async (): Promise<void> => {
    if (!digest || resolvingTitle) return;
    if (!isValidChatId(digest.groupChatId)) {
      setError('Сначала укажите корректный chat_id группы');
      return;
    }
    setResolvingTitle(true);
    setError(null);
    try {
      const { title } = await digestSettingsRepository.resolveGroupTitle(
        projectId,
        Number(digest.groupChatId.trim()),
      );
      if (title) {
        updateDigest({ groupTitle: title });
        toast.success(`Название получено: ${title}`);
      } else {
        toast.message('Не удалось получить название — бот не в группе или нет прав');
      }
    } catch (e) {
      setError(`Не удалось получить название: ${(e as Error).message}`);
    } finally {
      setResolvingTitle(false);
    }
  };

  const chatIdValid = !!digest && isValidChatId(digest.groupChatId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="size-5" />
            Автоматизация проекта
          </DialogTitle>
        </DialogHeader>

        <p className="text-xs leading-snug text-muted-foreground">
          Когда у проекта нет открытых задач, диспетчер сам генерирует новые задачи по выбранным
          критериям и выполняет их в тихом режиме — с паузами между задачами, по кругу, пока не
          достигнут лимит.
        </p>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Загрузка…
          </div>
        ) : !draft ? (
          <p className="py-6 text-sm text-destructive">{error ?? 'Нет данных'}</p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            {/* МАСТЕР — агрегирует диспетчер, мультизадачный воркер, ежедневную сводку и
                авто-обработку по коммитам. Производное состояние master = OR(всех). */}
            <AutomationCard
              icon={Bot}
              tone="master"
              title="Включить автоматизацию"
              description="Общий переключатель. Включён, если активна хотя бы одна автоматизация ниже; выключение — остановит все."
              toggle={{
                checked: masterOn,
                onCheckedChange: handleMasterToggle,
                ariaLabel: 'Включить автоматизацию',
              }}
            >
              {!hasDispatcher ? (
                <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs leading-snug text-amber-700 dark:text-amber-400">
                  У проекта не назначен диспетчер. Автоматизация сохранится, но задачи начнут
                  создаваться и выполняться только после назначения диспетчера в «Настройках».
                </p>
              ) : undefined}
            </AutomationCard>

            {/* ДИСПЕТЧЕР — генерация задач по критериям + лимит/пауза. */}
            <AutomationCard
              icon={Sparkles}
              title="Диспетчер задач"
              description="Сам генерирует и выполняет задачи по критериям, когда доска пуста."
              toggle={{
                checked: draft.enabled,
                onCheckedChange: (v) => update({ enabled: v }),
                ariaLabel: 'Диспетчер задач',
              }}
            >
              <div className="space-y-4">
                {/* Критерии */}
                <div className="space-y-2">
                  <FieldGroupLabel>Критерии задач</FieldGroupLabel>
                  <div className="space-y-2">
                    {draft.criteria.map((c) => (
                      <div key={c.key} className="rounded-md border bg-background">
                        <label className="flex cursor-pointer items-center gap-2.5 px-3 py-2.5">
                          <Checkbox
                            checked={c.enabled}
                            onCheckedChange={(v) => updateCriterion(c.key, { enabled: v === true })}
                          />
                          <span className="text-sm">{c.label}</span>
                        </label>
                        {c.enabled && (
                          <div className="space-y-2 border-t px-3 py-2.5">
                            <div className="space-y-1">
                              <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
                                Системный промпт
                              </Label>
                              <AutoGrowTextarea
                                minRows={4}
                                value={c.systemPrompt}
                                maxLength={8000}
                                onChange={(e) =>
                                  updateCriterion(c.key, { systemPrompt: e.target.value })
                                }
                                className="block w-full rounded-md border bg-transparent px-2 py-1.5 text-xs leading-snug focus:outline-none focus:ring-2 focus:ring-ring"
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
                                Уточнение (что именно хотите)
                              </Label>
                              <AutoGrowTextarea
                                minRows={2}
                                value={c.userHint}
                                maxLength={2000}
                                placeholder="Напр. фичи лендинга: чат, фильтрации, маркетинг"
                                onChange={(e) => updateCriterion(c.key, { userHint: e.target.value })}
                                className="block w-full rounded-md border bg-transparent px-2 py-1.5 text-xs leading-snug placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-ring"
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Лимит */}
                <div className="space-y-2">
                  <FieldGroupLabel>Лимит</FieldGroupLabel>
                  <RadioGroup
                    value={draft.limitKind}
                    onValueChange={(v) => update({ limitKind: v as AutomationLimitKind })}
                    className="gap-2"
                  >
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value="count" id="limit-count" />
                      <Label htmlFor="limit-count" className="text-sm font-normal">
                        По количеству задач
                      </Label>
                      {draft.limitKind === 'count' && (
                        <Input
                          type="number"
                          min={1}
                          max={1000}
                          value={draft.limitCount}
                          onChange={(e) =>
                            update({ limitCount: Math.max(1, Number(e.target.value) || 1) })
                          }
                          className="ml-auto h-8 w-24"
                        />
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value="time" id="limit-time" />
                      <Label htmlFor="limit-time" className="text-sm font-normal">
                        По времени (минут от первой задачи)
                      </Label>
                      {draft.limitKind === 'time' && (
                        <Input
                          type="number"
                          min={1}
                          max={100000}
                          value={draft.limitMinutes}
                          onChange={(e) =>
                            update({ limitMinutes: Math.max(1, Number(e.target.value) || 1) })
                          }
                          className="ml-auto h-8 w-24"
                        />
                      )}
                    </div>
                  </RadioGroup>
                </div>

                {/* Паузы */}
                <div className="space-y-2">
                  <FieldGroupLabel>Пауза между задачами (эмуляция человека)</FieldGroupLabel>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground">от</span>
                    <Input
                      type="number"
                      min={0}
                      max={1440}
                      value={draft.pauseMinMinutes}
                      onChange={(e) =>
                        update({ pauseMinMinutes: Math.max(0, Number(e.target.value) || 0) })
                      }
                      className="h-8 w-20"
                    />
                    <span className="text-muted-foreground">до</span>
                    <Input
                      type="number"
                      min={0}
                      max={1440}
                      value={draft.pauseMaxMinutes}
                      onChange={(e) =>
                        update({ pauseMaxMinutes: Math.max(0, Number(e.target.value) || 0) })
                      }
                      className="h-8 w-20"
                    />
                    <span className="text-muted-foreground">мин</span>
                  </div>
                </div>
              </div>
            </AutomationCard>

            {/* МУЛЬТИЗАДАЧНЫЙ ВОРКЕР — отдельный PATCH сразу. */}
            <AutomationCard
              icon={Layers3}
              title="Мультизадачный воркер"
              description="Диспетчер ведёт до 3 задач проекта параллельно."
              toggle={{
                checked: multiTaskWorker,
                onCheckedChange: (v) => void toggleMultiTaskWorker(v),
                busy: mtwSaving,
                disabled: mtwSaving,
                ariaLabel: 'Мультизадачный воркер',
              }}
            />

            {/* ПУБЛИКАЦИЯ И ДЕПЛОЙ — как воркер коммитит и катит изменения (не агрегируется мастером). */}
            <AutomationCard
              icon={Rocket}
              title="Публикация и деплой"
              description="Как воркер подписывает коммиты и выкатывает изменения в прод."
            >
              <div className="space-y-4">
                {/* Автор git-коммитов */}
                <div className="space-y-2">
                  <FieldGroupLabel>Автор git-коммитов</FieldGroupLabel>
                  <RadioGroup
                    value={draft.gitAuthorMode}
                    onValueChange={(v) => update({ gitAuthorMode: v as GitAuthorMode })}
                    className="gap-2"
                  >
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value="bot" id="author-bot" />
                      <Label htmlFor="author-bot" className="text-sm font-normal">
                        Бот ProjectsFlow
                      </Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value="owner" id="author-owner" />
                      <Label htmlFor="author-owner" className="text-sm font-normal">
                        Владелец проекта
                      </Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value="custom" id="author-custom" />
                      <Label htmlFor="author-custom" className="text-sm font-normal">
                        Своё имя и email
                      </Label>
                    </div>
                  </RadioGroup>
                  {draft.gitAuthorMode === 'custom' && (
                    <div className="space-y-2 rounded-md border bg-background px-3 py-2.5">
                      <div className="space-y-1">
                        <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
                          Имя автора
                        </Label>
                        <Input
                          value={draft.gitAuthorName}
                          maxLength={120}
                          placeholder="Напр. ProjectsFlow Bot"
                          onChange={(e) => update({ gitAuthorName: e.target.value })}
                          className="h-8"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
                          Email автора
                        </Label>
                        <Input
                          type="email"
                          value={draft.gitAuthorEmail}
                          maxLength={254}
                          placeholder="bot@example.com"
                          onChange={(e) => update({ gitAuthorEmail: e.target.value })}
                          className="h-8"
                        />
                      </div>
                    </div>
                  )}
                  {draft.gitAuthorMode === 'owner' && (
                    <p className="text-[11px] text-muted-foreground">
                      В публичных коммитах будут видны имя и email владельца проекта.
                    </p>
                  )}
                </div>

                {/* Флаги публикации */}
                <div className="space-y-2">
                  <NestedSwitchRow
                    title="Игнорировать ритуал CLAUDE.md"
                    description="Воркер не добавит «Co-Authored-By» и пропустит kanban-ритуал проекта — коммит только под выбранным автором."
                    checked={draft.ignoreClaudeMd}
                    onCheckedChange={(v) => update({ ignoreClaudeMd: v })}
                  />
                  <NestedSwitchRow
                    title="Проверка UltraCode перед прод-пушем"
                    description="Перед push в прод — проверка совместимости от Claude Opus. При найденных проблемах задача блокируется, push и деплой не выполняются."
                    checked={draft.ultracodeReviewEnabled}
                    onCheckedChange={(v) => update({ ultracodeReviewEnabled: v })}
                  />
                </div>

                {/* Деплой */}
                <div className="space-y-2">
                  <FieldGroupLabel>Деплой в прод</FieldGroupLabel>
                  <RadioGroup
                    value={draft.deployMethod}
                    onValueChange={(v) => update({ deployMethod: v as DeployMethod })}
                    className="gap-2"
                  >
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value="github_auto" id="deploy-github" />
                      <Label htmlFor="deploy-github" className="text-sm font-normal">
                        Автодеплой GitHub (по push)
                      </Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value="ssh_manual" id="deploy-ssh" />
                      <Label htmlFor="deploy-ssh" className="text-sm font-normal">
                        Своя команда (build + ssh-деплой)
                      </Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <RadioGroupItem value="none" id="deploy-none" />
                      <Label htmlFor="deploy-none" className="text-sm font-normal">
                        Не деплоить
                      </Label>
                    </div>
                  </RadioGroup>
                  {draft.deployMethod === 'ssh_manual' && (
                    <div className="space-y-1">
                      <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        Команда деплоя (в корне проекта, после каждой задачи)
                      </Label>
                      <Input
                        value={draft.deployCommand}
                        maxLength={500}
                        placeholder={DEFAULT_DEPLOY_COMMAND}
                        onChange={(e) => update({ deployCommand: e.target.value })}
                        className="h-8 font-mono text-xs"
                      />
                    </div>
                  )}
                </div>
              </div>
            </AutomationCard>

            {/* TELEGRAM-ГРУППА — chat_id с историей подсказок + резолв названия через бота. */}
            <AutomationCard
              icon={Send}
              title="Telegram-группа проекта"
              description="Куда отправлять сводку «в группу» и экспорт задач. Бот ProjectsFlow_Bot должен быть в группе."
            >
              <div className="space-y-2">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      chat_id
                    </Label>
                    <div className="flex gap-1.5">
                      <Input
                        value={digest?.groupChatId ?? ''}
                        placeholder="-1003920622527"
                        inputMode="numeric"
                        onChange={(e) => updateDigest({ groupChatId: e.target.value })}
                        className="h-8 flex-1 font-mono text-xs"
                      />
                      {groupHistory.length > 0 && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              className="size-8 shrink-0"
                              title="Ранее введённые группы"
                              aria-label="Ранее введённые группы"
                            >
                              <History className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="max-h-64 w-64 overflow-auto">
                            <DropdownMenuLabel>Ранее введённые группы</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            {groupHistory.map((g) => (
                              <DropdownMenuItem
                                key={g.chatId}
                                onSelect={() =>
                                  updateDigest({
                                    groupChatId: String(g.chatId),
                                    // Подставляем известное название, если оно есть.
                                    ...(g.title ? { groupTitle: g.title } : {}),
                                  })
                                }
                              >
                                <div className="flex min-w-0 flex-col">
                                  <span className="truncate text-sm">
                                    {g.title || 'Без названия'}
                                  </span>
                                  <span className="font-mono text-[11px] text-muted-foreground">
                                    {g.chatId}
                                  </span>
                                </div>
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      Название (опц.)
                    </Label>
                    <div className="flex gap-1.5">
                      <Input
                        value={digest?.groupTitle ?? ''}
                        placeholder="Команда проекта"
                        maxLength={255}
                        onChange={(e) => updateDigest({ groupTitle: e.target.value })}
                        className="h-8 flex-1"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="size-8 shrink-0"
                        disabled={resolvingTitle || !chatIdValid}
                        onClick={() => void handleResolveTitle()}
                        title="Получить название группы из Telegram"
                        aria-label="Получить название группы из Telegram"
                      >
                        {resolvingTitle ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <RefreshCw className="size-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                </div>
                <p className="text-[11px] leading-snug text-muted-foreground">
                  chat_id групп отрицательный (супергруппа начинается с −100). Кнопка
                  <RefreshCw className="mx-1 inline size-3 align-text-bottom" />
                  подтянет название группы через бота; история
                  <History className="mx-1 inline size-3 align-text-bottom" />
                  показывает ранее введённые ID.
                </p>
              </div>
            </AutomationCard>

            {/* ЕЖЕДНЕВНАЯ СВОДКА — агрегируется мастером. */}
            <AutomationCard
              icon={CalendarClock}
              title="Ежедневная сводка по задачам"
              description="Каждый день в заданное время — сводка по выбранным колонкам выбранным получателям."
              toggle={{
                checked: digest?.enabled ?? false,
                onCheckedChange: (v) => updateDigest({ enabled: v }),
                ariaLabel: 'Ежедневная сводка по задачам',
              }}
            >
              {digest?.enabled ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground">Время (МSK)</span>
                    <Input
                      type="number"
                      min={0}
                      max={23}
                      value={digest.hour}
                      onChange={(e) =>
                        updateDigest({ hour: Math.min(23, Math.max(0, Number(e.target.value) || 0)) })
                      }
                      className="h-8 w-16"
                    />
                    <span>:</span>
                    <Input
                      type="number"
                      min={0}
                      max={59}
                      value={digest.minute}
                      onChange={(e) =>
                        updateDigest({ minute: Math.min(59, Math.max(0, Number(e.target.value) || 0)) })
                      }
                      className="h-8 w-16"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <FieldGroupLabel>Кому</FieldGroupLabel>
                    {members.length === 0 ? (
                      <p className="text-xs text-muted-foreground">Нет участников проекта.</p>
                    ) : (
                      <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                        {members.map((m) => (
                          <label key={m.id} className="flex items-center gap-2 text-sm">
                            <Checkbox
                              checked={digest.recipientUserIds.includes(m.id)}
                              onCheckedChange={() =>
                                updateDigest({ recipientUserIds: toggle(digest.recipientUserIds, m.id) })
                              }
                            />
                            <span className="truncate">{m.name}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <FieldGroupLabel>Куда</FieldGroupLabel>
                    <div className="flex flex-wrap gap-3">
                      {DIGEST_CHANNEL_OPTIONS.map((c) => (
                        <label key={c.key} className="flex items-center gap-2 text-sm">
                          <Checkbox
                            checked={digest.channels.includes(c.key)}
                            onCheckedChange={() => updateDigest({ channels: toggle(digest.channels, c.key) })}
                          />
                          <span>{c.label}</span>
                        </label>
                      ))}
                    </div>
                    {digest.channels.includes('telegram') && (
                      <div className="flex flex-wrap gap-3 pl-1 pt-1">
                        <label className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Checkbox
                            checked={digest.tgTargets.includes('personal')}
                            onCheckedChange={() =>
                              updateDigest({ tgTargets: toggle(digest.tgTargets, 'personal') })
                            }
                          />
                          <span>в личку каждому</span>
                        </label>
                        <label className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Checkbox
                            checked={digest.tgTargets.includes('group')}
                            onCheckedChange={() => updateDigest({ tgTargets: toggle(digest.tgTargets, 'group') })}
                          />
                          <span>в группу</span>
                        </label>
                      </div>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <FieldGroupLabel>Какие колонки</FieldGroupLabel>
                    <div className="flex flex-wrap gap-3">
                      {DIGEST_STATUS_OPTIONS.map((s) => (
                        <label key={s.status} className="flex items-center gap-2 text-sm">
                          <Checkbox
                            checked={digest.statuses.includes(s.status)}
                            onCheckedChange={() => updateDigest({ statuses: toggle(digest.statuses, s.status) })}
                          />
                          <span>{s.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 border-t pt-2.5">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={sendingNow || saving}
                      onClick={() => void handleSendNow()}
                    >
                      {sendingNow ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Send className="size-4" />
                      )}
                      Отправить сейчас
                    </Button>
                    <span className="text-[11px] text-muted-foreground">
                      сохранит настройки и отправит сводку сразу
                    </span>
                  </div>
                </div>
              ) : undefined}
            </AutomationCard>

            {/* АВТО-ОБРАБОТКА ПО КОММИТАМ (db/072) — агрегируется мастером. */}
            <AutomationCard
              icon={GitCommitHorizontal}
              title="Авто-обработка статусов по коммитам"
              description="Раз в день ИИ сопоставляет коммиты GitHub с задачами и двигает их статус по возрасту коммита."
              toggle={{
                checked: draft.commitSyncEnabled,
                onCheckedChange: (v) => update({ commitSyncEnabled: v }),
                ariaLabel: 'Авто-обработка статусов по коммитам',
              }}
            >
              {draft.commitSyncEnabled ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground">Время (МSK)</span>
                    <Input
                      type="number"
                      min={0}
                      max={23}
                      value={draft.commitSyncHour}
                      onChange={(e) =>
                        update({ commitSyncHour: Math.min(23, Math.max(0, Number(e.target.value) || 0)) })
                      }
                      className="h-8 w-16"
                    />
                    <span>:</span>
                    <Input
                      type="number"
                      min={0}
                      max={59}
                      value={draft.commitSyncMinute}
                      onChange={(e) =>
                        update({ commitSyncMinute: Math.min(59, Math.max(0, Number(e.target.value) || 0)) })
                      }
                      className="h-8 w-16"
                    />
                  </div>

                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground">Порог (часов)</span>
                    <Input
                      type="number"
                      min={1}
                      max={8760}
                      value={draft.commitSyncThresholdHours}
                      onChange={(e) =>
                        update({
                          commitSyncThresholdHours: Math.min(8760, Math.max(1, Number(e.target.value) || 1)),
                        })
                      }
                      className="h-8 w-20"
                    />
                  </div>

                  <p className="text-[11px] leading-snug text-muted-foreground">
                    Коммит свежее порога → задача в «В работе»; старше → «Готово». Сопоставление коммитов
                    и задач делает ИИ.
                  </p>
                </div>
              ) : undefined}
            </AutomationCard>

            {/* Прогресс */}
            {runInfo && runInfo.runStatus !== 'idle' && (
              <p className="text-xs text-muted-foreground">
                Прогресс: создано задач — {runInfo.tasksCreated}; статус —{' '}
                {RUN_STATUS_LABEL[runInfo.runStatus]}.
              </p>
            )}

            {error && <p className="text-xs text-destructive">{error}</p>}

            <div className="flex justify-end gap-2 border-t pt-3">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onOpenChange(false)}
                disabled={saving}
              >
                Отмена
              </Button>
              <Button type="submit" size="sm" disabled={saving}>
                {saving ? 'Сохраняем…' : 'Сохранить'}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
