import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { FileText, PanelRight, X } from 'lucide-react';
import type { Task, TaskPriority } from '@/domain/task/Task';
import { getDefaultTaskDeadline } from '@/domain/task/defaultTaskDeadline';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/sonner';
import { useCurrentUser } from '@/presentation/hooks/useCurrentUser';
import { useFocusedInbox } from '@/presentation/hooks/FocusedInboxProvider';
import { IconPicker } from '@/presentation/components/project/IconPicker';
import { ProjectIconView } from '@/presentation/components/project/projectIconView';
import { AssigneeSelect } from './AssigneeSelect';
import { DeadlinePicker } from './DeadlinePicker';
import { PrioritySelect } from './PrioritySelect';

export type InlineTaskSettings = {
  assigneeUserId: string;
  deadline: string | null;
  priority: TaskPriority | null;
};

export function InlineNewCard({
  projectId,
  defaults,
  onCreate,
  onCreated,
  onClose,
  onOpenFull,
  refocusSignal = 0,
}: {
  projectId?: string;
  defaults?: Partial<InlineTaskSettings>;
  onCreate: (name: string, icon: string | null, settings: InlineTaskSettings) => Promise<Task | null>;
  // Вызывается после успешного Enter-создания (родитель добавляет задачу в сессию и рендерит
  // её ВЫШЕ карточки создания). Не вызывается при blur/«открыть справа» (там сессия закрывается).
  onCreated?: (task: Task) => void;
  onClose: () => void;
  onOpenFull: (task: Task) => void;
  // Растёт по «+» — вернуть фокус в поле после переезда карточки наверх.
  refocusSignal?: number;
}): React.ReactElement {
  const { user } = useCurrentUser();
  const { defaultAssigneeUserId } = useFocusedInbox();
  const [assigneeUserId, setAssigneeUserId] = useState(defaults?.assigneeUserId ?? defaultAssigneeUserId ?? user?.id ?? null);
  const [deadline, setDeadline] = useState<string | null>(() => defaults?.deadline === undefined ? getDefaultTaskDeadline() : defaults.deadline);
  const [priority, setPriority] = useState<TaskPriority | null>(defaults?.priority ?? null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState('');
  const [icon, setIcon] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const savingRef = useRef(false);
  // Идёт ли взаимодействие с поповером иконки — пока да, блёр textarea НЕ коммитит/не
  // закрывает карточку (иначе клик по эмодзи в пикере убивал бы карточку до выбора).
  // Держим флаг ещё ~200мс после закрытия, чтобы отложенный blur-commit его увидел.
  const pickingRef = useRef(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const closingRef = useRef(false);
  // Запрос на возврат фокуса ПОСЛЕ рендера. Enter создаёт задачу выше → карточка создания
  // сдвигается в DOM (теряет фокус); rAF не успевает. Фокусим в effect после коммита DOM.
  const refocusRef = useRef(false);
  // Окно ~после Enter: любой блёр в это время (сдвиг карточки в DOM, разное поведение фокуса
  // на разных ОС/браузерах) НЕ закрывает карточку. Иначе на части машин Enter сохранял задачу,
  // но карточку создания тут же закрывал blur-commit — новая пустая не появлялась.
  const justEnteredRef = useRef(false);
  const justEnteredTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    closingRef.current = false;
    ref.current?.focus();
    return () => {
      closingRef.current = true;
      window.clearTimeout(justEnteredTimer.current);
    };
  }, []);
  // useLayoutEffect — синхронно после коммита DOM (до макротаска blur-commit), чтобы фокус
  // гарантированно вернулся в поле раньше, чем сработает отложенная проверка закрытия.
  useLayoutEffect(() => {
    if (refocusRef.current) {
      refocusRef.current = false;
      const el = ref.current;
      if (el) {
        el.style.height = 'auto';
        el.focus();
      }
    }
  });
  // По «+» карточка переезжает наверх (сдвиг в DOM теряет фокус) — возвращаем его. Пропускаем
  // самый первый рендер (mount-эффект уже сфокусировал).
  const mountedRef = useRef(false);
  useLayoutEffect(() => {
    if (mountedRef.current) ref.current?.focus();
    else mountedRef.current = true;
  }, [refocusSignal]);

  const grow = (el: HTMLTextAreaElement): void => {
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };

  // defaultName — имя, если поле пустое (для Enter по пустому полю: «Новая задача»).
  // blur/«открыть справа» его НЕ передают: по пустому полю там просто закрываем без создания.
  const create = async (defaultName?: string): Promise<Task | null> => {
    const name = value.trim() || defaultName?.trim() || '';
    if (!name || !assigneeUserId || savingRef.current) return null;
    savingRef.current = true;
    setBusy(true);
    try {
      return await onCreate(name, icon, { assigneeUserId, deadline, priority });
    } catch (error) {
      toast.error(`Не удалось создать задачу: ${(error as Error).message}`);
      return null;
    } finally {
      savingRef.current = false;
      setBusy(false);
    }
  };

  // Enter → создать задачу (она встаёт ВЫШЕ), поле очищается и остаётся для следующей.
  // Фокус возвращаем в effect после коммита (карточка сдвигается в DOM и теряет фокус).
  const markJustEntered = (): void => {
    justEnteredRef.current = true;
    if (justEnteredTimer.current) window.clearTimeout(justEnteredTimer.current);
    justEnteredTimer.current = window.setTimeout(() => {
      justEnteredRef.current = false;
    }, 400);
  };
  const onEnter = async (): Promise<void> => {
    // Ставим флаг СРАЗУ (до await) — блёр от сохранения/сдвига не должен закрыть карточку.
    markJustEntered();
    // Enter по ПУСТОМУ полю → задача «Новая задача» (и снова пустая карточка ниже).
    const t = await create('Новая задача');
    if (t) {
      onCreated?.(t);
      setValue('');
      setIcon(null);
      refocusRef.current = true;
      markJustEntered();
    }
  };
  // Клик вне карточки → создать (если есть текст) и закрыть. Откладываем на тик и
  // пропускаем, если фокус ушёл в поповер иконки (взаимодействие с пикером, не выход).
  const onBlurCommit = (): void => {
    window.setTimeout(() => {
      if (closingRef.current || pickingRef.current || savingRef.current) return;
      // Только что был Enter — блёр от сохранения/сдвига карточки, НЕ выход. Не закрываем.
      if (justEnteredRef.current) return;
      const active = document.activeElement;
      // Фокус вернулся в само поле (сдвиг карточки в DOM после Enter) — это НЕ выход, не закрываем.
      if (active && cardRef.current?.contains(active)) return;
      if (active && active.closest('[data-radix-popper-content-wrapper], .bg-popover')) return;
      if (!value.trim()) {
        onClose();
        return;
      }
      void create().then((task) => {
        if (task) onClose();
      });
    }, 0);
  };
  const onPickerOpenChange = (open: boolean): void => {
    pickingRef.current = open;
  };
  // «Открыть справа» → создать и открыть в окне справа.
  const openFull = async (): Promise<void> => {
    if (savingRef.current) return;
    closingRef.current = true;
    const t = await create();
    if (t) {
      onClose();
      onOpenFull(t);
    } else {
      closingRef.current = false;
      if (!value.trim()) onClose();
    }
  };

  // Радиус 10px — как у обычной карточки (замеры Notion), чтобы карточка создания
  // не выбивалась из ряда.
  return (
    <div ref={cardRef} data-pf-inline-create aria-label="Новая задача" className="group/new flex min-w-0 flex-col gap-2 rounded-lg bg-card p-2.5 shadow-card ring-1 ring-primary/30">
      {/* items-start: иконка стоит рядом с ПЕРВОЙ строкой (при многострочном названии остаётся
          сверху); при однострочном — визуально по центру. gap-1.5 — компактно. */}
      <div className="flex items-start gap-1.5">
        {/* Иконка задачи размером с текст (не крупный квадрат) — пикер тот же. Пока пикер
            открыт — не закрываем карточку; после выбора возвращаем фокус в поле. */}
        <IconPicker
          value={icon}
          onChange={(v) => {
            setIcon(v);
            requestAnimationFrame(() => ref.current?.focus());
          }}
          onOpenChange={(open) => {
            if (open) {
              pickingRef.current = true;
            } else {
              // Держим флаг чуть дольше, чтобы уже запланированный blur-commit его увидел,
              // затем возвращаем фокус в поле — карточка живёт.
              window.setTimeout(() => {
                pickingRef.current = false;
              }, 200);
              requestAnimationFrame(() => ref.current?.focus());
            }
          }}
          trigger={
            <button
              type="button"
              // Не крадём фокус у поля (иначе blur-commit закроет карточку до открытия пикера).
              onMouseDown={(e) => e.preventDefault()}
              aria-label={icon ? 'Сменить иконку' : 'Добавить иконку'}
              title="Иконка задачи"
              className="grid min-h-11 w-11 shrink-0 cursor-pointer place-items-center rounded text-muted-foreground transition-colors active:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring sm:min-h-8 sm:w-7 [@media(hover:hover)_and_(pointer:fine)]:hover:text-foreground"
            >
              {icon ? (
                <ProjectIconView icon={icon} pixelSize={18} className="text-[1.05rem]" />
              ) : (
                <FileText className="size-[1.05rem]" />
              )}
            </button>
          }
        />
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            grow(e.currentTarget);
          }}
          // Only leaving the title submits on blur. Picker portals and the native
          // date input must never submit while restoring focus after selection.
          onBlur={onBlurCommit}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void onEnter();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              closingRef.current = true;
              onClose();
            }
          }}
          rows={1}
          placeholder="Название задачи…"
          readOnly={busy}
          aria-busy={busy}
          aria-label="Название задачи"
          className="min-h-11 min-w-0 w-full resize-none overflow-hidden rounded bg-transparent py-2 text-base leading-snug focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary/30 placeholder:text-muted-foreground/70 sm:min-h-8 sm:text-sm"
        />
        <button
          type="button"
          // preventDefault на mousedown — не терять фокус textarea до клика (иначе onBlur обгонит).
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => void openFull()}
          title="Все настройки задачи"
          aria-label="Открыть справа"
          disabled={busy || !value.trim()}
          className="grid min-h-11 w-11 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors active:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40 sm:min-h-8 sm:w-8 [@media(hover:hover)_and_(pointer:fine)]:hover:bg-accent"
        >
          <PanelRight className="size-4" />
        </button>
      </div>
      <div className="grid min-w-0 grid-cols-2 gap-2 border-bs pbs-2" role="group" aria-label="Настройки новой задачи">
        <div className="min-w-0">
          <div className="px-1 text-2xs text-muted-foreground">Исполнитель</div>
          <AssigneeSelect value={assigneeUserId} onChange={setAssigneeUserId} projectId={projectId} disabled={busy} onOpenChange={onPickerOpenChange} className="h-auto min-h-11 w-full justify-start gap-1 px-1 text-xs sm:min-h-8" />
        </div>
        <div className="min-w-0">
          <div className="px-1 text-2xs text-muted-foreground">Срок до</div>
          <DeadlinePicker value={deadline} onChange={setDeadline} disabled={busy} onOpenChange={onPickerOpenChange} emptyLabel="Без срока" className="h-auto min-h-11 w-full justify-start gap-1 px-1 text-xs sm:min-h-8" />
        </div>
      </div>
      <div className="flex min-w-0 items-center gap-1 border-bs pbs-2">
        <PrioritySelect value={priority} onChange={setPriority} disabled={busy} onOpenChange={onPickerOpenChange} compact className="h-auto min-h-11 min-w-0 flex-1 justify-between px-1 text-xs sm:min-h-8" />
        <Button type="button" variant="ghost" size="icon" aria-label="Отменить создание" disabled={busy} className="size-11 shrink-0 sm:size-8" onClick={() => { closingRef.current = true; onClose(); }}><X className="size-4" /></Button>
        <Button type="button" size="sm" disabled={busy || !value.trim() || !assigneeUserId} className="min-h-11 shrink-0 px-3 sm:min-h-8" onClick={() => void onEnter()}>{busy ? 'Создаём…' : 'Создать'}</Button>
      </div>
    </div>
  );
}
