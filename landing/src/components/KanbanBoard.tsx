/**
 * Доска «Входящие» в hero — тот же язык, что в приложении (дизайн C4): закреплённая колонка
 * «Сейчас» (группы «На утверждении» и «Вручную») и колонки проектов с плотными карточками.
 * Перетаскивание — на @dnd-kit, как в проде.
 *
 * Что можно сделать:
 * - нажать на задачу (или Enter) — её берёт AI: «AI делает», через пару секунд результат
 *   приходит в «Сейчас → На утверждении»;
 * - «Принять» — задача готова: счётчик «сделано сегодня» +1, тост с «Отменить»;
 *   «Вернуть» — AI доработает и пришлёт снова;
 * - перетащить карточку проекта в «Сейчас» — сделаешь сам (группа «Вручную»), галочка —
 *   готово; ручную задачу можно утащить обратно в её проект — тогда её возьмёт AI.
 * С клавиатуры: Enter — отдать AI, пробел — взять карточку, стрелки — выбрать колонку,
 * пробел — положить, Esc — отменить. На тач-экране перетаскивание — долгим нажатием,
 * обычный свайп листает колонки. Пока доска на экране и её не трогают, AI сам берёт задачи
 * из очереди — только если пользователь не просил уменьшить движение.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, ReactElement } from 'react';
import { createPortal } from 'react-dom';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
  type Modifier,
  type ScreenReaderInstructions,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import { getEventCoordinates } from '@dnd-kit/utilities';
import '@/styles/board.css';

type ProjectId = 'cafe' | 'bot' | 'launch';
type Status = 'idle' | 'queued' | 'running' | 'approval' | 'manual';
type Due = 'today' | 'yesterday' | 'fri';

interface Project {
  readonly id: ProjectId;
  readonly name: string;
  /** Класс тона метки (.pf-tone-*) — пастельные теги Notion. */
  readonly tone: string;
}

interface Task {
  readonly id: string;
  readonly project: ProjectId;
  readonly title: string;
  /** Подпись под заголовком. */
  readonly note: string;
  /** Что сообщает AI, когда закончил (подпись на утверждении). */
  readonly result: string;
  readonly status: Status;
  readonly due?: Due;
}

const PROJECTS: readonly Project[] = [
  { id: 'cafe', name: 'Сайт кофейни', tone: 'pf-tone-orange' },
  { id: 'bot', name: 'Бот записи', tone: 'pf-tone-green' },
  { id: 'launch', name: 'Лендинг запуска', tone: 'pf-tone-blue' },
];
const PROJECT: Record<ProjectId, Project> = {
  cafe: PROJECTS[0]!,
  bot: PROJECTS[1]!,
  launch: PROJECTS[2]!,
};

const INITIAL: readonly Task[] = [
  { id: 't1', project: 'cafe', title: 'Главная страница', note: '', result: 'Вёрстка и тексты готовы — проверь', status: 'approval' },
  { id: 't2', project: 'cafe', title: 'Купить домен kofeinya.ru', note: 'Нужна оплата картой', result: 'Домен куплен и подключён', status: 'manual', due: 'today' },
  { id: 't3', project: 'bot', title: 'Ответить первым клиентам', note: 'Три сообщения в Telegram', result: 'Ответы отправлены', status: 'manual', due: 'yesterday' },
  { id: 't4', project: 'cafe', title: 'Меню с ценами и фото', note: '12 позиций, фото с телефона', result: 'Меню собрано: 12 позиций с фото', status: 'running' },
  { id: 't5', project: 'cafe', title: 'Форма брони столика', note: 'Заявки — в Telegram', result: 'Форма работает, заявки идут в Telegram', status: 'queued' },
  { id: 't6', project: 'cafe', title: 'Отзывы гостей на главной', note: 'Из Яндекс Карт', result: 'Блок отзывов добавлен', status: 'idle', due: 'fri' },
  { id: 't7', project: 'bot', title: 'Напоминание за час до записи', note: 'Клиенту и мастеру', result: 'Напоминания настроены', status: 'queued', due: 'today' },
  { id: 't8', project: 'bot', title: 'Оплата через СБП', note: 'Предоплата 30%', result: 'Оплата подключена, тест прошёл', status: 'idle' },
  { id: 't9', project: 'bot', title: 'Отмена записи в один тап', note: 'Слот снова свободен', result: 'Кнопка отмены работает', status: 'idle' },
  { id: 't10', project: 'launch', title: 'Экран тарифов', note: 'Три тарифа и сравнение', result: 'Экран собран — сверь цены', status: 'idle', due: 'yesterday' },
  { id: 't11', project: 'launch', title: 'Письмо после регистрации', note: 'Коротко, с первым шагом', result: 'Письмо написано и подключено', status: 'queued' },
  { id: 't12', project: 'launch', title: 'Тёмная тема', note: 'По настройке системы', result: 'Тёмная тема включена', status: 'idle' },
];

