import React, { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowRight,
  ArrowUpRight,
  Calculator,
  Check,
  CheckCircle2,
  Cpu,
  ExternalLink,
  Layers,
  Play,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Zap,
} from 'lucide-react';
import {
  TARIFF_OPTIONS,
  type StackLayerId,
  type StackLayerSpec,
  type TariffOption,
} from '../../data/showcaseData';

interface GrowCalculatorSectionProps {
  activeLayer: StackLayerSpec;
  activeTariff: TariffOption;
  spinTrigger: number;
  isAuthed: boolean;
  appBase: string;
  onSelectLayer: (id: StackLayerId) => void;
  onSelectTariff: (t: TariffOption) => void;
}

type BoardColumnId = 'queue' | 'running' | 'review' | 'done';

interface DemoBoardTask {
  id: string;
  project: 'Сайт кофейни' | 'Бот записи' | 'Лендинг запуска';
  projectColor: string;
  title: string;
  subtitle: string;
  column: BoardColumnId;
  duration: string;
  checks: string;
  previewHost?: string;
}

const INITIAL_BOARD_TASKS: DemoBoardTask[] = [
  {
    id: 't-1',
    project: 'Сайт кофейни',
    projectColor: '#ff2e63',
    title: 'Отзывы гостей и рейтинг с Яндекс Карт',
    subtitle: 'Автосинхронизация карточек и фильтр по оценке',
    column: 'review',
    duration: '11 мин',
    checks: '4/4 PASS',
    previewHost: 'kofeinia-reviews.pf.app',
  },
  {
    id: 't-2',
    project: 'Бот записи',
    projectColor: '#9d4edd',
    title: 'Оплата бронирования через СБП (предоплата 30%)',
    subtitle: 'Webhook банка + автоподтверждение в Telegram',
    column: 'running',
    duration: '14 мин',
    checks: 'Сборка E2E…',
  },
  {
    id: 't-3',
    project: 'Лендинг запуска',
    projectColor: '#00b4d8',
    title: 'Калькулятор тарифов и сравнение планов',
    subtitle: 'Адаптивная сетка + привязка к эквайрингу',
    column: 'queue',
    duration: '9 мин',
    checks: 'Готов к запуску',
  },
  {
    id: 't-4',
    project: 'Бот записи',
    projectColor: '#9d4edd',
    title: 'Напоминание клиенту и мастеру за 1 час до визита',
    subtitle: 'Очередь отложенных уведомлений + кнопка переноса',
    column: 'queue',
    duration: '8 мин',
    checks: 'Готов к запуску',
  },
  {
    id: 't-5',
    project: 'Сайт кофейни',
    projectColor: '#ff2e63',
    title: 'Меню напитков с конструктором сиропов и объёма',
    subtitle: 'Корзина в 1 клик + расчёт себестоимости в ₽',
    column: 'done',
    duration: '12 мин',
    checks: 'В проде',
    previewHost: 'kofeinia.pf.app',
  },
  {
    id: 't-6',
    project: 'Лендинг запуска',
    projectColor: '#00b4d8',
    title: 'Автоворонка писем после регистрации',
    subtitle: 'Шаблоны приветствия + аналитика открытий',
    column: 'done',
    duration: '10 мин',
    checks: 'В проде',
  },
];

const BOARD_COLUMNS: {
  id: BoardColumnId;
  title: string;
  badgeColor: string;
  dotColor: string;
}[] = [
  {
    id: 'queue',
    title: 'В очереди',
    badgeColor: 'bg-white/10 text-white/80 border-white/15',
    dotColor: '#94a3b8',
  },
  {
    id: 'running',
    title: 'ИИ делает сейчас',
    badgeColor: 'bg-purple-500/20 text-purple-200 border-purple-400/35',
    dotColor: '#c77dff',
  },
  {
    id: 'review',
    title: 'На утверждении',
    badgeColor: 'bg-amber-500/20 text-amber-200 border-amber-400/35',
    dotColor: '#fbbf24',
  },
  {
    id: 'done',
    title: 'Готово в проде',
    badgeColor: 'bg-rose-500/20 text-rose-200 border-rose-400/35',
    dotColor: '#ff2e63',
  },
];

