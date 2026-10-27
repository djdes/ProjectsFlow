import React, { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Check,
  Copy,
  Cpu,
  Globe,
  Layers,
  ShieldCheck,
  Terminal,
  TrendingUp,
} from 'lucide-react';
import {
  DESKTOP_WORKFLOW_STEPS,
  type StackLayerId,
} from '../../data/showcaseData';

interface ProductWalkthroughSectionProps {
  onSelectLayer?: (layerId: StackLayerId) => void;
}

export const ProductWalkthroughSection: React.FC<ProductWalkthroughSectionProps> = ({
  onSelectLayer,
}) => {
  const [activeIdx, setActiveIdx] = useState<number>(0);
  const [copied, setCopied] = useState<boolean>(false);

  const activeStep = DESKTOP_WORKFLOW_STEPS[activeIdx] ?? DESKTOP_WORKFLOW_STEPS[0]!;

  const handleSelectStep = (idx: number) => {
    setActiveIdx(idx);
    const step = DESKTOP_WORKFLOW_STEPS[idx];
    if (step && onSelectLayer) {
      onSelectLayer(step.layerId);
    }
  };

  const handleCopyCommand = () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(activeStep.terminalCommand).catch(() => {});
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <section
      id="walkthrough"
      className="relative z-10 max-w-[1440px] mx-auto px-4 sm:px-8 py-14 scroll-mt-24"
    >
      {/* Section Header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 mb-10">
        <div>
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/[0.06] border border-white/15 mb-3">
            <Layers className="w-3.5 h-3.5 text-sky-400" />
            <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-white/85">
              Маршрут проекта · 3 изометрических узла
            </span>
          </div>
          <h2 className="font-display font-black uppercase text-3xl sm:text-5xl leading-[0.96] tracking-[-0.03em] text-white">
            КАК РАБОТАЕТ СТУДИЯ{' '}
            <span className="text-sky-400">PROJECTSFLOW</span>
          </h2>
        </div>

        <p className="text-white/70 text-sm sm:text-base max-w-md">
          Переключайте узлы <span className="text-white font-bold">01 → 02 → 03</span>, чтобы
          развернуть соответствующее окно рабочей станции в 3D-перспективе.
        </p>
      </div>

      {/* Isometric 01 -> 02 -> 03 Node Selector Rail (inspired by Pinterest pin-03.jpg) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-10">
        {DESKTOP_WORKFLOW_STEPS.map((step, idx) => {
          const isSelected = idx === activeIdx;
          return (
            <button
              key={step.id}
              type="button"
              onClick={() => handleSelectStep(idx)}
              className={`group relative text-left p-5 rounded-[26px] border transition-all cursor-pointer overflow-hidden ${
                isSelected
                  ? 'bg-[#0e1628] border-white/45 shadow-[0_24px_60px_rgba(0,0,0,0.55)] -translate-y-1'
                  : 'bg-[#080d18]/75 border-white/12 hover:bg-[#0c1322] hover:border-white/25'
              }`}
            >
              {/* Top glowing accent bar */}
              <div
                className="h-1 w-full rounded-full mb-4 transition-all"
                style={{
                  backgroundColor: isSelected ? step.accentColor : 'rgba(255,255,255,0.1)',
                  boxShadow: isSelected ? `0 0 16px ${step.accentColor}` : 'none',
                }}
              />

              <div className="flex items-center justify-between gap-3 mb-2">
                <span
                  className="font-display font-black text-2xl sm:text-3xl tracking-tight"
                  style={{ color: isSelected ? step.accentColor : 'rgba(255,255,255,0.4)' }}
                >
                  {step.stepNum}
                </span>
                <span className="font-mono text-[10px] font-bold uppercase px-2.5 py-1 rounded-lg bg-white/[0.06] text-white/75 border border-white/10">
                  {step.subtitle}
                </span>
              </div>

              <h3 className="font-bold text-base sm:text-lg text-white mb-1.5">
                {step.title}
              </h3>
              <p className="text-xs text-white/65 leading-relaxed line-clamp-2">
                {step.description}
              </p>
            </button>
          );
        })}
      </div>

      {/* Main 3D Desktop Studio Matrix Stage (4 cols Telemetry + 8 cols 3D Wide Workstation Stack) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
        {/* Left 4 cols: Active Step Details & Command Bar */}
        <div className="lg:col-span-4 space-y-5">
          <div className="rounded-[28px] p-6 bg-[#090e1a]/90 border border-white/20 backdrop-blur-2xl shadow-2xl">
            <div className="flex items-center gap-2.5 mb-3">
              <span
                className="w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: activeStep.accentColor }}
              />
              <span className="font-mono text-xs font-bold uppercase text-white/75">
                УЗЕЛ {activeStep.stepNum} · {activeStep.subtitle}
              </span>
            </div>

            <h3 className="font-display font-black text-xl sm:text-2xl text-white mb-3">
              {activeStep.title}
            </h3>

            <p className="text-sm text-white/75 leading-relaxed mb-5">
              {activeStep.description}
            </p>

            {/* KPIs */}
            <div className="grid grid-cols-3 gap-2 mb-5">
              {activeStep.kpis.map((kpi) => (
                <div
                  key={kpi.label}
                  className="rounded-xl p-2.5 bg-white/[0.04] border border-white/10"
                >
                  <span
                    className="font-mono text-xs font-extrabold block truncate"
                    style={{ color: kpi.tone }}
                  >
                    {kpi.value}
                  </span>
                  <span className="text-[10px] text-white/55 block truncate mt-0.5">
                    {kpi.label}
                  </span>
                </div>
              ))}
            </div>

            {/* Interactive Terminal Command Copier */}
            <div className="rounded-2xl p-3.5 bg-black/60 border border-white/15">
              <div className="flex items-center justify-between text-[10px] font-mono text-white/50 mb-1.5">
                <span className="flex items-center gap-1.5">
                  <Terminal className="w-3 h-3 text-lime-400" />
                  КОНТУР АВТОМАТИЗАЦИИ
                </span>
                <button
                  type="button"
                  onClick={handleCopyCommand}
                  className="inline-flex items-center gap-1 text-sky-300 hover:text-white cursor-pointer"
                >
                  {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                  <span>{copied ? 'Скопировано' : 'Копировать'}</span>
                </button>
              </div>
              <code className="font-mono text-xs text-lime-300 block break-all">
                $ {activeStep.terminalCommand}
              </code>
            </div>
          </div>
        </div>

        {/* Right 8 cols: 3D Perspective Wide Desktop Studio Stack */}
        <div
          className="lg:col-span-8 relative h-[440px] sm:h-[470px] flex items-center justify-center select-none"
          style={{ perspective: '1600px' }}
        >
          {DESKTOP_WORKFLOW_STEPS.map((step, idx) => {
            const offset = idx - activeIdx;
            const isFront = offset === 0;

            return (
              <motion.div
                key={step.id}
                onClick={() => handleSelectStep(idx)}
                animate={{
                  x: offset * 56,
                  y: offset * -26,
                  z: isFront ? 40 : -Math.abs(offset) * 110,
                  rotateY: offset * -12,
                  rotateX: isFront ? 2 : 6,
                  scale: isFront ? 1 : 0.9,
                  opacity: isFront ? 1 : 0.55,
                }}
                transition={{ type: 'spring', stiffness: 280, damping: 24 }}
                style={{ zIndex: 30 - Math.abs(offset) * 10 }}
                className="absolute w-full max-w-[720px] cursor-pointer"
              >
                {/* Wide Titanium Desktop Studio Window Bezel */}
                <div
                  className="rounded-[28px] p-2.5 sm:p-3 bg-gradient-to-b from-[#273249] to-[#0a0f1c] border-2 shadow-[0_32px_90px_rgba(0,0,0,0.75)]"
                  style={{
                    borderColor: isFront ? step.accentColor : 'rgba(255,255,255,0.2)',
                  }}
                >
                  <div className="rounded-[20px] bg-[#070b14] border border-white/10 overflow-hidden h-[380px] sm:h-[400px] flex flex-col justify-between">
                    {/* macOS / Studio Top Window Bar */}
                    <div className="px-4 py-3 bg-[#0d1424] border-b border-white/10 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span className="w-3 h-3 rounded-full bg-rose-500/80" />
                        <span className="w-3 h-3 rounded-full bg-amber-400/80" />
                        <span className="w-3 h-3 rounded-full bg-emerald-400/80" />
                        <span className="ml-2 font-mono text-xs font-bold text-white/85 truncate">
                          {step.windowTitle}
                        </span>
                      </div>

                      <div className="hidden sm:flex items-center gap-1.5 px-3 py-1 rounded-lg bg-black/50 border border-white/10 font-mono text-[11px] text-white/60">
                        <Globe className="w-3 h-3 text-sky-400" />
                        <span>{step.windowUrl}</span>
                      </div>
                    </div>

                    {/* Studio Window Body */}
                    <div className="p-5 sm:p-6 space-y-4 flex-1 flex flex-col justify-center">
                      {step.uiBlocks.map((block) => (
                        <div
                          key={block.title}
                          className="rounded-2xl p-4 bg-white/[0.04] border border-white/12"
                        >
                          <div className="flex items-center justify-between gap-2 mb-2">
                            <span className="font-bold text-sm text-white flex items-center gap-2">
                              <Cpu
                                className="w-4 h-4"
                                style={{ color: step.accentColor }}
                              />
                              {block.title}
                            </span>
                            <span
                              className="font-mono text-[10px] font-bold px-2.5 py-0.5 rounded-md uppercase"
                              style={{
                                backgroundColor: `${step.accentColor}25`,
                                color: step.accentColor,
                              }}
                            >
                              {block.badge}
                            </span>
                          </div>
                          <div className="space-y-1.5">
                            {block.lines.map((line, lIdx) => (
                              <p
                                key={lIdx}
                                className="text-xs sm:text-[13px] text-white/80 font-mono leading-relaxed"
                              >
                                {line}
                              </p>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Studio Window Footer Telemetry */}
                    <div className="px-5 py-3 bg-[#0b1120] border-t border-white/10 flex items-center justify-between text-xs font-mono">
                      <span className="text-white/60 flex items-center gap-1.5">
                        <ShieldCheck className="w-4 h-4 text-emerald-400" />
                        Контур проверок: 4 / 4 активны
                      </span>
                      <span
                        className="font-bold flex items-center gap-1.5"
                        style={{ color: step.accentColor }}
                      >
                        <TrendingUp className="w-4 h-4" />
                        Узел {step.stepNum} синхронизирован с 3D-стеком
                      </span>
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
};