/** Сколько «работает» AI над задачей, мс. */
const RUN_MS = 3200;
/** Авто-демо стартует, если доску не трогали столько, мс. */
const IDLE_MS = 6000;
const DEMO_TICK_MS = 2400;
const TOAST_MS = 5000;
/** Больше задач на утверждении AI сам не присылает — ждёт пользователя. */
const MAX_APPROVALS = 3;
const RESET_MS = 4000;
const INITIAL_DONE_TODAY = 3;

const NOW = 'now';
const colId = (p: ProjectId): string => `col:${p}`;

const DUE: Record<Due, { label: string; cls: string; sr: string }> = {
  today: { label: 'сегодня', cls: ' kb-due--today', sr: 'срок сегодня' },
  yesterday: { label: 'вчера', cls: ' kb-due--late', sr: 'срок вчера, просрочено' },
  fri: { label: 'пт', cls: '', sr: 'срок в пятницу' },
};

const isProjectStatus = (s: Status): boolean => s === 'idle' || s === 'queued' || s === 'running';
const canGiveToAi = (t: Task): boolean => t.status === 'idle' || t.status === 'queued' || t.status === 'manual';
const zoneOf = (t: Task): string => (isProjectStatus(t.status) ? colId(t.project) : t.status);

/** Новый статус задачи. Сменила зону — встаёт первой в новой; осталась в своей — на месте. */
function withStatus(tasks: readonly Task[], id: string, status: Status): readonly Task[] {
  const task = tasks.find((t) => t.id === id);
  if (!task) return tasks;
  const next = { ...task, status };
  if (zoneOf(next) === zoneOf(task)) return tasks.map((t) => (t.id === id ? next : t));
  return [next, ...tasks.filter((t) => t.id !== id)];
}

const cx = (...parts: (string | false | null | undefined)[]): string => parts.filter(Boolean).join(' ');

// Центр поднятой карточки привязан к курсору — она всегда под пальцем/курсором, без
// смещений от прокрученной ленты колонок.
const snapCenterToCursor: Modifier = ({ activatorEvent, draggingNodeRect, transform }) => {
  if (!draggingNodeRect || !activatorEvent) return transform;
  const coords = getEventCoordinates(activatorEvent);
  if (!coords) return transform;
  return {
    ...transform,
    x: transform.x + coords.x - draggingNodeRect.left - draggingNodeRect.width / 2,
    y: transform.y + coords.y - draggingNodeRect.top - draggingNodeRect.height / 2,
  };
};

/**
 * Куда можно бросить задачу: карточку проекта — в «Сейчас» (сделаю сам), ручную — обратно
 * в её проект (её возьмёт AI). Зоны броска всегда включены (dnd-kit измеряет их в начале
 * перетаскивания), а допустимость решает эта функция — в столкновениях, стрелках и при броске.
 */
const canDrop = (task: Task, overId: UniqueIdentifier): boolean =>
  overId === NOW ? isProjectStatus(task.status) : overId === colId(task.project) && task.status === 'manual';

type FindTask = (id: UniqueIdentifier) => Task | undefined;

// С указателем зона броска — та, над которой курсор; с клавиатуры — та, на которую
// поставили карточку стрелками. Недопустимые зоны в расчёт не берём.
const makeCollisionDetection =
  (find: FindTask): CollisionDetection =>
  (args) => {
    const task = find(args.active.id);
    const scoped = {
      ...args,
      droppableContainers: task ? args.droppableContainers.filter((c) => canDrop(task, c.id)) : [],
    };
    return args.pointerCoordinates ? pointerWithin(scoped) : rectIntersection(scoped);
  };

