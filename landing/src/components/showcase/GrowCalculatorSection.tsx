import React, { useState } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowUpRight,
  Calculator,
  Check,
  Cpu,
  Sparkles,
  TrendingUp,
  Zap,
} from 'lucide-react';
import KanbanBoard from '../KanbanBoard';
import {
  STACK_LAYERS,
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

export const GrowCalculatorSection: React.FC<GrowCalculatorSectionProps> = ({
  activeLayer,
  activeTariff,
  isAuthed,
  appBase,
  onSelectLayer,
  onSelectTariff,
}) => {
  const [projectsPerMonth, setProjectsPerMonth] = useState<number>(3);
  const [teamSize, setTeamSize] = useState<number>(2);
  const [claudeSource, setClaudeSource] = useState<'builtin' | 'own'>('builtin');

  // Calculate real unit economics in rubles
  const externalClaudeAndVpnCost =
    claudeSource === 'builtin' ? teamSize * 3200 + 900 : 0;
  const savedDevHours = projectsPerMonth * 18;
  const savedRoutineRub = projectsPerMonth * 14500 + externalClaudeAndVpnCost;
  const netMonthlyBenefit = Math.max(0, savedRoutineRub - activeTariff.priceRub);

  return (
    <div className="relative z-10 max-w-[1440px] mx-auto px-4 sm:px-8 py-12 space-y-20">
      {/* PART 1: LIVE INTERACTIVE KANBAN BOARD (#live-board) */}
      <section id="live-board" className="scroll-mt-24">
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 mb-8">
          <div>
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-lime-400/10 border border-lime-400/30 mb-3">
              <Zap className="w-3.5 h-3.5 text-lime-400" />
              <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-lime-300">
                Слой 02 в действии · Интерактивная демо-доска
              </span>
            </div>
            <h2 className="font-display font-black uppercase text-3xl sm:text-5xl leading-[0.96] tracking-[-0.03em] text-white">
              ЖИВАЯ ДОСКА{' '}
              <span className="text-lime-400">АВТОПИЛОТА</span>
            </h2>
          </div>

          <p className="text-white/70 text-sm sm:text-base max-w-md">
            Нажимайте на карточки задач, переключайте вкладки и фильтруйте по ролям —
            именно так выглядит проект, когда его ведёт встроенный Claude.
          </p>
        </div>

        <div className="rounded-[32px] p-3 sm:p-5 bg-[#080d18]/90 border border-white/20 shadow-[0_32px_90px_rgba(0,0,0,0.65)] backdrop-blur-2xl">
          <KanbanBoard />
        </div>
      </section>

      {/* PART 2: UNIT ECONOMICS & ROI REACTOR (#grow-calculator, inspired by Pinterest pin-01.jpg & Quantix) */}
      <section id="grow-calculator" className="scroll-mt-24">
        <div className="relative rounded-[36px] p-6 sm:p-10 lg:p-12 bg-gradient-to-br from-[#0b1324] via-[#080d18] to-[#060911] border border-white/20 shadow-[0_32px_100px_rgba(0,0,0,0.7)] overflow-hidden">
          {/* Giant Subtle Backdrop Word */}
          <div className="hidden lg:flex absolute inset-x-0 top-6 justify-center pointer-events-none select-none z-0 opacity-[0.06]">
            <span className="font-display font-black uppercase text-[120px] xl:text-[150px] leading-none tracking-[-0.05em] text-white">
              ЭКОНОМИКА ₽
            </span>
          </div>

          <div className="relative z-10">
            <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 mb-10">
              <div>
                <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-emerald-500/15 border border-emerald-400/30 mb-3">
                  <Calculator className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-emerald-300">
                    Слой 03 · Калькулятор окупаемости в рублях
                  </span>
                </div>
                <h2 className="font-display font-black uppercase text-3xl sm:text-5xl leading-[0.95] tracking-[-0.03em] text-white">
                  РЕАКТОР ВЫГОДЫ{' '}
                  <span className="text-emerald-400">И ЮНИТ-МАРЖИ</span>
                </h2>
              </div>

              <p className="text-white/70 text-sm max-w-md">
                Посчитайте, сколько времени и рублей экономит встроенная подписка на Claude
                и автоматизация спринтов по сравнению с разрозненными сервисами.
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
              {/* Left 7 cols: Interactive Sliders & Architectural Focus */}
              <div className="lg:col-span-7 rounded-[28px] p-6 sm:p-8 bg-white/[0.04] border border-white/15 backdrop-blur-xl flex flex-col justify-between space-y-6">
                {/* 1. Projects per month slider */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-bold text-white">
                      1. Запускаемых проектов или крупных релизов в месяц:
                    </span>
                    <span className="font-display font-black text-xl text-lime-400">
                      {projectsPerMonth} пр.
                    </span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={10}
                    value={projectsPerMonth}
                    onChange={(e) => setProjectsPerMonth(Number(e.target.value))}
                    className="w-full accent-lime-400 cursor-pointer h-2 bg-white/15 rounded-lg"
                  />
                  <div className="flex justify-between text-[11px] font-mono text-white/45 mt-1">
                    <span>1 пет-проект</span>
                    <span>3–5 клиентских задач</span>
                    <span>10+ поток студии</span>
                  </div>
                </div>

                {/* 2. Team Size slider */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-bold text-white">
                      2. Участников (разработчики, продакты, основатели):
                    </span>
                    <span className="font-display font-black text-xl text-sky-400">
                      {teamSize} чел.
                    </span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={12}
                    value={teamSize}
                    onChange={(e) => setTeamSize(Number(e.target.value))}
                    className="w-full accent-sky-400 cursor-pointer h-2 bg-white/15 rounded-lg"
                  />
                  <div className="flex justify-between text-[11px] font-mono text-white/45 mt-1">
                    <span>Соло-основатель (1)</span>
                    <span>Продуктовая группа (4)</span>
                    <span>Команда / Студия (12)</span>
                  </div>
                </div>

                {/* 3. Claude Source & Layer Sync */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                  <div>
                    <span className="font-mono text-[11px] uppercase tracking-wider text-white/55 block mb-2">
                      3. Контур подписки Claude:
                    </span>
                    <div className="grid grid-cols-2 gap-1.5 p-1 rounded-2xl bg-black/40 border border-white/15">
                      <button
                        type="button"
                        onClick={() => {
                          setClaudeSource('builtin');
                          onSelectTariff(TARIFF_OPTIONS[1]!);
                        }}
                        className={`py-2.5 px-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                          claudeSource === 'builtin'
                            ? 'bg-emerald-400 text-[#060911] shadow'
                            : 'text-white/70 hover:text-white'
                        }`}
                      >
                        От нас (Прайм/VIP)
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setClaudeSource('own');
                          onSelectTariff(TARIFF_OPTIONS[0]!);
                        }}
                        className={`py-2.5 px-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                          claudeSource === 'own'
                            ? 'bg-white text-[#060911] shadow'
                            : 'text-white/70 hover:text-white'
                        }`}
                      >
                        Свой Claude (0 ₽)
                      </button>
                    </div>
                  </div>

                  <div>
                    <span className="font-mono text-[11px] uppercase tracking-wider text-white/55 block mb-2">
                      4. Фокус 3D-архитектуры:
                    </span>
                    <div className="grid grid-cols-4 gap-1.5">
                      {STACK_LAYERS.map((l) => {
                        const active = l.id === activeLayer.id;
                        return (
                          <button
                            key={l.id}
                            type="button"
                            onClick={() => onSelectLayer(l.id)}
                            className={`py-2.5 rounded-xl font-mono text-xs font-black border transition-all cursor-pointer ${
                              active
                                ? 'bg-white text-[#060911] border-white'
                                : 'bg-white/[0.05] text-white/70 border-white/15 hover:text-white'
                            }`}
                          >
                            0{l.index + 1}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>

              {/* Right 5 cols: Reactor Telemetry Output Card */}
              <div className="lg:col-span-5 rounded-[28px] p-6 sm:p-8 bg-gradient-to-b from-emerald-950/50 via-[#0a1222] to-[#070b14] border-2 border-emerald-400/40 shadow-2xl flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between gap-2 mb-4">
                    <span className="font-mono text-xs font-bold uppercase text-emerald-300 flex items-center gap-1.5">
                      <TrendingUp className="w-4 h-4" />
                      ИТОГОВЫЙ РАСЧЁТ В РУБЛЯХ
                    </span>
                    <span className="px-2.5 py-1 rounded-lg bg-white/10 font-mono text-[11px] font-bold text-white">
                      Тариф: {activeTariff.name}
                    </span>
                  </div>

                  <div className="mb-6">
                    <span className="text-xs text-white/60 block mb-1">
                      Расчётная выгода и экономия бюджета:
                    </span>
                    <motion.div
                      key={netMonthlyBenefit}
                      initial={{ scale: 0.95, opacity: 0.7 }}
                      animate={{ scale: 1, opacity: 1 }}
                      className="font-display font-black text-4xl sm:text-5xl text-white tracking-tight"
                    >
                      +{netMonthlyBenefit.toLocaleString('ru-RU')} ₽
                      <span className="text-base font-sans font-semibold text-emerald-300 ml-2">
                        / мес
                      </span>
                    </motion.div>
                  </div>

                  <div className="space-y-3 text-xs sm:text-sm border-t border-white/15 pt-4">
                    <div className="flex items-center justify-between text-white/80">
                      <span>Экономия времени на рутине и ревью:</span>
                      <span className="font-mono font-bold text-lime-300">
                        ~{savedDevHours} часов / мес
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-white/80">
                      <span>Экономия на VPN и зарубежных картах:</span>
                      <span className="font-mono font-bold text-sky-300">
                        {externalClaudeAndVpnCost.toLocaleString('ru-RU')} ₽ / мес
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-white/80">
                      <span>Стоимость тарифа «{activeTariff.name}»:</span>
                      <span className="font-mono font-bold text-white">
                        {activeTariff.priceFormatted} / {activeTariff.period}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="mt-6 pt-4 border-t border-white/15">
                  <a
                    href={isAuthed ? `${appBase}/projects` : `${appBase}/login`}
                    className="w-full inline-flex items-center justify-center gap-2 px-6 py-4 rounded-2xl bg-emerald-400 hover:bg-emerald-300 text-[#050911] font-extrabold text-sm transition-all shadow-lg"
                  >
                    <Sparkles className="w-4 h-4" />
                    <span>{activeTariff.ctaText}</span>
                    <ArrowUpRight className="w-4 h-4" />
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* PART 3: 3 TARIFF ARCHITECTURE CARDS (#pricing) */}
      <section id="pricing" className="scroll-mt-24">
        <div className="text-center max-w-2xl mx-auto mb-10">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/[0.06] border border-white/15 mb-3">
            <Cpu className="w-3.5 h-3.5 text-purple-400" />
            <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-white/85">
              Прозрачные тарифы в рублях · Без скрытых платежей
            </span>
          </div>
          <h2 className="font-display font-black uppercase text-3xl sm:text-5xl leading-[0.96] tracking-[-0.03em] text-white">
            ВЫБЕРИТЕ КОНТУР{' '}
            <span className="text-purple-400">МОЩНОСТИ</span>
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
                    ? 'bg-gradient-to-b from-[#131d36] to-[#080d18] border-emerald-400/60 shadow-[0_28px_80px_rgba(16,185,129,0.2)]'
                    : isSelected
                      ? 'bg-[#0e1526] border-white/45 shadow-2xl'
                      : 'bg-[#080c16]/85 border-white/15 hover:border-white/30'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-4">
                    <span
                      className={`font-mono text-[10px] font-extrabold uppercase px-3 py-1 rounded-full ${
                        t.highlight
                          ? 'bg-emerald-400 text-[#060911]'
                          : 'bg-white/10 text-white/80'
                      }`}
                    >
                      {t.badge}
                    </span>
                    {isSelected && (
                      <span className="font-mono text-[10px] font-bold text-lime-400">
                        ● Выбран в 3D
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
                    <span className="text-xs font-mono text-white/55">
                      / {t.period}
                    </span>
                  </div>

                  <p className="text-xs sm:text-sm text-white/70 leading-relaxed mb-5">
                    {t.summary}
                  </p>

                  <div className="rounded-2xl p-3.5 bg-white/[0.04] border border-white/10 mb-5 space-y-1.5 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-white/55">Подписка Claude:</span>
                      <span className="font-bold text-white">{t.claudeQuota}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-white/55">Режим работы:</span>
                      <span className="font-bold text-emerald-300">{t.autopilotMode}</span>
                    </div>
                  </div>

                  <ul className="space-y-2.5 mb-7">
                    {t.features.map((f) => (
                      <li key={f} className="flex items-start gap-2.5 text-xs sm:text-sm text-white/85">
                        <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
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
                      ? 'bg-white text-[#060911] hover:bg-slate-100 shadow-lg'
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
