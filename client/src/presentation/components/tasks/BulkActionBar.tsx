import { useEffect, useState } from 'react';
import {
  Bot,
  CalendarOff,
  ChevronDown,
  Columns3,
  Flag,
  Loader2,
  Send,
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
  const { projectRepository } = useContainer();
  const [members, setMembers] = useState<SharedMember[] | null>(null);
  const [busy, setBusy] = useState(false);

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

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-3">
      <div className="pointer-events-auto flex max-w-full flex-wrap items-center gap-1 rounded-xl border bg-card/95 p-1.5 shadow-2xl backdrop-blur supports-[backdrop-filter]:bg-card/80">
        <span className="px-2 text-xs font-medium tabular-nums">
          {busy ? <Loader2 className="inline size-3.5 animate-spin" /> : `Выбрано ${count}`}
        </span>
        <span className="mx-0.5 h-5 w-px bg-border" aria-hidden />

        {/* Делегировать */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" disabled={busy} className="h-8 gap-1.5 px-2 text-xs">
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
          disabled={busy}
          onChange={(d) => {
            if (d) void run('Срок задан', () => bulk.setDeadline(selectedIds, d));
          }}
        />
        <Button
          variant="ghost"
          size="icon"
          disabled={busy}
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
            <Button variant="ghost" size="sm" disabled={busy} className="h-8 gap-1.5 px-2 text-xs">
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
                  <span className={meta.textColor}>{meta.short}</span>
                  <span className="ml-auto text-[11px] text-muted-foreground">{meta.label}</span>
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
            <Button variant="ghost" size="sm" disabled={busy} className="h-8 gap-1.5 px-2 text-xs">
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
            <Button variant="ghost" size="sm" disabled={busy} className="h-8 gap-1.5 px-2 text-xs">
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

        {/* Удалить */}
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
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
      </div>
    </div>
  );
}
