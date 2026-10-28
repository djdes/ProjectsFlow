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
  activeTariff,
  isAuthed,
  appBase,
  onSelectTariff,
}) => {
  const [projectsPerMonth, setProjectsPerMonth] = useState<number>(3);
  const [teamSize, setTeamSize] = useState<number>(2);
  const [claudeSource, setClaudeSource] = useState<'builtin' | 'own'>('builtin');

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
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-rose-500/15 border border-rose-400/30 mb-3">
              <Zap className="w-3.5 h-3.5 text-rose-400" />
              <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-rose-200">
                Живое демо · Попробуйте переключить задачи
              </span>
            </div>
            <h2 className="font-display font-black uppercase text-3xl sm:text-5xl leading-[0.96] tracking-[-0.03em] text-white">
              ЖИВАЯ ДОСКА{' '}
              <span className="text-rose-400">АВТОПИЛОТА</span>
            </h2>
          </div>

          <p className="text-white/75 text-sm sm:text-base max-w-md">
            Нажимайте на карточки и фильтруйте по ролям — так выглядит реальный проект в ProjectsFlow.
          </p>
        </div>

        <div className="rounded-[32px] p-3 sm:p-5 bg-[#12071b]/90 border border-white/20 shadow-[0_32px_90px_rgba(0,0,0,0.65)] backdrop-blur-2xl">
          <KanbanBoard />
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
