import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  BookOpen,
  ChevronRight,
  FolderOpen,
  LayoutGrid,
  Info,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useProjects } from '@/presentation/hooks/useProjects';
import { avatarColor } from './projectIcons';
import { ProjectIconView } from '@/presentation/components/project/projectIconView';

// Notion-style крошки для страниц проекта: «Проекты ▾ · {проект} ▾ · {вид}».
// Каждый сегмент с иконкой, hover-подсветкой и дропдауном навигации, который
// раскрывается ПРИ НАВЕДЕНИИ (не по клику): «Проекты» → переход к любому проекту;
// сегмент проекта → переключение между его видами.
// Меню «Проекты» двухуровневое, как в Notion: наведение на проект в списке раскрывает
// вложенное окно с его разделами, и клик по разделу ведёт сразу в нужный режим —
// не приходится сначала открывать проект, а потом искать вкладку.
// На тач-устройствах ховера нет, поэтому там тап по строке проекта раскрывает подменю
// (см. onClick у DropdownMenuSubTrigger) — иначе вложенный уровень был бы недостижим.

export type ProjectViewKey = 'board' | 'overview' | 'kb' | 'monitoring' | 'finance';

type ViewDef = { key: ProjectViewKey; label: string; Icon: LucideIcon; path: (id: string) => string };

const VIEWS: readonly ViewDef[] = [
  { key: 'board', label: 'Доска задач', Icon: LayoutGrid, path: (id) => `/projects/${id}` },
  { key: 'overview', label: 'Обзор', Icon: Info, path: (id) => `/projects/${id}/overview` },
  { key: 'kb', label: 'База знаний', Icon: BookOpen, path: (id) => `/projects/${id}/kb` },
  { key: 'monitoring', label: 'Мониторинг', Icon: Activity, path: (id) => `/projects/${id}/monitoring` },
  { key: 'finance', label: 'Финансы', Icon: Wallet, path: (id) => `/projects/${id}/finance` },
];

// Раскрытие дропдауна по наведению с небольшой задержкой на закрытие — чтобы успеть
// перевести курсор с триггера на контент (между ними есть зазор).
function useHoverMenu(): {
  open: boolean;
  setOpen: (v: boolean) => void;
  openNow: () => void;
  closeSoon: () => void;
} {
  const [open, setOpen] = useState(false);
  const timer = useRef<number | null>(null);
  const cancel = (): void => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };
  const openNow = (): void => {
    cancel();
    setOpen(true);
  };
  const closeSoon = (): void => {
    cancel();
    timer.current = window.setTimeout(() => setOpen(false), 140);
  };
  return { open, setOpen, openNow, closeSoon };
}

// Маленький чип-аватар проекта: эмодзи (если задан) или цветная буква (как в сайдбаре).
function ProjectChip({ name, icon }: { name: string; icon?: string | null }): React.ReactElement {
  if (icon) {
    return (
      <span className="grid size-4 shrink-0 place-items-center overflow-hidden text-sm leading-none" aria-hidden>
        <ProjectIconView icon={icon} pixelSize={14} />
      </span>
    );
  }
  return (
    <span
      className={cn(
        'grid size-4 shrink-0 place-items-center rounded text-[9px] font-semibold leading-none',
        avatarColor(name),
      )}
      aria-hidden
    >
      {(name.trim()[0] ?? '?').toUpperCase()}
    </span>
  );
}

// Общий вид сегмента-кнопки (триггер дропдауна). Notion-style: при hover нейтральная
// заливка bg-hover; текущий сегмент — отчётливая мягкая «пилюля» (более плотная заливка),
// чтобы текущая страница ясно читалась, а не выглядела чуть жирнее остальных.
const segmentClass = (current?: boolean): string =>
  cn(
    'flex items-center gap-1.5 rounded-md px-2 py-1 transition-colors',
    current
      ? 'bg-foreground/[0.08] font-medium text-foreground dark:bg-white/[0.10]'
      : 'text-muted-foreground hover:bg-hover hover:text-foreground',
  );