// Стрелки переставляют карточку сразу в соседнюю допустимую колонку, а не на 25px.
const makeKeyboardCoordinates =
  (find: FindTask): KeyboardCoordinateGetter =>
  (event, { context }) => {
    const dir = event.code;
    if (dir !== 'ArrowLeft' && dir !== 'ArrowRight' && dir !== 'ArrowUp' && dir !== 'ArrowDown') return undefined;
    event.preventDefault();
    const { active, collisionRect, droppableRects, droppableContainers } = context;
    const task = active ? find(active.id) : undefined;
    if (!collisionRect || !task) return undefined;
    const cxNow = collisionRect.left + collisionRect.width / 2;
    const cyNow = collisionRect.top + collisionRect.height / 2;
    let best: { left: number; top: number; width: number; height: number; dist: number } | null = null;
    for (const container of droppableContainers.getEnabled()) {
      if (!canDrop(task, container.id)) continue;
      const rect = droppableRects.get(container.id);
      if (!rect) continue;
      const dx = rect.left + rect.width / 2 - cxNow;
      const dy = rect.top + Math.min(rect.height / 2, 80) - cyNow;
      const ahead =
        dir === 'ArrowRight' ? dx > 8 : dir === 'ArrowLeft' ? dx < -8 : dir === 'ArrowDown' ? dy > 8 : dy < -8;
      if (!ahead) continue;
      const dist = Math.hypot(dx, dy);
      if (!best || dist < best.dist) best = { left: rect.left, top: rect.top, width: rect.width, height: rect.height, dist };
    }
    if (!best) return undefined;
    return {
      x: best.left + (best.width - collisionRect.width) / 2,
      y: best.top + Math.max(8, Math.min(48, (best.height - collisionRect.height) / 2)),
    };
  };

const screenReaderInstructions: ScreenReaderInstructions = {
  draggable:
    'Enter — отдать задачу AI. Пробел — взять карточку, стрелками выбрать колонку, пробелом положить, Esc — отменить.',
};

