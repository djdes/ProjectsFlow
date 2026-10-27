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
      {/* Clean Header */}
      <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4 mb-10">
        <div>
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/10 border border-white/20 mb-3">
            <Layers className="w-3.5 h-3.5 text-rose-400" />
            <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-white/90">
              3 простых шага · Нажмите на карточку слева
            </span>
          </div>
          <h2 className="font-display font-black uppercase text-3xl sm:text-5xl leading-[0.96] tracking-[-0.03em] text-white">
            КАК РАБОТАЕТ{' '}
            <span className="text-rose-400">PROJECTSFLOW</span>
          </h2>
        </div>
      </div>

      {/* Single Unified Layout: Left 4 cols (3 Clickable Step Cards) + Right 8 cols (3D Perspective Desktop Window) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
        {/* Left 4 cols: 3 Clean Numbered Step Cards (NO duplicate text boxes) */}
        <div className="lg:col-span-4 space-y-3.5">
          {DESKTOP_WORKFLOW_STEPS.map((step, idx) => {
            const isSelected = idx === activeIdx;
            return (
              <button
                key={step.id}
                type="button"
                onClick={() => handleSelectStep(idx)}
                className={`w-full text-left p-5 rounded-[26px] border transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-white text-[#12061c] border-white shadow-[0_24px_60px_rgba(0,0,0,0.5)] translate-x-1.5'
                    : 'bg-black/40 text-white border-white/15 hover:bg-white/10'
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span
                    className={`font-display font-black text-2xl ${
                      isSelected ? 'text-rose-600' : 'text-white/45'
                    }`}
                  >
                    {step.stepNum}
                  </span>
                  <span
                    className={`font-mono text-[10px] font-extrabold uppercase px-2.5 py-1 rounded-full ${
                      isSelected
                        ? 'bg-[#12061c] text-white'
                        : 'bg-white/10 text-white/75'
                    }`}
                  >
                    {step.subtitle}
                  </span>
                </div>

                <h3 className="font-extrabold text-base sm:text-lg mb-1">
                  {step.title}
                </h3>
                <p
                  className={`text-xs sm:text-sm leading-relaxed ${
                    isSelected ? 'text-[#12061c]/75' : 'text-white/65'
                  }`}
                >
                  {step.description}
                </p>
              </button>
            );
          })}

          {/* Compact 1-Line Command Copier */}
          <div className="rounded-2xl px-4 py-3 bg-black/55 border border-white/15 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <Terminal className="w-4 h-4 text-rose-400 shrink-0" />
              <code className="font-mono text-xs text-white/90 truncate">
                {activeStep.terminalCommand}
              </code>
            </div>
            <button
              type="button"
              onClick={handleCopyCommand}
              className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-[11px] font-mono font-bold text-white cursor-pointer"
            >
              {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              <span>{copied ? 'Ок' : 'Копия'}</span>
            </button>
          </div>
        </div>

        {/* Right 8 cols: 3D Perspective Wide Desktop Studio Stack */}
        <div
          className="lg:col-span-8 relative h-[430px] sm:h-[460px] flex items-center justify-center select-none"
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
                  x: offset * 52,
                  y: offset * -24,
                  z: isFront ? 40 : -Math.abs(offset) * 110,
                  rotateY: offset * -12,
                  rotateX: isFront ? 2 : 5,
                  scale: isFront ? 1 : 0.9,
                  opacity: isFront ? 1 : 0.5,
                }}
                transition={{ type: 'spring', stiffness: 280, damping: 24 }}
                style={{ zIndex: 30 - Math.abs(offset) * 10 }}
                className="absolute w-full max-w-[720px] cursor-pointer"
              >
                <div
                  className="rounded-[30px] p-2.5 sm:p-3 bg-gradient-to-b from-[#3b214d] to-[#12081c] border-2 shadow-[0_32px_90px_rgba(0,0,0,0.75)]"
                  style={{
                    borderColor: isFront ? step.accentColor : 'rgba(255,255,255,0.2)',
                  }}
                >
                  <div className="rounded-[22px] bg-[#11071a] border border-white/12 overflow-hidden h-[370px] sm:h-[395px] flex flex-col justify-between">
                    {/* Top Window Bar */}
                    <div className="px-4 py-3 bg-[#1a0c28] border-b border-white/10 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span className="w-3 h-3 rounded-full bg-rose-500" />
                        <span className="w-3 h-3 rounded-full bg-amber-400" />
                        <span className="w-3 h-3 rounded-full bg-sky-400" />
                        <span className="ml-2 font-mono text-xs font-bold text-white/90 truncate">
                          {step.windowTitle}
                        </span>
                      </div>

                      <div className="hidden sm:flex items-center gap-1.5 px-3 py-1 rounded-lg bg-black/45 border border-white/10 font-mono text-[11px] text-white/70">
                        <Globe className="w-3 h-3 text-rose-400" />
                        <span>{step.windowUrl}</span>
                      </div>
                    </div>

                    {/* Big Visual KPI Row Inside Window */}
                    <div className="px-6 pt-5 grid grid-cols-3 gap-3">
                      {step.kpis.map((kpi) => (
                        <div
                          key={kpi.label}
                          className="rounded-2xl p-3.5 bg-white/[0.05] border border-white/12"
                        >
                          <span
                            className="font-display font-black text-base sm:text-xl block truncate"
                            style={{ color: kpi.tone }}
                          >
                            {kpi.value}
                          </span>
                          <span className="text-[11px] text-white/60 block truncate mt-0.5">
                            {kpi.label}
                          </span>
                        </div>
                      ))}
                    </div>

                    {/* 2 Clean Visual Blocks */}
                    <div className="px-6 pb-5 space-y-3">
                      {step.uiBlocks.map((block) => (
                        <div
                          key={block.title}
                          className="rounded-2xl p-4 bg-white/[0.04] border border-white/12"
                        >
                          <div className="flex items-center justify-between gap-2 mb-1.5">
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
                                backgroundColor: `${step.accentColor}28`,
                                color: step.accentColor,
                              }}
                            >
                              {block.badge}
                            </span>
                          </div>
                          {block.lines.map((line, lIdx) => (
                            <p
                              key={lIdx}
                              className="text-xs sm:text-sm text-white/80 leading-relaxed"
                            >
                              {line}
                            </p>
                          ))}
                        </div>
                      ))}
                    </div>

                    {/* Window Footer */}
                    <div className="px-5 py-2.5 bg-[#180a25] border-t border-white/10 flex items-center justify-between text-xs font-mono">
                      <span className="text-white/65 flex items-center gap-1.5">
                        <ShieldCheck className="w-4 h-4 text-amber-300" />
                        4 автопроверки активны
                      </span>
                      <span
                        className="font-bold"
                        style={{ color: step.accentColor }}
                      >
                        Шаг {step.stepNum} / 03
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