// Подсветка ТЕКУЩЕГО пункта в выпадающих списках крошек — мягкая заливка (как в Notion),
// а не просто жирный шрифт. data-[highlighted] (hover/keyboard) перекрывает её focus-bg'ом.
const CURRENT_DROPDOWN_ITEM_CLASS =
  'bg-foreground/[0.06] font-medium text-foreground dark:bg-white/[0.08]';

// Список разделов проекта рендерится в двух местах — в дропдауне сегмента проекта и во
// вложенном подменю каждого проекта из списка «Проекты». Поэтому он компонент, а не
// скопированный второй раз VIEWS.map: список маршрутов должен оставаться единственным.
// activeKey передаётся только для проекта, который открыт сейчас — у остальных проектов
// в подменю подсвечивать нечего.
function ViewMenuItems({
  projectId,
  activeKey,
}: {
  projectId: string;
  activeKey?: ProjectViewKey;
}): React.ReactElement {
  const navigate = useNavigate();
  return (
    <>
      {VIEWS.map(({ key, label, Icon, path }) => (
        <DropdownMenuItem
          key={key}
          onSelect={() => navigate(path(projectId))}
          className={cn(key === activeKey && CURRENT_DROPDOWN_ITEM_CLASS)}
        >
          <Icon />
          {label}
        </DropdownMenuItem>
      ))}
    </>
  );
}

// Четвёртый сегмент крошек на ОТДЕЛЬНОЙ странице задачи: название текущей задачи +
// hover-дропдаун с недавно редактированными задачами того же проекта для быстрого
// перехода. На обычных страницах проекта не передаётся.
export type BreadcrumbTask = {
  taskId: string;
  title: string;
  // Недавно редактированные задачи проекта (уже отсортированы, обычно ≤8).
  recent: ReadonlyArray<{ id: string; title: string }>;
};

type Props = {
  projectId: string;
  projectName: string;
  projectIcon?: string | null;
  // Активный вид — определяет, какой сегмент «текущий» (жирный, без подсветки-ссылки).
  view: ProjectViewKey;
  // Сегмент задачи (только на странице отдельной задачи). Если задан — текущим
  // становится он, а сегмент проекта снова кликабельный.
  task?: BreadcrumbTask;
};

