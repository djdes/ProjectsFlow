import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { useMotion } from '@/presentation/components/motion/MotionProvider';
import {
  Bot,
  CalendarOff,
  ChevronDown,
  Columns3,
  Copy,
  Flag,
  Loader2,
  Mail,
  Send,
  SendHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
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
import type { SharedMember } from '@/application/project/ProjectRepository';
import { PRIORITY_META } from '@/domain/task/priorityMeta';
import {
  RALPH_MODES,
  RALPH_MODE_META,
  type TaskPriority,
  type TaskStatus,
} from '@/domain/task/Task';
import { DeadlinePicker } from './DeadlinePicker';
import { RecipientPickerDialog } from './RecipientPickerDialog';
import { copyTextFromPromise } from './copyToClipboard';
import type { DigestChannel, DigestRecipient } from '@/application/task/TaskRepository';
import type { BulkResult, BulkTaskActions } from '@/presentation/hooks/useBulkTaskActions';

const ALL_PRIORITIES: readonly TaskPriority[] = [1, 2, 3, 4];

type MoveTarget = { status: TaskStatus; label: string };

type Props = {
  // Выбранные id (в визуальном порядке колонки).
  selectedIds: string[];
  projectId: string;
  isInbox: boolean;
  currentUserId: string | null;
  // Колонки-цели для «В колонку» (видимые, с резолвнутыми подписями).
  moveTargets: MoveTarget[];
  bulk: BulkTaskActions;
  onExit: () => void;
};

// Плавающая панель массовых действий (появляется при N ≥ 1 выбранных). Слева —
// счётчик, далее мутации (делегировать/дедлайн/приоритет/в колонку/Ralph/удалить).
// Кнопки экспорта (копировать/почта/Telegram) добавляются в Фазе 2.
export function BulkActionBar({
  selectedIds,
  projectId,
  isInbox,
  currentUserId,
  moveTargets,
  bulk,
  onExit,
}: Props): React.ReactElement | null {
  const { projectRepository, taskRepository, digestSettingsRepository } = useContainer();
  const [members, setMembers] = useState<SharedMember[] | null>(null);
  const [group, setGroup] = useState<{ chatId: number | null; title: string | null }>({
    chatId: null,
    title: null,
  });
  const [busy, setBusy] = useState(false);
  // Открытый канал отправки (диалог получателей) + индикатор отправки.
  const [exportChannel, setExportChannel] = useState<Exclude<DigestChannel, 'clipboard'> | null>(null);
  const [exporting, setExporting] = useState(false);
  const { animations } = useMotion();

  // Подгружаем участников для делегирования (как в DelegateTaskButton).
  useEffect(() => {
    let cancelled = false;
    const load = isInbox
      ? projectRepository.listSharedMembers()
      : projectRepository.listMembers(projectId).then((list) =>
          list
            .filter((m) => m.userId !== currentUserId)
            .map((m) => ({ id: m.userId, displayName: m.user.displayName, email: m.user.email })),
        );
    load
      .then((list) => {
        if (!cancelled) setMembers(list);
      })
      .catch(() => {
        if (!cancelled) setMembers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [projectRepository, projectId, isInbox, currentUserId]);

  // Telegram-группа проекта (для опции «В группу» при отправке в Telegram).
  useEffect(() => {
    let cancelled = false;
    digestSettingsRepository
      .get(projectId)
      .then((s) => {
        if (!cancelled) setGroup({ chatId: s.telegramGroupChatId, title: s.telegramGroupTitle });
      })
      .catch(() => {
        /* нет настроек — опции группы просто не будет */
      });
    return () => {
      cancelled = true;
    };
  }, [digestSettingsRepository, projectId]);

  const count = selectedIds.length;
  if (count === 0) return null;

  // Выполнить массовое действие: toast по результату, выход из режима при полном успехе.
  const run = async (label: string, fn: () => Promise<BulkResult>): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fn();
      if (res.failed === 0) {
        toast.success(`${label}: ${res.ok}`);
        onExit();
      } else {
        toast.error(`${label}: ${res.ok} из ${res.ok + res.failed}, не удалось ${res.failed}`);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = (): void => {
    if (busy) return;
    if (!window.confirm(`Удалить выбранные задачи (${count})?`)) return;
    void run('Удалено', () => bulk.remove(selectedIds));
  };

  const disabled = busy || exporting;

  // Копирование: запрос стартует синхронно в onClick (сохраняем user-gesture для буфера).
  const handleCopy = (): void => {
    if (disabled) return;
    const produce = taskRepository
      .digest(projectId, { taskIds: selectedIds, channel: 'clipboard' })
      .then((r) => r.text);
    void copyTextFromPromise(produce)
      .then(() => toast.success('Скопировано в буфер'))
      .catch(() => toast.error('Не удалось скопировать'));
  };

  // Отправка дайджеста выбранным получателям (email/Telegram).
  const handleSend = async (recipients: DigestRecipient[]): Promise<void> => {
    if (!exportChannel || exporting) return;
    setExporting(true);
    try {
      const res = await taskRepository.digest(projectId, {
        taskIds: selectedIds,
        channel: exportChannel,
        recipients,
      });
      const sent = res.delivery?.delivered.length ?? 0;
      const skipped = res.delivery?.skipped.length ?? 0;
      if (sent > 0 && skipped === 0) toast.success(`Отправлено: ${sent}`);
      else if (sent > 0) toast.success(`Отправлено: ${sent}, пропущено: ${skipped}`);
      else toast.error(skipped > 0 ? `Не доставлено (пропущено ${skipped})` : 'Не отправлено');
      setExportChannel(null);
    } catch (e) {
      toast.error(`Не удалось отправить: ${(e as Error).message}`);
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <div className="pointer-events-none fixed inset-x-0 bottom-[calc(4.5rem_+_env(safe-area-inset-bottom))] z-50 flex justify-center px-3 md:bottom-4">
        <motion.div
          initial={animations ? { y: 18, scale: 0.95, opacity: 0 } : false}
          animate={{ y: 0, scale: 1, opacity: 1 }}
          transition={animations ? { type: 'spring', stiffness: 440, damping: 30 } : { duration: 0 }}
          className="pointer-events-auto flex max-w-full flex-wrap items-center gap-1 rounded-xl border bg-card/95 p-1.5 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-card/80"
        >
        <span className="px-2 text-xs font-medium tabular-nums">
          {disabled ? <Loader2 className="inline size-3.5 animate-spin" /> : `Выбрано ${count}`}
        </span>
        <span className="mx-0.5 h-5 w-px bg-border" aria-hidden />

        {/* Делегировать */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" disabled={disabled} className="h-8 gap-1.5 px-2 text-xs">
              <Send className="size-3.5" />
              Делегировать
              <ChevronDown className="size-3 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[240px]">
            {(members ?? []).length > 0 ? (
              <>
                <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  Кому делегировать
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {(members ?? []).map((m) => (
                  <DropdownMenuItem
                    key={m.id}
                    className="gap-2"
                    onClick={() => void run('Делегировано', () => bulk.delegate(selectedIds, m.id))}
                  >
                    <span className="truncate">{m.displayName}</span>
                    <span className="ml-auto truncate text-[10px] text-muted-foreground">
                      {m.email}
                    </span>
                  </DropdownMenuItem>
                ))}
              </>
            ) : (
              <div className="px-2 py-1.5 text-xs text-muted-foreground">
                {members === null ? 'Загрузка…' : 'Нет участников для делегирования.'}
              </div>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Дедлайн: выбрать дату (нативный пикер) + снять срок */}
        <DeadlinePicker
          value={null}
          disabled={disabled}
          onChange={(d) => {
            if (d) void run('Срок задан', () => bulk.setDeadline(selectedIds, d));
          }}
        />
        <Button
          variant="ghost"
          size="icon"
          disabled={disabled}
          className="size-8 text-muted-foreground hover:text-foreground"
          onClick={() => void run('Срок снят', () => bulk.setDeadline(selectedIds, null))}
          aria-label="Снять срок у выбранных"
          title="Снять срок"
        >
          <CalendarOff className="size-3.5" />
        </Button>

        {/* Приоритет */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" disabled={disabled} className="h-8 gap-1.5 px-2 text-xs">
              <Flag className="size-3.5" />
              Приоритет
              <ChevronDown className="size-3 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[180px]">
            {ALL_PRIORITIES.map((p) => {
              const meta = PRIORITY_META[p];
              return (
                <DropdownMenuItem
                  key={p}
                  className="gap-2"
                  onClick={() => void run('Приоритет задан', () => bulk.setPriority(selectedIds, p))}
                >
                  <span className={cn('size-2 rounded-full', meta.dotColor)} aria-hidden />
                  <span className={meta.textColor}>{meta.label}</span>
                </DropdownMenuItem>
              );
            })}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => void run('Приоритет снят', () => bulk.setPriority(selectedIds, null))}
            >
              Снять приоритет
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* В колонку */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" disabled={disabled} className="h-8 gap-1.5 px-2 text-xs">
              <Columns3 className="size-3.5" />
              В колонку
              <ChevronDown className="size-3 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[180px]">
            {moveTargets.map((t) => (
              <DropdownMenuItem
                key={t.status}
                onClick={() => void run('Перемещено', () => bulk.moveToColumn(selectedIds, t.status))}
              >
                {t.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Ralph-режим */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" disabled={disabled} className="h-8 gap-1.5 px-2 text-xs">
              <Bot className="size-3.5" />
              Ralph
              <ChevronDown className="size-3 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[240px]">
            {RALPH_MODES.map((mode) => {
              const m = RALPH_MODE_META[mode];
              return (
                <DropdownMenuItem
                  key={mode}
                  className="items-start gap-2 py-2"
                  onClick={() => void run('Режим Ralph задан', () => bulk.setRalphMode(selectedIds, mode))}
                >
                  <span aria-hidden>{m.icon}</span>
                  <div className="flex min-w-0 flex-col">
                    <span className="text-sm font-medium">{m.label}</span>
                    <span className="text-[11px] leading-snug text-muted-foreground">
                      {m.description}
                    </span>
                  </div>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>

        <span className="mx-0.5 h-5 w-px bg-border" aria-hidden />

        {/* Экспорт: копировать / на почту / в Telegram */}
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          className="h-8 gap-1.5 px-2 text-xs"
          onClick={handleCopy}
        >
          <Copy className="size-3.5" />
          Скопировать
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          className="h-8 gap-1.5 px-2 text-xs"
          onClick={() => setExportChannel('email')}
        >
          <Mail className="size-3.5" />
          На почту
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          className="h-8 gap-1.5 px-2 text-xs"
          onClick={() => setExportChannel('telegram')}
        >
          <SendHorizontal className="size-3.5" />
          В Telegram
        </Button>

        <span className="mx-0.5 h-5 w-px bg-border" aria-hidden />

        {/* Удалить */}
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          className="h-8 gap-1.5 px-2 text-xs text-destructive hover:text-destructive"
          onClick={handleDelete}
        >
          <Trash2 className="size-3.5" />
          Удалить
        </Button>

        <span className="mx-0.5 h-5 w-px bg-border" aria-hidden />
        <Button
          variant="ghost"
          size="icon"
          className="size-8"
          onClick={onExit}
          aria-label="Выйти из режима выделения"
          title="Выйти (Esc)"
        >
          <X className="size-4" />
        </Button>
        </motion.div>
      </div>

      <RecipientPickerDialog
        open={exportChannel !== null}
        onOpenChange={(o) => {
          if (!o) setExportChannel(null);
        }}
        title={exportChannel === 'email' ? 'Отправить на почту' : 'Отправить в Telegram'}
        description="Дайджест выбранных задач уйдёт отмеченным получателям."
        members={members}
        busy={exporting}
        onSend={(r) => void handleSend(r)}
        allowGroup={exportChannel === 'telegram' && group.chatId !== null}
        groupTitle={group.title}
      />
    </>
  );
}