/* --- Иконки (lucide, как в приложении) ------------------------------------- */
function Icon({ d, className }: { d: readonly string[]; className?: string }): ReactElement {
  return (
    <svg className={cx('kb-ic', className)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {d.map((p) => (
        <path key={p} d={p} />
      ))}
    </svg>
  );
}
const IC = {
  inbox: ['M22 12h-6l-2 3h-4l-2-3H2', 'M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z'],
  chevronDown: ['m6 9 6 6 6-6'],
  chevronRight: ['m9 18 6-6-6-6'],
  pin: ['M12 17v5', 'M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z'],
  circleCheck: ['M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0z', 'm9 12 2 2 4-4'],
  check: ['M20 6 9 17l-5-5'],
  clock: ['M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0z', 'M12 6v6l4 2'],
  undo: ['M9 14 4 9l5-5', 'M4 9h10.5a5.5 5.5 0 0 1 0 11H11'],
  sparkles: ['M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.14-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.14a.5.5 0 0 1 .96 0L14.06 8.5A2 2 0 0 0 15.5 9.94l6.14 1.58a.5.5 0 0 1 0 .96L15.5 14.06a2 2 0 0 0-1.44 1.44l-1.58 6.14a.5.5 0 0 1-.96 0z'],
} as const;

/* --- Части карточки -------------------------------------------------------- */
function DueLabel({ due }: { due: Due }): ReactElement {
  const d = DUE[due];
  return (
    <span className={'kb-due' + d.cls}>
      <Icon d={IC.clock} />
      <span aria-hidden="true">{d.label}</span>
      <span className="sr-only">{d.sr}</span>
    </span>
  );
}

function ProjectTag({ project }: { project: ProjectId }): ReactElement {
  const p = PROJECT[project];
  return (
    <span className={'pf-tag ' + p.tone}>
      <span className="pf-tag__text">{p.name}</span>
    </span>
  );
}

/** Содержимое карточки в колонке проекта (и её копии в руке при перетаскивании). */
function ProjectCardBody({ task }: { task: Task }): ReactElement {
  return (
    <>
      <span className="kb-card__title">{task.title}</span>
      {task.status === 'running' ? (
        <span className="kb-run">AI делает</span>
      ) : (
        <span className="kb-card__note">{task.note}</span>
      )}
      {(task.status === 'queued' || task.due) && (
        <span className="kb-card__meta">
          {task.status === 'queued' && (
            <span className="pf-tag pf-tone-queue">
              <span className="pf-tag__text">В очереди</span>
            </span>
          )}
          {task.due && <DueLabel due={task.due} />}
        </span>
      )}
      {task.status === 'running' && <span className="kb-card__progress" aria-hidden="true" />}
    </>
  );
}

function ManualCardBody({ task }: { task: Task }): ReactElement {
  return (
    <>
      <span className="kb-card__title">{task.title}</span>
      <span className="kb-card__meta">
        <ProjectTag project={task.project} />
        {task.due && <DueLabel due={task.due} />}
      </span>
    </>
  );
}

function HoverHint(): ReactElement {
  return (
    <span className="kb-card__hint" aria-hidden="true">
      <Icon d={IC.sparkles} />
      Отдать AI
    </span>
  );
}

interface CardActions {
  give: (id: string, viaKeyboard: boolean) => void;
  /** true — клик пришёл сразу после перетаскивания, его надо проигнорировать. */
  clickBlocked: () => boolean;
}

const statusSr: Record<Status, string> = {
  idle: '',
  queued: 'в очереди у AI',
  running: 'AI делает',
  approval: 'на утверждении',
  manual: 'вручную',
};

/** Карточка в колонке проекта: клик/Enter — отдать AI, перетаскивание — в «Сейчас». */
function ProjectCard({ task, actions }: { task: Task; actions: CardActions }): ReactElement {
  const running = task.status === 'running';
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.id,
    data: { task },
    attributes: { roleDescription: 'задача' },
  });
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    listeners?.onKeyDown?.(e);
    if (e.defaultPrevented || e.key !== 'Enter') return;
    e.preventDefault();
    if (!running) actions.give(task.id, true);
  };
  const onClick = (e: ReactMouseEvent<HTMLDivElement>): void => {
    if (running || actions.clickBlocked()) return;
    actions.give(task.id, e.detail === 0);
  };
  const parts = [task.title, task.note, statusSr[task.status], task.due ? DUE[task.due].sr : ''];
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onKeyDown={onKeyDown}
      onClick={onClick}
      aria-label={parts.filter(Boolean).join('. ')}
      aria-disabled={running}
      data-kb-focus={task.id}
      className={cx('kb-card', running && 'is-running', isDragging && 'is-dragging')}
    >
      <ProjectCardBody task={task} />
      {!running && <HoverHint />}
    </div>
  );
}

/** Ручная задача в «Сейчас»: галочка — готово; клик — отдать AI; можно утащить в проект. */
function ManualCard({
  task,
  actions,
  onDone,
}: {
  task: Task;
  actions: CardActions;
  onDone: (id: string, viaKeyboard: boolean) => void;
}): ReactElement {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({
    id: task.id,
    data: { task },
    attributes: { roleDescription: 'задача' },
  });
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    listeners?.onKeyDown?.(e);
    if (e.defaultPrevented || e.key !== 'Enter') return;
    e.preventDefault();
    actions.give(task.id, true);
  };
  const parts = [task.title, PROJECT[task.project].name, task.due ? DUE[task.due].sr : ''];
  return (
    <div ref={setNodeRef} className={cx('kb-card kb-card--manual', isDragging && 'is-dragging')}>
      <button
        type="button"
        className="kb-check"
        aria-label={`Отметить готовой: «${task.title}»`}
        onClick={(e) => onDone(task.id, e.detail === 0)}
      >
        <Icon d={IC.check} />
      </button>
      <div
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        onKeyDown={onKeyDown}
        onClick={(e) => {
          if (!actions.clickBlocked()) actions.give(task.id, e.detail === 0);
        }}
        aria-label={parts.filter(Boolean).join('. ')}
        data-kb-focus={task.id}
        className="kb-card__handle"
      >
        <ManualCardBody task={task} />
      </div>
      <HoverHint />
    </div>
  );
}

