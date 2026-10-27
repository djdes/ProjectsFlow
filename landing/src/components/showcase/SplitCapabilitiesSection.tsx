import React, { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  Cpu,
  Layers,
  Play,
  ShieldCheck,
  Sparkles,
  Zap,
} from 'lucide-react';
import {
  PROMPT_PRESETS,
  type PromptPreset,
  type StackLayerId,
} from '../../data/showcaseData';

interface SplitCapabilitiesSectionProps {
  onSelectLayer: (layerId: StackLayerId) => void;
  isAuthed: boolean;
  appBase: string;
}

export const SplitCapabilitiesSection: React.FC<SplitCapabilitiesSectionProps> = ({
  onSelectLayer,
  isAuthed,
  appBase,
}) => {
  const [activePresetId, setActivePresetId] = useState<string>(PROMPT_PRESETS[0]!.id);
  const [executionMode, setExecutionMode] = useState<'autopilot' | 'step'>('autopilot');

  const activePreset: PromptPreset =
    PROMPT_PRESETS.find((p) => p.id === activePresetId) ?? PROMPT_PRESETS[0]!;

  const handleSelectPreset = (preset: PromptPreset) => {
    setActivePresetId(preset.id);
    onSelectLayer(preset.layerFocus);
  };

  return (
    <section
      id="prompt-sandbox"
      className="relative z-10 max-w-[1440px] mx-auto px-4 sm:px-8 py-14 scroll-mt-24"
    >
      {/* Clean Split Frosted-Glass Stage with Instant Visual Focus */}
      <div className="relative rounded-[40px] overflow-hidden border border-white/20 shadow-[0_32px_100px_rgba(0,0,0,0.6)] bg-[#12071b]">
        {/* Ambient Crimson/Violet Glow */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'radial-gradient(circle at 78% 32%, rgba(255, 46, 99, 0.28) 0%, rgba(157, 78, 221, 0.22) 45%, rgba(14, 6, 24, 0.98) 90%)',
          }}
        />

        {/* LEFT 45% FROSTED GLASS CURTAIN */}
        <div className="hidden lg:block absolute inset-y-0 left-0 w-[45%] bg-white/[0.04] backdrop-blur-2xl border-r border-white/15 z-10 pointer-events-none" />

        <div className="relative z-20 p-7 sm:p-12 lg:p-14">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-center">
            {/* LEFT COLUMN (5 cols): Clear, Minimal Controls (1 Headline + 3 Big Tabs + 1 CTA) */}
            <div className="lg:col-span-5 flex flex-col items-start">
              <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-rose-500/15 border border-rose-400/30 mb-5">
                <Sparkles className="w-3.5 h-3.5 text-rose-400" />
                <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-rose-200">
                  От идеи до готового продукта
                </span>
              </div>

              <h2 className="font-display font-black uppercase text-3xl sm:text-5xl leading-[0.96] tracking-[-0.03em] text-white mb-4">
                ОДНА ФРАЗА —{' '}
                <span className="knockout-frosted-text block mt-1">
                  ГОТОВЫЙ БИЗНЕС
                </span>
              </h2>

              <p className="text-white/75 text-sm sm:text-base leading-relaxed mb-7">
                Выберите пример проекта ниже и посмотрите, как ProjectsFlow сам собирает
                код, проверяет качество и считает чистую прибыль в рублях.
              </p>

              {/* 3 Large Tactile Scenario Pills (Clean, 1-line each) */}
              <div className="w-full space-y-2.5 mb-7">
                {PROMPT_PRESETS.map((preset) => {
                  const active = preset.id === activePreset.id;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => handleSelectPreset(preset)}
                      className={`w-full flex items-center justify-between px-5 py-4 rounded-2xl border text-left transition-all cursor-pointer ${
                        active
                          ? 'bg-white text-[#14071e] border-white shadow-[0_16px_40px_rgba(255,46,99,0.28)] scale-[1.01]'
                          : 'bg-white/[0.06] text-white border-white/15 hover:bg-white/[0.12]'
                      }`}
                    >
                      <span className="font-bold text-base">{preset.shortTab}</span>
                      <span
                        className={`font-mono text-xs font-extrabold px-3 py-1 rounded-full ${
                          active
                            ? 'bg-rose-500 text-white'
                            : 'bg-white/10 text-white/75'
                        }`}
                      >
                        {preset.estimatedTime}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Simple 2-way Mode Switcher + CTA */}
              <div className="w-full flex flex-wrap items-center gap-3">
                <div className="inline-flex p-1 rounded-2xl bg-black/40 border border-white/15">
                  <button
                    type="button"
                    onClick={() => setExecutionMode('autopilot')}
                    className={`px-4 py-2.5 rounded-xl text-xs font-extrabold transition-all cursor-pointer flex items-center gap-1.5 ${
                      executionMode === 'autopilot'
                        ? 'bg-rose-500 text-white shadow'
                        : 'text-white/70 hover:text-white'
                    }`}
                  >
                    <Zap className="w-3.5 h-3.5" />
                    <span>Автопилот</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setExecutionMode('step')}
                    className={`px-4 py-2.5 rounded-xl text-xs font-extrabold transition-all cursor-pointer flex items-center gap-1.5 ${
                      executionMode === 'step'
                        ? 'bg-purple-500 text-white shadow'
                        : 'text-white/70 hover:text-white'
                    }`}
                  >
                    <Layers className="w-3.5 h-3.5" />
                    <span>Шаг за шагом</span>
                  </button>
                </div>

                <a
                  href={isAuthed ? `${appBase}/projects` : `${appBase}/login`}
                  className="inline-flex items-center gap-2 px-6 py-3.5 rounded-2xl bg-white text-[#14071e] font-extrabold text-xs uppercase tracking-wider hover:bg-rose-50 transition-all shadow-lg ml-auto"
                >
                  <Play className="w-3.5 h-3.5 fill-[#14071e]" />
                  <span>Запустить</span>
                </a>
              </div>
            </div>

            {/* RIGHT COLUMN (7 cols): ONE Focal Visual Showcase Card with Giant Numbers & 3-Step Visual Flow */}
            <div className="lg:col-span-7">
              <AnimatePresence mode="wait">
                <motion.div
                  key={`${activePreset.id}-${executionMode}`}
                  initial={{ opacity: 0, y: 18, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -14, scale: 0.98 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 25 }}
                  className="rounded-[32px] p-7 sm:p-9 bg-[#190b28]/90 border border-white/20 backdrop-blur-2xl shadow-2xl space-y-7"
                >
                  {/* 1. Prompt Quote Bubble */}
                  <div className="rounded-2xl p-5 bg-white/[0.06] border border-white/15">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-rose-300 flex items-center gap-1.5">
                        <Cpu className="w-3.5 h-3.5" />
                        Что вы пишете в ProjectsFlow:
                      </span>
                      <span className="font-mono text-[11px] font-bold text-amber-300">
                        Claude Онлайн · Без VPN
                      </span>
                    </div>
                    <p className="text-base sm:text-lg font-bold text-white leading-snug">
                      «{activePreset.promptText}»
                    </p>
                  </div>

                  {/* 2. Giant 3-Column Visual Impact Numbers (Instant Eye Focus) */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="rounded-2xl p-5 bg-gradient-to-br from-rose-500/25 to-purple-900/30 border border-rose-400/40">
                      <span className="font-mono text-[11px] uppercase text-rose-200 block mb-1">
                        Чистая маржа
                      </span>
                      <span className="font-display font-black text-xl xl:text-2xl text-white block whitespace-nowrap">
                        {activePreset.heroMetricValue}
                      </span>
                      <span className="text-xs text-white/70 mt-1 block">
                        {activePreset.heroMetricLabel}
                      </span>
                    </div>

                    <div className="rounded-2xl p-5 bg-white/[0.05] border border-white/15">
                      <span className="font-mono text-[11px] uppercase text-purple-300 block mb-1">
                        Время сборки
                      </span>
                      <span className="font-display font-black text-xl xl:text-2xl text-white block whitespace-nowrap">
                        {activePreset.estimatedTime}
                      </span>
                      <span className="text-xs text-white/70 mt-1 block">
                        Режим: {executionMode === 'autopilot' ? 'Автопилот' : 'Шаг за шагом'}
                      </span>
                    </div>

                    <div className="rounded-2xl p-5 bg-white/[0.05] border border-white/15">
                      <span className="font-mono text-[11px] uppercase text-amber-300 block mb-1">
                        Контроль релиза
                      </span>
                      <span className="font-display font-black text-xl xl:text-2xl text-white block whitespace-nowrap">
                        4 / 4 PASS
                      </span>
                      <span className="text-xs text-white/70 mt-1 block">
                        Живой стенд готов
                      </span>
                    </div>
                  </div>

                  {/* 3. Visual 3-Step Pipeline Strip (Instead of a cluttered table) */}
                  <div>
                    <div className="flex items-center justify-between text-xs font-mono text-white/55 mb-3">
                      <span>АВТОМАТИЧЕСКИЕ ЭТАПЫ НА ДОСКЕ</span>
                      <span className="text-amber-300 font-bold">{activePreset.estimatedSavedRub}</span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      {activePreset.generatedTasks.map((task, idx) => (
                        <div
                          key={task.code}
                          className="rounded-2xl p-4 bg-white/[0.05] border border-white/12 flex flex-col justify-between"
                        >
                          <div className="flex items-center justify-between mb-2">
                            <span className="font-display font-black text-sm text-rose-400">
                              ШАГ {task.code}
                            </span>
                            {idx < 2 ? (
                              <CheckCircle2 className="w-4 h-4 text-amber-300" />
                            ) : (
                              <ShieldCheck className="w-4 h-4 text-sky-300" />
                            )}
                          </div>
                          <p className="font-bold text-sm text-white leading-snug mb-2">
                            {task.title}
                          </p>
                          <div className="flex items-center justify-between text-[11px] font-mono text-white/55 pt-2 border-t border-white/10">
                            <span>{task.role}</span>
                            <span className="text-white font-bold">{task.duration}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Bottom Bar */}
                  <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-white/15 text-xs">
                    <span className="text-white/70">
                      Тариф в расчёте: <strong className="text-white">{activePreset.pnlPreview.infraCost}</strong> · Весь код 100% ваш
                    </span>
                    <a
                      href="#live-board"
                      className="inline-flex items-center gap-1.5 font-bold text-rose-300 hover:text-white transition-colors"
                    >
                      <span>Открыть живую доску</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </a>
                  </div>
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