export const GrowCalculatorSection: React.FC<GrowCalculatorSectionProps> = ({
  activeTariff,
  isAuthed,
  appBase,
  onSelectLayer,
  onSelectTariff,
}) => {
  // Interactive Live Board State
  const [tasks, setTasks] = useState<DemoBoardTask[]>(INITIAL_BOARD_TASKS);
  const [selectedProject, setSelectedProject] = useState<string>('Все проекты');
  const [toastMessage, setToastMessage] = useState<string | null>(
    'Нажмите кнопку на любой карточке, чтобы продвинуть задачу по пайплайну ИИ'
  );

  // Calculator State
  const [projectsPerMonth, setProjectsPerMonth] = useState<number>(3);
  const [teamSize, setTeamSize] = useState<number>(2);
  const [claudeSource, setClaudeSource] = useState<'builtin' | 'own'>('builtin');

  const externalClaudeAndVpnCost =
    claudeSource === 'builtin' ? teamSize * 3200 + 900 : 0;
  const savedDevHours = projectsPerMonth * 18;
  const savedRoutineRub = projectsPerMonth * 14500 + externalClaudeAndVpnCost;
  const netMonthlyBenefit = Math.max(0, savedRoutineRub - activeTariff.priceRub);

  const projectFilters = ['Все проекты', 'Сайт кофейни', 'Бот записи', 'Лендинг запуска'];

  const filteredTasks = tasks.filter(
    (t) => selectedProject === 'Все проекты' || t.project === selectedProject
  );

  const doneCount = tasks.filter((t) => t.column === 'done').length + 6;

  const advanceTask = (taskId: string) => {
    setTasks((prev) =>
      prev.map((task) => {
        if (task.id !== taskId) return task;
        if (task.column === 'queue') {
          setToastMessage(`Claude взял в работу: «${task.title}»`);
          onSelectLayer('layer-autopilot');
          return { ...task, column: 'running', checks: 'Сборка E2E…' };
        }
        if (task.column === 'running') {
          setToastMessage(`Готов превью-стенд (4/4 PASS): «${task.title}»`);
          onSelectLayer('layer-deploy');
          return {
            ...task,
            column: 'review',
            checks: '4/4 PASS',
            previewHost: 'preview-stage.pf.app',
          };
        }
        if (task.column === 'review') {
          setToastMessage(`Выкачено в прод: «${task.title}»`);
          onSelectLayer('layer-finance');
          return { ...task, column: 'done', checks: 'В проде' };
        }
        return task;
      })
    );
  };

  const resetDemoBoard = () => {
    setTasks(INITIAL_BOARD_TASKS);
    setSelectedProject('Все проекты');
    setToastMessage('Демо-доска возвращена в исходное состояние');
  };

  return (
    <div className="relative z-10 max-w-[1440px] mx-auto px-4 sm:px-8 py-12 space-y-20">
      {/* PART 1: LIVE INTERACTIVE KANBAN BOARD (#live-board) */}
      <section id="live-board" className="scroll-mt-24">
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 mb-8">
          <div>
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-rose-500/15 border border-rose-400/30 mb-3">
              <Zap className="w-3.5 h-3.5 text-rose-400" />
              <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-rose-200">
                Интерактивное демо · Нажимайте на кнопки внутри карточек
              </span>
            </div>
            <h2 className="font-display font-black uppercase text-3xl sm:text-5xl leading-[0.96] tracking-[-0.03em] text-white">
              ЖИВАЯ ДОСКА{' '}
              <span className="text-rose-400">АВТОПИЛОТА</span>
            </h2>
          </div>

          <p className="text-white/75 text-sm sm:text-base max-w-md">
            Передавайте задачи ИИ-воркеру, проверяйте готовый стенд и принимайте релизы в прод в один клик.
          </p>
        </div>

        {/* Dark Glass Interactive App Frame */}
        <div className="rounded-[32px] bg-[#12071c]/95 border border-white/20 shadow-[0_32px_90px_rgba(0,0,0,0.75)] backdrop-blur-2xl overflow-hidden">
          {/* Top App Bar */}
          <div className="px-5 sm:px-7 py-4 bg-[#1a0a2a]/90 border-b border-white/12 flex flex-wrap items-center justify-between gap-4">
            {/* Left Breadcrumbs */}
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-lg bg-rose-500 flex items-center justify-center font-display font-black text-xs text-white shadow">
                M
              </div>
              <span className="text-xs sm:text-sm font-bold text-white/70">Мастерская</span>
              <span className="text-white/30">/</span>
              <span className="text-xs sm:text-sm font-extrabold text-white flex items-center gap-1.5">
                <Layers className="w-4 h-4 text-rose-400" />
                Входящие и Автопилот
              </span>
            </div>

            {/* Project Filter Chips */}
            <div className="flex flex-wrap items-center gap-1.5">
              {projectFilters.map((proj) => {
                const active = selectedProject === proj;
                return (
                  <button
                    key={proj}
                    type="button"
                    onClick={() => setSelectedProject(proj)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                      active
                        ? 'bg-white text-[#12061c] shadow'
                        : 'bg-white/[0.06] text-white/70 hover:text-white hover:bg-white/[0.12]'
                    }`}
                  >
                    {proj}
                  </button>
                );
              })}
            </div>

            {/* Right Status + Reset */}
            <div className="flex items-center gap-2.5">
              <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-400/15 border border-amber-300/30 text-xs font-mono font-bold text-amber-200">
                <CheckCircle2 className="w-3.5 h-3.5 text-amber-300" />
                <span>{doneCount} сделано сегодня</span>
              </div>
              <button
                type="button"
                onClick={resetDemoBoard}
                title="Сбросить демо-доску"
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.14] border border-white/15 text-xs font-mono text-white/75 hover:text-white transition-colors cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Сбросить</span>
              </button>
            </div>
          </div>

          {/* 4-Column Kanban Grid */}
          <div className="p-5 sm:p-7 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 sm:gap-5">
            {BOARD_COLUMNS.map((col) => {
              const colTasks = filteredTasks.filter((t) => t.column === col.id);
              return (
                <div
                  key={col.id}
                  className="rounded-2xl p-4 bg-white/[0.03] border border-white/10 flex flex-col justify-between min-h-[340px]"
                >
                  <div>
                    {/* Column Header */}
                    <div className="flex items-center justify-between gap-2 mb-4 pb-2.5 border-b border-white/10">
                      <div className="flex items-center gap-2">
                        <span
                          className="w-2.5 h-2.5 rounded-full"
                          style={{ backgroundColor: col.dotColor }}
                        />
                        <span className="font-bold text-sm text-white">{col.title}</span>
                      </div>
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-xs font-mono font-bold border ${col.badgeColor}`}
                      >
                        {colTasks.length}
                      </span>
                    </div>

                    {/* Cards List */}
                    <div className="space-y-3">
                      <AnimatePresence mode="popLayout">
                        {colTasks.map((task) => (
                          <motion.div
                            key={task.id}
                            layout
                            initial={{ opacity: 0, scale: 0.95, y: 10 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.92 }}
                            transition={{ type: 'spring', stiffness: 320, damping: 26 }}
                            className="rounded-2xl p-4 bg-[#1d0c2e]/95 border border-white/15 hover:border-white/35 shadow-lg transition-colors flex flex-col justify-between gap-3"
                          >
                            <div>
                              {/* Top Project Tag & Duration */}
                              <div className="flex items-center justify-between gap-2 mb-2">
                                <span
                                  className="px-2.5 py-0.5 rounded-md text-[11px] font-bold text-white border"
                                  style={{
                                    backgroundColor: `${task.projectColor}28`,
                                    borderColor: `${task.projectColor}66`,
                                  }}
                                >
                                  {task.project}
                                </span>
                                <span className="font-mono text-[11px] text-white/60">
                                  ⏱ {task.duration}
                                </span>
                              </div>

                              {/* Title & Subtitle */}
                              <h3 className="font-bold text-sm text-white leading-snug mb-1">
                                {task.title}
                              </h3>
                              <p className="text-xs text-white/65 leading-relaxed">
                                {task.subtitle}
                              </p>
                            </div>

                            {/* Live Running Progress Bar */}
                            {task.column === 'running' && (
                              <div className="space-y-1.5 pt-1">
                                <div className="flex items-center justify-between text-[11px] font-mono text-purple-200">
                                  <span className="flex items-center gap-1.5">
                                    <Cpu className="w-3.5 h-3.5 text-purple-300 animate-spin" />
                                    Claude пишет код…
                                  </span>
                                  <span>78%</span>
                                </div>
                                <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
                                  <div className="h-full w-[78%] rounded-full bg-gradient-to-r from-rose-500 to-purple-400" />
                                </div>
                              </div>
                            )}

                            {/* Preview URL Pill for Review/Done */}
                            {task.previewHost && (
                              <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-black/40 border border-white/10 text-[11px] font-mono text-sky-300">
                                <span className="truncate">{task.previewHost}</span>
                                <ExternalLink className="w-3 h-3 shrink-0 ml-1" />
                              </div>
                            )}

                            {/* Card Footer Action */}
                            <div className="pt-2 border-t border-white/10 flex items-center justify-between gap-2">
                              <span className="font-mono text-[11px] font-bold text-amber-300 flex items-center gap-1">
                                <ShieldCheck className="w-3.5 h-3.5" />
                                {task.checks}
                              </span>

                              {task.column === 'queue' && (
                                <button
                                  type="button"
                                  onClick={() => advanceTask(task.id)}
                                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-white/10 hover:bg-rose-500 text-white text-xs font-bold transition-colors cursor-pointer"
                                >
                                  <Play className="w-3 h-3" />
                                  <span>Запустить ИИ</span>
                                </button>
                              )}

                              {task.column === 'running' && (
                                <button
                                  type="button"
                                  onClick={() => advanceTask(task.id)}
                                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-purple-500 hover:bg-purple-400 text-white text-xs font-bold transition-colors cursor-pointer"
                                >
                                  <span>На проверку</span>
                                  <ArrowRight className="w-3 h-3" />
                                </button>
                              )}

                              {task.column === 'review' && (
                                <button
                                  type="button"
                                  onClick={() => advanceTask(task.id)}
                                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-white hover:bg-rose-50 text-[#12061c] text-xs font-extrabold transition-colors shadow cursor-pointer"
                                >
                                  <Check className="w-3.5 h-3.5 text-rose-600" />
                                  <span>Принять в прод</span>
                                </button>
                              )}

                              {task.column === 'done' && (
                                <span className="font-mono text-[11px] font-bold text-rose-300">
                                  ✓ Готово
                                </span>
                              )}
                            </div>
                          </motion.div>
                        ))}
                      </AnimatePresence>

                      {colTasks.length === 0 && (
                        <div className="rounded-xl p-6 border border-dashed border-white/15 text-center text-xs text-white/45">
                          Нет задач в этой колонке
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Bottom Interactive Status Bar */}
          {toastMessage && (
            <div className="px-5 sm:px-7 py-3.5 bg-[#0d0416] border-t border-white/12 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2 text-white/85">
                <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping" />
                <span className="font-medium">{toastMessage}</span>
              </div>
              <a
                href={isAuthed ? `${appBase}/projects` : `${appBase}/login`}
                className="font-mono font-bold text-rose-300 hover:text-white transition-colors inline-flex items-center gap-1"
              >
                <span>Открыть свою доску в ProjectsFlow</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </a>
            </div>
          )}
        </div>
      </section>

      {/* PART 2: CLEAN ROI & SAVINGS CALCULATOR (#grow-calculator) */}
      <section id="grow-calculator" className="scroll-mt-24">
        <div className="relative rounded-[36px] p-7 sm:p-12 bg-gradient-to-br from-[#230b36] via-[#140720] to-[#0a0412] border border-white/20 shadow-[0_32px_100px_rgba(0,0,0,0.65)] overflow-hidden">
          <div className="hidden lg:flex absolute inset-x-0 top-6 justify-center pointer-events-none select-none z-0 opacity-[0.07]">
            <span className="font-display font-black uppercase text-[120px] xl:text-[150px] leading-none tracking-[-0.05em] text-white">
              ВЫГОДА ₽
            </span>
          </div>

          <div className="relative z-10">
            <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 mb-10">
              <div>
                <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-amber-400/15 border border-amber-300/30 mb-3">
                  <Calculator className="w-3.5 h-3.5 text-amber-300" />
                  <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-amber-200">
                    Калькулятор выгоды в рублях
                  </span>
                </div>
                <h2 className="font-display font-black uppercase text-3xl sm:text-5xl leading-[0.95] tracking-[-0.03em] text-white">
                  СКОЛЬКО ВЫ{' '}
                  <span className="text-amber-300">ЭКОНОМИТЕ</span>
                </h2>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
              {/* Left 7 cols: 2 Clean Sliders + 1 Toggle */}
              <div className="lg:col-span-7 rounded-[28px] p-6 sm:p-8 bg-white/[0.05] border border-white/15 backdrop-blur-xl flex flex-col justify-between space-y-7">
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-base font-bold text-white">
                      1. Запускаемых проектов в месяц
                    </span>
                    <span className="font-display font-black text-2xl text-rose-400">
                      {projectsPerMonth} пр.
                    </span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={10}
                    value={projectsPerMonth}
                    onChange={(e) => setProjectsPerMonth(Number(e.target.value))}
                    className="w-full accent-rose-500 cursor-pointer h-2 bg-white/15 rounded-lg"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-base font-bold text-white">
                      2. Человек в команде
                    </span>
                    <span className="font-display font-black text-2xl text-purple-300">
                      {teamSize} чел.
                    </span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={12}
                    value={teamSize}
                    onChange={(e) => setTeamSize(Number(e.target.value))}
                    className="w-full accent-purple-400 cursor-pointer h-2 bg-white/15 rounded-lg"
                  />
                </div>

                <div>
                  <span className="font-mono text-xs uppercase tracking-wider text-white/60 block mb-2.5">
                    3. Подписка Claude:
                  </span>
                  <div className="grid grid-cols-2 gap-2 p-1.5 rounded-2xl bg-black/40 border border-white/15">
                    <button
                      type="button"
                      onClick={() => {
                        setClaudeSource('builtin');
                        onSelectTariff(TARIFF_OPTIONS[1]!);
                      }}
                      className={`py-3 px-4 rounded-xl text-xs sm:text-sm font-extrabold transition-all cursor-pointer ${
                        claudeSource === 'builtin'
                          ? 'bg-rose-500 text-white shadow-md'
                          : 'text-white/70 hover:text-white'
                      }`}
                    >
                      Встроенный Claude от нас
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setClaudeSource('own');
                        onSelectTariff(TARIFF_OPTIONS[0]!);
                      }}
                      className={`py-3 px-4 rounded-xl text-xs sm:text-sm font-extrabold transition-all cursor-pointer ${
                        claudeSource === 'own'
                          ? 'bg-white text-[#140720] shadow-md'
                          : 'text-white/70 hover:text-white'
                      }`}
                    >
                      Свой Claude (0 ₽)
                    </button>
                  </div>
                </div>
              </div>

              {/* Right 5 cols: Single Big Result Card */}
              <div className="lg:col-span-5 rounded-[28px] p-7 sm:p-8 bg-gradient-to-b from-rose-500/25 via-[#1a092b] to-[#11061c] border-2 border-rose-400/50 shadow-2xl flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between gap-2 mb-4">
                    <span className="font-mono text-xs font-bold uppercase text-amber-300 flex items-center gap-1.5">
                      <TrendingUp className="w-4 h-4" />
                      ВАША ВЫГОДА В МЕСЯЦ
                    </span>
                    <span className="px-3 py-1 rounded-full bg-white/15 font-mono text-xs font-bold text-white">
                      {activeTariff.name}
                    </span>
                  </div>

                  <motion.div
                    key={netMonthlyBenefit}
                    initial={{ scale: 0.95, opacity: 0.7 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="font-display font-black text-4xl sm:text-5xl text-white tracking-tight mb-6"
                  >
                    +{netMonthlyBenefit.toLocaleString('ru-RU')} ₽
                  </motion.div>

                  <div className="space-y-3 text-sm border-t border-white/15 pt-4">
                    <div className="flex items-center justify-between text-white/80">
                      <span>Сэкономлено времени:</span>
                      <span className="font-mono font-bold text-amber-300">
                        ~{savedDevHours} часов
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-white/80">
                      <span>Экономия на VPN и ключах:</span>
                      <span className="font-mono font-bold text-purple-300">
                        {externalClaudeAndVpnCost.toLocaleString('ru-RU')} ₽
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-white/80">
                      <span>Стоимость тарифа:</span>
                      <span className="font-mono font-bold text-white">
                        {activeTariff.priceFormatted}
                      </span>
                    </div>
                  </div>
                </div>

                <a
                  href={isAuthed ? `${appBase}/projects` : `${appBase}/login`}
                  className="mt-7 w-full inline-flex items-center justify-center gap-2 px-6 py-4 rounded-2xl bg-white hover:bg-rose-50 text-[#140720] font-extrabold text-sm transition-all shadow-lg"
                >
                  <Sparkles className="w-4 h-4 text-rose-600" />
                  <span>{activeTariff.ctaText}</span>
                  <ArrowUpRight className="w-4 h-4" />
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* PART 3: 3 TARIFF CARDS (#pricing) */}
      <section id="pricing" className="scroll-mt-24">
        <div className="text-center max-w-2xl mx-auto mb-10">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/10 border border-white/20 mb-3">
            <Cpu className="w-3.5 h-3.5 text-purple-300" />
            <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-white/90">
              Прозрачные тарифы в рублях · 1 час Прайма бесплатно
            </span>
          </div>
          <h2 className="font-display font-black uppercase text-3xl sm:text-5xl leading-[0.96] tracking-[-0.03em] text-white">
            ТАРИФЫ{' '}
            <span className="text-rose-400">PROJECTSFLOW</span>
          </h2>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch">
          {TARIFF_OPTIONS.map((t) => {
            const isSelected = t.id === activeTariff.id;
            return (
              <div
                key={t.id}
                onClick={() => onSelectTariff(t)}
                className={`rounded-[30px] p-7 border transition-all cursor-pointer flex flex-col justify-between relative ${
                  t.highlight
                    ? 'bg-gradient-to-b from-[#2c0e3d] to-[#12061c] border-rose-400/70 shadow-[0_28px_80px_rgba(255,46,99,0.22)]'
                    : isSelected
                      ? 'bg-[#1b0b2b] border-white/50 shadow-2xl'
                      : 'bg-[#11061c]/85 border-white/15 hover:border-white/30'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-4">
                    <span
                      className={`font-mono text-[10px] font-extrabold uppercase px-3 py-1 rounded-full ${
                        t.highlight
                          ? 'bg-rose-500 text-white'
                          : 'bg-white/10 text-white/80'
                      }`}
                    >
                      {t.badge}
                    </span>
                    {isSelected && (
                      <span className="font-mono text-[10px] font-bold text-amber-300">
                        ● Активен в 3D
                      </span>
                    )}
                  </div>

                  <h3 className="font-display font-black text-2xl text-white mb-1">
                    {t.name}
                  </h3>
                  <div className="flex items-baseline gap-2 mb-3">
                    <span className="font-display font-black text-4xl text-white">
                      {t.priceFormatted}
                    </span>
                    <span className="text-xs font-mono text-white/60">
                      / {t.period}
                    </span>
                  </div>

                  <p className="text-sm text-white/75 leading-relaxed mb-6">
                    {t.summary}
                  </p>

                  <ul className="space-y-2.5 mb-7">
                    {t.features.map((f) => (
                      <li key={f} className="flex items-start gap-2.5 text-sm text-white/90">
                        <Check className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <a
                  href={isAuthed ? `${appBase}/projects` : `${appBase}/login`}
                  onClick={(e) => e.stopPropagation()}
                  className={`w-full inline-flex items-center justify-center gap-2 py-4 px-5 rounded-2xl font-extrabold text-xs uppercase tracking-wider transition-all ${
                    t.highlight
                      ? 'bg-white text-[#140720] hover:bg-rose-50 shadow-lg'
                      : 'bg-white/10 hover:bg-white/20 text-white border border-white/15'
                  }`}
                >
                  <span>{t.ctaText}</span>
                  <ArrowUpRight className="w-4 h-4" />
                </a>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
};