/** Результат AI на утверждении: «Принять» или «Вернуть» на доработку. */
function ApprovalCard({
  task,
  onAccept,
  onReturn,
}: {
  task: Task;
  onAccept: (id: string, viaKeyboard: boolean) => void;
  onReturn: (id: string, viaKeyboard: boolean) => void;
}): ReactElement {
  return (
    <div className="kb-card kb-card--approval" data-kb-focus={task.id} tabIndex={-1}>
      <ProjectTag project={task.project} />
      <span className="kb-card__title">{task.title}</span>
      <span className="kb-card__note">{task.result}</span>
      <span className="kb-card__actions">
        <button
          type="button"
          className="kb-btn kb-btn--accept"
          aria-label={`Принять: «${task.title}»`}
          onClick={(e) => onAccept(task.id, e.detail === 0)}
        >
          <Icon d={IC.check} />
          Принять
        </button>
        <button
          type="button"
          className="kb-btn kb-btn--return"
          aria-label={`Вернуть на доработку: «${task.title}»`}
          onClick={(e) => onReturn(task.id, e.detail === 0)}
        >
          <Icon d={IC.undo} />
          Вернуть
        </button>
      </span>
    </div>
  );
}

/* --- Колонки --------------------------------------------------------------- */
function NowColumn({
  approvals,
  manual,
  dragged,
  actions,
  onAccept,
  onReturn,
  onDone,
}: {
  approvals: readonly Task[];
  manual: readonly Task[];
  dragged: Task | null;
  actions: CardActions;
  onAccept: (id: string, viaKeyboard: boolean) => void;
  onReturn: (id: string, viaKeyboard: boolean) => void;
  onDone: (id: string, viaKeyboard: boolean) => void;
}): ReactElement {
  const target = dragged !== null && canDrop(dragged, NOW);
  const { setNodeRef, isOver } = useDroppable({ id: NOW });
  return (
    <div
      ref={setNodeRef}
      role="group"
      className={cx('kb-col kb-col--now', target && 'is-target', target && isOver && 'is-over')}
      aria-label={`Сейчас: на утверждении ${approvals.length}, вручную ${manual.length}`}
    >
      <div className="kb-col__head">
        <Icon d={IC.pin} className="kb-col__pin" />
        <span className="kb-col__name">Сейчас</span>
        <span className="kb-col__count">{approvals.length + manual.length}</span>
      </div>

      <div className="kb-group">
        <div className="kb-group__head">
          <span className="pf-tag pf-tone-approval">
            <span className="pf-tag__text">На утверждении</span>
          </span>
          <span className="kb-col__count">{approvals.length}</span>
        </div>
        {approvals.length > 0 ? (
          <ul className="kb-list">
            {approvals.map((t) => (
              <li key={t.id}>
                <ApprovalCard task={t} onAccept={onAccept} onReturn={onReturn} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="kb-empty">AI пока ничего не прислал на проверку</p>
        )}
      </div>

      <div className="kb-group kb-group--manual">
        <div className="kb-group__head">
          <span className="pf-tag pf-tone-manual">
            <span className="pf-tag__text">Вручную</span>
          </span>
          <span className="kb-col__count">{manual.length}</span>
        </div>
        {manual.length > 0 && (
          <ul className="kb-list">
            {manual.map((t) => (
              <li key={t.id}>
                <ManualCard task={t} actions={actions} onDone={onDone} />
              </li>
            ))}
          </ul>
        )}
        <div className="kb-dropzone" aria-hidden="true">
          {target ? 'Отпусти — сделаешь сам' : 'Перетащи сюда, что сделаешь сам'}
        </div>
      </div>
    </div>
  );
}

function ProjectColumn({
  project,
  tasks,
  dragged,
  actions,
}: {
  project: Project;
  tasks: readonly Task[];
  dragged: Task | null;
  actions: CardActions;
}): ReactElement {
  const target = dragged !== null && canDrop(dragged, colId(project.id));
  const { setNodeRef, isOver } = useDroppable({ id: colId(project.id) });
  return (
    <div
      ref={setNodeRef}
      role="group"
      className={cx('kb-col', target && 'is-target', target && isOver && 'is-over')}
      aria-label={`${project.name}: задач ${tasks.length}`}
    >
      <div className="kb-col__head">
        <span className={'pf-tag pf-tag-lg ' + project.tone}>
          <span className="pf-tag__text">{project.name}</span>
        </span>
        <span className="kb-col__count">{tasks.length}</span>
      </div>
      {tasks.length > 0 ? (
        <ul className="kb-list">
          {tasks.map((t) => (
            <li key={t.id}>
              <ProjectCard task={t} actions={actions} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="kb-empty">Пусто — всё у AI или у тебя</p>
      )}
      {target && <div className="kb-dropzone" aria-hidden="true">Отпусти — задачу возьмёт AI</div>}
    </div>
  );
}

interface ToastState {
  readonly key: number;
  readonly text: string;
  readonly undo: { readonly tasks: readonly Task[]; readonly done: number };
}

export default function KanbanBoard(): ReactElement {
  const [tasks, setTasks] = useState<readonly Task[]>(INITIAL);
  const [doneToday, setDoneToday] = useState(INITIAL_DONE_TODAY);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  // Портал для DragOverlay доступен только после монтирования (на сервере document нет).
  const [mounted, setMounted] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const undoRef = useRef<HTMLButtonElement>(null);
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const doneRef = useRef(doneToday);
  doneRef.current = doneToday;
  const activeRef = useRef(activeId);
  activeRef.current = activeId;
  const timers = useRef(new Map<string, number>());
  const lastTouch = useRef(0);
  const blockClickUntil = useRef(0);
  const visible = useRef(false);
  const reduceMotion = useRef(true);
  const pendingFocus = useRef<string | null>(null);
  const focusUndo = useRef(false);

  const findTask = useCallback<FindTask>((id) => tasksRef.current.find((t) => t.id === id), []);
  const collisionDetection = useMemo(() => makeCollisionDetection(findTask), [findTask]);
  const keyboardCoordinates = useMemo(() => makeKeyboardCoordinates(findTask), [findTask]);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // Долгое нажатие — перетащить, свайп — листать ленту колонок.
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor, {
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space', 'Enter'] },
      coordinateGetter: keyboardCoordinates,
    }),
  );

  useEffect(() => {
    setMounted(true);
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    reduceMotion.current = mq.matches;
    const onChange = (e: MediaQueryListEvent): void => {
      reduceMotion.current = e.matches;
    };
    mq.addEventListener('change', onChange);
    const el = rootRef.current;
    const io = el
      ? new IntersectionObserver(
          (entries) => {
            visible.current = entries.some((e) => e.isIntersecting);
          },
          { threshold: 0.2 },
        )
      : null;
    if (el && io) io.observe(el);
    const timerMap = timers.current;
    return () => {
      mq.removeEventListener('change', onChange);
      io?.disconnect();
      timerMap.forEach((h) => window.clearTimeout(h));
      timerMap.clear();
    };
  }, []);

  // AI «работает» RUN_MS над каждой задачей в статусе «AI делает», потом присылает на утверждение.
  useEffect(() => {
    const running = new Set(tasks.filter((t) => t.status === 'running').map((t) => t.id));
    running.forEach((id) => {
      if (timers.current.has(id)) return;
      // Пока карточку держат в руке, результат не присылаем — ждём броска.
      const finish = (): void => {
        if (activeRef.current === id) {
          timers.current.set(id, window.setTimeout(finish, 400));
          return;
        }
        timers.current.delete(id);
        setTasks((ts) => (ts.find((t) => t.id === id)?.status === 'running' ? withStatus(ts, id, 'approval') : ts));
      };
      timers.current.set(id, window.setTimeout(finish, RUN_MS));
    });
    timers.current.forEach((handle, id) => {
      if (running.has(id)) return;
      window.clearTimeout(handle);
      timers.current.delete(id);
    });
  }, [tasks]);

  // Авто-демо: доска на экране и её не трогают — AI сам берёт следующую задачу из очереди.
  useEffect(() => {
    const handle = window.setInterval(() => {
      if (reduceMotion.current || activeRef.current || !visible.current || document.hidden) return;
      if (performance.now() - lastTouch.current < IDLE_MS) return;
      setTasks((ts) => {
        if (ts.some((t) => t.status === 'running')) return ts;
        if (ts.filter((t) => t.status === 'approval').length >= MAX_APPROVALS) return ts;
        const next = ts.find((t) => t.status === 'queued') ?? ts.find((t) => t.status === 'idle');
        return next ? withStatus(ts, next.id, 'running') : ts;
      });
    }, DEMO_TICK_MS);
    return () => window.clearInterval(handle);
  }, []);

  // Всё разобрано — через пару секунд доска возвращается к началу.
  useEffect(() => {
    if (tasks.some((t) => t.status !== 'manual')) return;
    const handle = window.setTimeout(() => {
      setTasks(INITIAL);
      setToast(null);
    }, RESET_MS);
    return () => window.clearTimeout(handle);
  }, [tasks]);

  // Тост отмены живёт TOAST_MS. Фокус из исчезающего тоста возвращаем на доску.
  useEffect(() => {
    if (!toast) return;
    const handle = window.setTimeout(() => {
      if (undoRef.current && document.activeElement === undoRef.current) rootRef.current?.focus();
      setToast(null);
    }, TOAST_MS);
    return () => window.clearTimeout(handle);
  }, [toast]);

  // После действия с клавиатуры фокус едет за карточкой в новую колонку (или на «Отменить»).
  useEffect(() => {
    if (focusUndo.current && undoRef.current) {
      focusUndo.current = false;
      undoRef.current.focus();
      return;
    }
    const id = pendingFocus.current;
    if (!id) return;
    pendingFocus.current = null;
    rootRef.current?.querySelector<HTMLElement>(`[data-kb-focus="${id}"]`)?.focus();
  }, [tasks, toast]);

  const touch = useCallback((): void => {
    lastTouch.current = performance.now();
  }, []);

  const give = useCallback(
    (id: string, viaKeyboard: boolean): void => {
      touch();
      const task = tasksRef.current.find((t) => t.id === id);
      if (!task || !canGiveToAi(task)) return;
      if (viaKeyboard && zoneOf(task) !== colId(task.project)) pendingFocus.current = id;
      setTasks((ts) => withStatus(ts, id, 'running'));
    },
    [touch],
  );

  const complete = useCallback(
    (id: string, verb: string, viaKeyboard: boolean): void => {
      touch();
      const prev = tasksRef.current;
      const task = prev.find((t) => t.id === id);
      if (!task) return;
      const prevDone = doneRef.current;
      setTasks(prev.filter((t) => t.id !== id));
      setDoneToday(prevDone + 1);
      setToast({ key: performance.now(), text: `${verb}: «${task.title}»`, undo: { tasks: prev, done: prevDone } });
      focusUndo.current = viaKeyboard;
    },
    [touch],
  );

  const accept = useCallback((id: string, kb: boolean) => complete(id, 'Принято', kb), [complete]);
  const markDone = useCallback((id: string, kb: boolean) => complete(id, 'Готово', kb), [complete]);
  const sendBack = useCallback(
    (id: string, viaKeyboard: boolean): void => {
      touch();
      if (viaKeyboard) pendingFocus.current = id;
      setTasks((ts) => withStatus(ts, id, 'running'));
    },
    [touch],
  );

  const undo = (): void => {
    if (!toast) return;
    touch();
    setTasks(toast.undo.tasks);
    setDoneToday(toast.undo.done);
    setToast(null);
    rootRef.current?.focus();
  };

  const actions: CardActions = {
    give,
    clickBlocked: () => performance.now() < blockClickUntil.current,
  };

  const onDragStart = (e: DragStartEvent): void => {
    touch();
    setActiveId(String(e.active.id));
  };
  const onDragEnd = (e: DragEndEvent): void => {
    touch();
    setActiveId(null);
    // Отпущенная над той же карточкой мышь даёт click — его глушим.
    blockClickUntil.current = performance.now() + 250;
    const over = e.over?.id;
    const id = String(e.active.id);
    const task = tasksRef.current.find((t) => t.id === id);
    if (over == null || !task || !canDrop(task, over)) return;
    setTasks((ts) => withStatus(ts, id, over === NOW ? 'manual' : 'running'));
  };

  const titleOf = (id: UniqueIdentifier): string => tasksRef.current.find((t) => t.id === id)?.title ?? 'задача';
  const zoneName = (id: UniqueIdentifier): string => {
    if (id === NOW) return 'в «Сейчас» — сделаешь сам';
    const project = PROJECTS.find((p) => colId(p.id) === id);
    return project ? `в проект «${project.name}» — её возьмёт AI` : 'на место';
  };
  const announcements: Announcements = {
    onDragStart: ({ active }) =>
      `Задача «${titleOf(active.id)}» взята. Стрелками выбери колонку, пробелом положи, Esc — отмена.`,
    onDragOver: ({ over }) => (over ? `Над колонкой: ${zoneName(over.id)}.` : 'Не над колонкой.'),
    onDragEnd: ({ active, over }) =>
      over ? `Задача «${titleOf(active.id)}» перенесена ${zoneName(over.id)}.` : `Задача «${titleOf(active.id)}» осталась на месте.`,
    onDragCancel: ({ active }) => `Перенос отменён, задача «${titleOf(active.id)}» на месте.`,
  };

  const dragged = activeId ? (tasks.find((t) => t.id === activeId) ?? null) : null;
  const approvals = tasks.filter((t) => t.status === 'approval');
  const manual = tasks.filter((t) => t.status === 'manual');

  return (
    <div
      ref={rootRef}
      className={cx('kb', mounted && 'is-live', dragged && 'is-dragging')}
      role="region"
      aria-label="Демо-доска «Входящие»"
      tabIndex={-1}
      onPointerDown={touch}
      onKeyDown={touch}
    >
      <div className="kb__bar">
        <div className="kb__crumbs" aria-hidden="true">
          <span className="kb__crumb">
            <span className="kb__ws">М</span>
            <span className="kb__ws-name">Мастерская</span>
            <Icon d={IC.chevronDown} className="kb__chev" />
          </span>
          <Icon d={IC.chevronRight} className="kb__sep" />
          <span className="kb__crumb kb__crumb--current">
            <Icon d={IC.inbox} />
            Входящие
          </span>
        </div>
        <span className="kb__done" aria-label={`Сегодня сделано задач: ${doneToday}`}>
          <Icon d={IC.circleCheck} />
          <span className="kb__done-n">{doneToday}</span>
          <span className="kb__done-label">сделано сегодня</span>
        </span>
      </div>

      <div className="kb__head" aria-hidden="true">
        <span className="kb__title">Входящие</span>
      </div>

      <DndContext
        // Стабильный id: иначе счётчик dnd-kit даёт разный aria-describedby на сервере и
        // в браузере, и ссылка на подсказку для скринридера ломается при гидратации.
        id="pf-inbox-demo"
        // Автопрокрутка — только ленты колонок. Страницу не крутим: доска стоит у нижнего
        // края первого экрана, и при переносе вниз страница «убегала» бы из-под курсора.
        autoScroll={{ canScroll: (el) => el.classList.contains('kb__lane') }}
        sensors={sensors}
        collisionDetection={collisionDetection}
        accessibility={{ announcements, screenReaderInstructions }}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setActiveId(null)}
      >
        <div className="kb__lane">
          <NowColumn
            approvals={approvals}
            manual={manual}
            dragged={dragged}
            actions={actions}
            onAccept={accept}
            onReturn={sendBack}
            onDone={markDone}
          />
          {PROJECTS.map((p) => (
            <ProjectColumn
              key={p.id}
              project={p}
              tasks={tasks.filter((t) => t.project === p.id && isProjectStatus(t.status))}
              dragged={dragged}
              actions={actions}
            />
          ))}
        </div>
        {/* Портал в body: карточка летит за курсором поверх всей страницы, лента колонок
            с overflow её не обрезает. */}
        {mounted &&
          createPortal(
            <DragOverlay dropAnimation={null} zIndex={9999} modifiers={[snapCenterToCursor]}>
              {dragged ? (
                <div className={cx('kb-card kb-card--overlay', dragged.status === 'manual' && 'kb-card--manual')}>
                  {dragged.status === 'manual' ? (
                    <>
                      <span className="kb-check" aria-hidden="true" />
                      <span className="kb-card__handle">
                        <ManualCardBody task={dragged} />
                      </span>
                    </>
                  ) : (
                    <ProjectCardBody task={dragged} />
                  )}
                </div>
              ) : null}
            </DragOverlay>,
            document.body,
          )}
      </DndContext>

      <div className="kb__toasts" role="status" aria-live="polite">
        {toast && (
          <div className="kb-toast" key={toast.key}>
            <Icon d={IC.circleCheck} className="kb-toast__ic" />
            <span className="kb-toast__text">{toast.text}</span>
            <button ref={undoRef} type="button" className="kb-toast__undo" onClick={undo}>
              Отменить
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
