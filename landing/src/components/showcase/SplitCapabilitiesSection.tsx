import React, { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowUpRight,
  CheckCircle2,
  Cpu,
  Layers,
  Play,
  ShieldCheck,
  Terminal,
  TrendingUp,
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
  const [customPrompt, setCustomPrompt] = useState<string>(PROMPT_PRESETS[0]!.promptText);

  const activePreset: PromptPreset =
    PROMPT_PRESETS.find((p) => p.id === activePresetId) ?? PROMPT_PRESETS[0]!;

  const handleSelectPreset = (preset: PromptPreset) => {
    setActivePresetId(preset.id);
    setCustomPrompt(preset.promptText);
    onSelectLayer(preset.layerFocus);
  };

  return (
    <section
      id="prompt-sandbox"
      className="relative z-10 max-w-[1440px] mx-auto px-4 sm:px-8 py-12 scroll-mt-24"
    >
      {/* Split Frosted-Glass Terminal & Live Blueprint Generator */}
      <div className="relative rounded-[36px] overflow-hidden border border-white/20 shadow-[0_32px_100px_rgba(0,0,0,0.65)] bg-[#070b14]">
        {/* Ambient Isometric Circuit Background on Right Half */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'radial-gradient(circle at 75% 30%, rgba(56, 189, 248, 0.16) 0%, rgba(16, 185, 129, 0.10) 42%, rgba(6, 9, 17, 0.98) 88%)',
          }}
        />

        {/* LEFT 46% FROSTED GLASS SHUTTER (Mechanic C adapted for AI Prompt Terminal) */}
        <div className="hidden lg:block absolute inset-y-0 left-0 w-[46%] bg-[#0b1220]/75 backdrop-blur-2xl border-r border-white/20 z-10 pointer-events-none">
          {/* Glowing seam connector nodes */}
          <div className="absolute top-28 -right-3 w-6 h-6 rounded-lg rotate-45 bg-sky-400/30 border border-sky-300/60 shadow-[0_0_20px_rgba(56,189,248,0.6)]" />
          <div className="absolute bottom-32 -right-3 w-6 h-6 rounded-lg rotate-45 bg-lime-400/30 border border-lime-300/60 shadow-[0_0_20px_rgba(163,230,53,0.6)]" />
        </div>

        {/* Content Container Spanning Across the 46% Split Seam */}
        <div className="relative z-20 p-6 sm:p-10 lg:p-12">
          {/* Cross-Boundary Giant Headline */}
          <div className="mb-8">
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/[0.07] border border-white/15 mb-4">
              <Terminal className="w-3.5 h-3.5 text-lime-400" />
              <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-white/85">
                Интерактивная песочница · От текста до живого релиза
              </span>
            </div>

            <h2 className="font-display font-black uppercase text-3xl sm:text-5xl xl:text-[64px] leading-[0.94] tracking-[-0.03em]">
              <span className="knockout-frosted-text block sm:inline">
                ФОРМУЛИРУЙ ЦЕЛЬ —{' '}
              </span>
              <span className="text-white drop-shadow-[0_18px_40px_rgba(0,0,0,0.6)]">
                ПОЛУЧАЙ ПРОДУКТ И P&L
              </span>
            </h2>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
            {/* LEFT HALF (5 cols inside the 46% Frosted Shutter): Scenario Presets + Prompt Input + Mode Toggle */}
            <div className="lg:col-span-5 flex flex-col gap-5">
              {/* 1. Scenario Selector */}
              <div>
                <span className="font-mono text-[11px] uppercase tracking-wider text-white/55 block mb-2.5">
                  1. Выберите готовый сценарий или опишите свой:
                </span>
                <div className="space-y-2">
                  {PROMPT_PRESETS.map((preset) => {
                    const active = preset.id === activePreset.id;
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => handleSelectPreset(preset)}
                        className={`w-full text-left px-4 py-3 rounded-2xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                          active
                            ? 'bg-white text-[#070b14] border-white shadow-lg font-bold'
                            : 'bg-white/[0.05] text-white/80 border-white/15 hover:bg-white/[0.1]'
                        }`}
                      >
                        <div className="min-w-0">
                          <span
                            className={`font-mono text-[10px] uppercase tracking-wider block ${
                              active ? 'text-emerald-700 font-extrabold' : 'text-sky-300/80'
                            }`}
                          >
                            {preset.category}
                          </span>
                          <span className="text-sm font-bold truncate block">
                            {preset.title}
                          </span>
                        </div>
                        <ArrowUpRight
                          className={`w-4 h-4 shrink-0 ${
                            active ? 'text-[#070b14]' : 'text-white/40'
                          }`}
                        />
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 2. Editable Prompt Box */}
              <div className="rounded-2xl p-4 bg-[#050811]/90 border border-white/20">
                <div className="flex items-center justify-between text-[11px] font-mono text-white/55 mb-2">
                  <span>ВХОДНОЙ ЗАПРОС (НА РУССКОМ ЯЗЫКЕ)</span>
                  <span className="text-lime-400 font-bold">Claude Онлайн · Встроен</span>
                </div>
                <textarea
                  rows={3}
                  value={customPrompt}
                  onChange={(e) => setCustomPrompt(e.target.value)}
                  className="w-full bg-transparent text-white text-sm leading-relaxed focus:outline-none resize-none"
                />
              </div>

              {/* 3. Execution Speed Mode Toggle */}
              <div>
                <span className="font-mono text-[11px] uppercase tracking-wider text-white/55 block mb-2">
                  2. Режим ведения проекта:
                </span>
                <div className="grid grid-cols-2 gap-2 p-1 rounded-2xl bg-black/40 border border-white/15">
                  <button
                    type="button"
                    onClick={() => setExecutionMode('autopilot')}
                    className={`py-2.5 px-3 rounded-xl text-xs font-extrabold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                      executionMode === 'autopilot'
                        ? 'bg-lime-400 text-[#070b14] shadow-md'
                        : 'text-white/75 hover:text-white'
                    }`}
                  >
                    <Zap className="w-3.5 h-3.5" />
                    <span>Автопилот под ключ</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setExecutionMode('step')}
                    className={`py-2.5 px-3 rounded-xl text-xs font-extrabold transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                      executionMode === 'step'
                        ? 'bg-sky-400 text-[#070b14] shadow-md'
                        : 'text-white/75 hover:text-white'
                    }`}
                  >
                    <Layers className="w-3.5 h-3.5" />
                    <span>Шаг за шагом</span>
                  </button>
                </div>
              </div>

              {/* CTA */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <div>
                  <span className="font-mono text-xs font-bold text-lime-400 block">
                    {activePreset.estimatedTime}
                  </span>
                  <span className="text-xs text-white/60">
                    {activePreset.estimatedSavedRub}
                  </span>
                </div>

                <a
                  href={isAuthed ? `${appBase}/projects` : `${appBase}/login`}
                  className="inline-flex items-center gap-2 px-5 py-3.5 rounded-2xl bg-white text-[#070b14] font-extrabold text-xs uppercase tracking-wider hover:bg-slate-100 transition-all shadow-lg"
                >
                  <Play className="w-3.5 h-3.5 fill-[#070b14]" />
                  <span>Запустить этот проект</span>
                </a>
              </div>
            </div>

            {/* RIGHT HALF (7 cols on Clear Stage): Live Generated Architecture, Kanban Tasks, 4 Checks & RUB P&L */}
            <div className="lg:col-span-7">
              <AnimatePresence mode="wait">
                <motion.div
                  key={`${activePreset.id}-${executionMode}`}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 24 }}
                  className="space-y-4"
                >
                  {/* Top Bar: Pipeline Header */}
                  <div className="rounded-2xl p-4 bg-white/[0.06] border border-white/20 backdrop-blur-xl flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-sky-400/20 border border-sky-400/40 flex items-center justify-center text-sky-300">
                        <Cpu className="w-5 h-5" />
                      </div>
                      <div>
                        <span className="font-mono text-[10px] uppercase tracking-wider text-sky-300 block">
                          ЖИВОЙ ПЛАН РЕАЛИЗАЦИИ · {executionMode === 'autopilot' ? 'ПОЛНЫЙ АВТОПИЛОТ' : 'КОНТРОЛЬ КАЖДОГО ШАГА'}
                        </span>
                        <h3 className="font-bold text-base text-white">
                          {activePreset.title}
                        </h3>
                      </div>
                    </div>

                    <span className="px-3 py-1.5 rounded-xl bg-emerald-500/20 border border-emerald-400/40 font-mono text-xs font-bold text-emerald-300">
                      Claude 3.7 Встроен · 0 ключей
                    </span>
                  </div>

                  {/* Generated Kanban Backlog Cards */}
                  <div className="rounded-2xl p-5 bg-[#0a101d]/90 border border-white/15 space-y-2.5">
                    <div className="flex items-center justify-between text-xs font-mono text-white/60 mb-1">
                      <span>АВТОМАТИЧЕСКАЯ ДЕКОМПОЗИЦИЯ НА ДОСКЕ</span>
                      <span>4 ЭТАПА СПРИНТА</span>
                    </div>

                    {activePreset.generatedTasks.map((task) => (
                      <div
                        key={task.code}
                        className="flex items-center justify-between gap-3 p-3 rounded-xl bg-white/[0.04] border border-white/10"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="font-mono text-xs font-bold px-2.5 py-1 rounded-lg bg-white/10 text-white shrink-0">
                            {task.code}
                          </span>
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-white truncate">
                              {task.title}
                            </p>
                            <span className="text-[11px] font-mono text-white/55">
                              Исполнитель: {task.role} · Время: {task.duration}
                            </span>
                          </div>
                        </div>

                        <span
                          className={`shrink-0 px-2.5 py-1 rounded-lg font-mono text-[11px] font-bold uppercase ${
                            task.status === 'done'
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/30'
                              : task.status === 'running'
                                ? 'bg-lime-400/20 text-lime-300 border border-lime-400/40 animate-pulse'
                                : 'bg-white/10 text-white/65'
                          }`}
                        >
                          {task.status === 'done'
                            ? '✓ Готово'
                            : task.status === 'running'
                              ? '⚡ В работе'
                              : executionMode === 'step'
                                ? 'Ждёт одобрения'
                                : 'В очереди'}
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* Bottom 2-Column Row: 4-Stage QA Shield + RUB P&L Forecast */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* 4-Stage QA Shield */}
                    <div className="rounded-2xl p-4 bg-[#0a101d]/90 border border-white/15">
                      <div className="flex items-center gap-2 text-xs font-mono uppercase text-sky-300 font-bold mb-3">
                        <ShieldCheck className="w-4 h-4" />
                        <span>4 контура автопроверки</span>
                      </div>
                      <div className="space-y-2">
                        {activePreset.checks.map((c) => (
                          <div
                            key={c.name}
                            className="flex items-center justify-between text-xs py-1 border-b border-white/10 last:border-0"
                          >
                            <span className="text-white/75 flex items-center gap-1.5">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                              {c.name}
                            </span>
                            <span className="font-mono font-bold text-emerald-300">
                              {c.status}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* RUB P&L Unit Economics Preview */}
                    <div className="rounded-2xl p-4 bg-gradient-to-br from-emerald-950/60 to-[#0a101d] border border-emerald-400/30 flex flex-col justify-between">
                      <div>
                        <div className="flex items-center justify-between text-xs font-mono uppercase text-emerald-300 font-bold mb-3">
                          <span className="flex items-center gap-1.5">
                            <TrendingUp className="w-4 h-4" />
                            Прогноз P&L в рублях
                          </span>
                          <span>СЛОЙ 03</span>
                        </div>
                        <div className="space-y-1.5 text-xs">
                          <div className="flex justify-between text-white/75">
                            <span>Целевой оборот:</span>
                            <span className="font-mono font-bold text-white">
                              {activePreset.pnlPreview.expectedRevenue}
                            </span>
                          </div>
                          <div className="flex justify-between text-white/75">
                            <span>Затраты на ProjectsFlow + ИИ:</span>
                            <span className="font-mono font-bold text-emerald-300">
                              {activePreset.pnlPreview.infraCost}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="mt-4 pt-3 border-t border-white/15 flex items-baseline justify-between">
                        <span className="text-xs font-bold text-white/80">
                          Чистый результат:
                        </span>
                        <span className="font-display font-black text-lg text-lime-300">
                          {activePreset.pnlPreview.netMargin}
                        </span>
                      </div>
                    </div>
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