export function ProjectBreadcrumbs({
  projectId,
  projectName,
  projectIcon,
  view,
  task,
}: Props): React.ReactElement {
  const navigate = useNavigate();
  const { data: projects } = useProjects();
  const allProjects = (projects ?? []).filter((p) => !p.isInbox);

  const projectsMenu = useHoverMenu();
  const viewsMenu = useHoverMenu();
  const taskMenu = useHoverMenu();
  // Тип указателя последнего нажатия по строке проекта. Внутри самого click отличить
  // мышь от тапа надёжно нельзя (у синтезированного click pointerType в части браузеров
  // пустой), поэтому запоминаем его на pointerdown — он приходит непосредственно перед
  // click по тому же элементу. Дефолт 'mouse' — на случай клика без pointerdown
  // (программный .click(), часть ассистивных технологий): это прежнее поведение.
  const rowPointerType = useRef<string>('mouse');
  const currentView = VIEWS.find((v) => v.key === view);

  return (
    <nav
      // pf-burger-gap — общий маркер «здесь может стоять плавающий бургер». Величину и
      // условие держит одно правило в globals.css, включаемое атрибутом на корне AppShell.
      // Раньше эта строка считала отступ сама (collapsed && 'pl-10'), и после того как бургер
      // подрос, у неё осталось 40px против 44px у всех остальных строк — одна и та же шапка
      // прыгала на 4px при переходе «Входящие ↔ проект». Второй источник числа убран.
      className="pf-burger-gap flex min-w-0 items-center gap-0.5 text-sm"
      aria-label="Хлебные крошки"
    >
      {/* Сегмент «Проекты» — дропдаун со всеми проектами для быстрого перехода. */}
      <DropdownMenu open={projectsMenu.open} onOpenChange={projectsMenu.setOpen} modal={false}>
        <DropdownMenuTrigger
          className={segmentClass()}
          onMouseEnter={projectsMenu.openNow}
          onMouseLeave={projectsMenu.closeSoon}
        >
          <FolderOpen className="size-3.5 shrink-0" />
          <span>Проекты</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          // Геометрия панели крошки по замерам Notion (MEASURED.md §6): ширина 240,
          // радиус 10px, отступ от крошки ~4px. Общий DropdownMenuContent даёт
          // rounded-md (6px) и sideOffset 8, поэтому перекрываем на месте.
          sideOffset={4}
          className="max-h-80 w-60 overflow-y-auto rounded-[10px]"
          onMouseEnter={projectsMenu.openNow}
          onMouseLeave={projectsMenu.closeSoon}
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <DropdownMenuLabel>Перейти к проекту</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {allProjects.map((p) => (
            <DropdownMenuSub key={p.id}>
              <DropdownMenuSubTrigger
                className={cn(
                  // transition-colors и focus:text-accent-foreground есть у DropdownMenuItem,
                  // но не у SubTrigger — без них строки проектов подсвечивались рывком и не
                  // меняли цвет текста, хотя пункты подменю (те же Item) в этом же меню
                  // анимируются. Дублируем, чтобы список выглядел однородно.
                  'min-w-0 transition-colors focus:text-accent-foreground data-[state=open]:text-accent-foreground',
                  p.id === projectId && CURRENT_DROPDOWN_ITEM_CLASS,
                )}
                onPointerDown={(e) => {
                  rowPointerType.current = e.pointerType || 'mouse';
                }}
                onClick={(e) => {
                  // Тач и перо: ховера нет, а Radix раскрывает подменю указателем только для
                  // мыши (onPointerMove обёрнут в whenMouse), поэтому click — единственный
                  // путь к подменю с пальца. Отдаём его Radix: тап раскрывает подменю, раздел
                  // выбирается вторым тапом. Прежний однотапный переход на доску стоит на
                  // телефоне один лишний тап («Доска задач» — первый пункт подменю), зато
                  // раздел достижим вообще: гасить click здесь, как для мыши, значило бы
                  // оставить телефон без этой фичи (крошки видны на страницах проекта,
                  // мониторинга и финансов без брейкпоинта).
                  if (rowPointerType.current !== 'mouse') return;
                  // Мышь: подменю и так раскрывается ховером, поэтому клик по самой строке
                  // сохраняем как быстрый переход на доску — это самый частый сценарий,
                  // гонять за ним в подменю — лишний шаг.
                  // preventDefault гасит штатную реакцию Radix (раскрыть подменю по клику),
                  // а закрыть меню приходится вручную: SubTrigger — не Item и события
                  // выбора не шлёт.
                  e.preventDefault();
                  projectsMenu.setOpen(false);
                  navigate(`/projects/${p.id}`);
                }}
              >
                <ProjectChip name={p.name} icon={p.icon} />
                <span className="min-w-0 truncate">{p.name}</span>
              </DropdownMenuSubTrigger>
              {/* Портал обязателен: без него подменю обрежется скроллом родительского
                  списка (у него overflow-y-auto под длинный список проектов). */}
              <DropdownMenuPortal>
                <DropdownMenuSubContent
                  // Своих hover-обработчиков здесь быть НЕ ДОЛЖНО. React рассылает
                  // mouseenter/mouseleave по ФАЙБЕР-дереву, а не по DOM (react-dom идёт по
                  // fiber.return и проскакивает портал), и останавливается НА общем предке,
                  // исключая его. Общий предок пары «пункт подменю ↔ строка проекта» — сам
                  // DropdownMenuContent, поэтому его пара обработчиков уже покрывает все
                  // переходы:
                  //   • список → подменю: leave у Content не зовётся, меню живо;
                  //   • подменю → обратно в список: то же самое, меню живо;
                  //   • подменю → мимо меню: цепочка leave идёт ЧЕРЕЗ Content → closeSoon;
                  //   • обратно в меню (в любую панель): enter тоже идёт через Content →
                  //     openNow отменяет таймер.
                  // Дубль closeSoon на подменю ронял ВСЁ меню при возврате курсора из
                  // подменю в список проектов: таймер запускался, а onMouseEnter у Content
                  // в этом переходе не срабатывает и отменить его было некому.
                  //
                  // -4px = внутренний padding контента: так первый пункт подменю встаёт
                  // ровно напротив строки проекта, а не ниже неё.
                  alignOffset={-4}
                  className="w-60 rounded-[10px]"
                >
                  <ViewMenuItems
                    projectId={p.id}
                    activeKey={p.id === projectId ? view : undefined}
                  />
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <ChevronRight className="size-4 shrink-0 text-muted-foreground/50" />

      {/* Сегмент проекта — дропдаун с видами (Доска / Обзор / База знаний / …). */}
      <DropdownMenu open={viewsMenu.open} onOpenChange={viewsMenu.setOpen} modal={false}>
        <DropdownMenuTrigger
          className={cn(segmentClass(view === 'board' && !task), 'min-w-0')}
          onMouseEnter={viewsMenu.openNow}
          onMouseLeave={viewsMenu.closeSoon}
        >
          <ProjectChip name={projectName} icon={projectIcon} />
          {/* Длинное имя проекта обрезаем многоточием, чтобы крошки не растягивали хедер. */}
          <span className="min-w-0 max-w-[9rem] truncate sm:max-w-[14rem]">{projectName}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          // Тот же список разделов, что и в подменю «Проекты» → та же геометрия (MEASURED.md §6).
          sideOffset={4}
          className="w-60 rounded-[10px]"
          onMouseEnter={viewsMenu.openNow}
          onMouseLeave={viewsMenu.closeSoon}
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <DropdownMenuLabel>Разделы проекта</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <ViewMenuItems projectId={projectId} activeKey={view} />
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Сегмент задачи — на отдельной странице задачи. Текущий (пилюля) + hover-дропдаун
          с недавними задачами проекта для быстрого перехода между ними. */}
      {task && (
        <>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground/50" />
          <DropdownMenu open={taskMenu.open} onOpenChange={taskMenu.setOpen} modal={false}>
            <DropdownMenuTrigger
              className={cn(segmentClass(true), 'min-w-0')}
              onMouseEnter={taskMenu.openNow}
              onMouseLeave={taskMenu.closeSoon}
            >
              <span className="min-w-0 max-w-[7rem] truncate sm:max-w-[12rem]">{task.title}</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              // Радиус и отступ — как у соседних панелей этой же строки. Ширину оставляем
              // 256: здесь длинные названия задач, а 240 из MEASURED.md §6 снято с панели
              // навигации, не с этого списка.
              sideOffset={4}
              className="max-h-80 w-64 overflow-y-auto rounded-[10px]"
              onMouseEnter={taskMenu.openNow}
              onMouseLeave={taskMenu.closeSoon}
              onCloseAutoFocus={(e) => e.preventDefault()}
            >
              <DropdownMenuLabel>Недавние задачи</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {task.recent.length === 0 ? (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">Других задач нет</div>
              ) : (
                task.recent.map((t) => (
                  <DropdownMenuItem
                    key={t.id}
                    onSelect={() => navigate(`/projects/${projectId}/tasks/${t.id}`)}
                    className={cn('min-w-0', t.id === task.taskId && CURRENT_DROPDOWN_ITEM_CLASS)}
                  >
                    <span className="truncate">{t.title}</span>
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}

      {/* Третий сегмент — текущий вид (если это не «Доска», которая совпадает с проектом). */}
      {view !== 'board' && currentView && (
        <>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground/50" />
          <span className={cn(segmentClass(true), 'pointer-events-none')}>
            <currentView.Icon className="size-3.5 shrink-0" />
            <span className="truncate">{currentView.label}</span>
          </span>
        </>
      )}
    </nav>
  );
}
