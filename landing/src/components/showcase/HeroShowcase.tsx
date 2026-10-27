import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowUpRight,
  Box,
  ChevronDown,
  ChevronUp,
  Cpu,
  Layers,
  Orbit,
  Play,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Zap,
} from 'lucide-react';
import {
  STACK_LAYERS,
  TARIFF_OPTIONS,
  type ChassisMode,
  type StackLayerId,
  type StackLayerSpec,
  type TariffOption,
} from '../../data/showcaseData';
import { ThreeProjectCoreStage } from './ThreeProjectCoreStage';

interface HeroShowcaseProps {
  activeLayer: StackLayerSpec;
  activeTariff: TariffOption;
  chassisMode: ChassisMode;
  spinTrigger: number;
  isAuthed: boolean;
  appBase: string;
  onSelectLayer: (id: StackLayerId) => void;
  onSelectTariff: (tariff: TariffOption) => void;
  onChangeChassisMode: (mode: ChassisMode) => void;
  onScrollToSection: (sectionId: string) => void;
}

const LAYER_ICONS: Record<StackLayerId, React.ReactNode> = {
  'layer-deploy': <ShieldCheck className="w-4 h-4" />,
  'layer-finance': <TrendingUp className="w-4 h-4" />,
  'layer-autopilot': <Zap className="w-4 h-4" />,
  'layer-claude': <Cpu className="w-4 h-4" />,
};

export const HeroShowcase: React.FC<HeroShowcaseProps> = ({
  activeLayer,
  activeTariff,
  chassisMode,
  spinTrigger,
  isAuthed,
  appBase,
  onSelectLayer,
  onSelectTariff,
  onChangeChassisMode,
  onScrollToSection,
}) => {
  const activeIdx = STACK_LAYERS.findIndex((l) => l.id === activeLayer.id);

  const cycleLayer = (dir: -1 | 1) => {
    const next = (activeIdx + dir + STACK_LAYERS.length) % STACK_LAYERS.length;
    onSelectLayer(STACK_LAYERS[next]!.id);
  };

  return (
    <section
      id="hero"
      className="relative z-10 max-w-[1440px] mx-auto px-4 sm:px-8 pt-4 pb-10 min-h-[calc(100vh-84px)] flex flex-col justify-between"
    >
      {/* Main Asymmetric 50/50 Architectural Stage (isometric-exploded-stack) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-6 items-center my-auto py-2">
        {/* LEFT COLUMN (5 cols): Editorial + 4-Tier Architectural Layer Selector (pin-04.jpg & pin-02.jpg) */}
        <div className="lg:col-span-5 flex flex-col items-start text-left z-20">
          {/* Status Tag */}
          <motion.div
            key={`tag-${activeLayer.id}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="inline-flex items-center gap-2.5 px-3.5 py-1.5 rounded-full bg-white/[0.06] border border-white/15 backdrop-blur-xl mb-4"
          >
            <span
              className="w-2 h-2 rounded-full animate-pulse"
              style={{ backgroundColor: activeLayer.primaryColor }}
            />
            <span className="font-mono text-[11px] font-bold tracking-wider uppercase text-white/90">
              {activeLayer.layerTag}
            </span>
          </motion.div>

          {/* Dynamic Display Headline */}
          <AnimatePresence mode="wait">
            <motion.h1
              key={`h1-${activeLayer.id}`}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ type: 'spring', stiffness: 340, damping: 24 }}
              className="font-display font-black uppercase text-[32px] sm:text-[42px] xl:text-[46px] leading-[0.98] tracking-[-0.03em] text-white mb-3"
            >
              {activeLayer.headline}
              <span
                className="block mt-1"
                style={{ color: activeLayer.primaryColor }}
              >
                {activeLayer.accentHeadline}
              </span>
            </motion.h1>
          </AnimatePresence>

          <p className="text-white/75 text-sm sm:text-[15px] leading-relaxed mb-5 max-w-xl">
            {activeLayer.description}
          </p>

          {/* Interactive 4-Layer Architectural Selector Stack (inspired by Pinterest pin-04.jpg) */}
          <div className="w-full space-y-2 mb-6">
            <div className="flex items-center justify-between text-[11px] font-mono uppercase tracking-wider text-white/50 px-1 mb-1">
              <span>Архитектурный стек платформы (нажмите на уровень)</span>
              <span className="text-white/80 font-bold">{activeLayer.code}</span>
            </div>

            {STACK_LAYERS.map((layer) => {
              const isSelected = layer.id === activeLayer.id;
              return (
                <button
                  key={layer.id}
                  type="button"
                  onClick={() => onSelectLayer(layer.id)}
                  className={`w-full group relative flex items-center justify-between gap-3 px-4 py-3 rounded-2xl border text-left transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-white/[0.12] border-white/45 shadow-[0_12px_32px_rgba(0,0,0,0.45)] translate-x-1.5'
                      : 'bg-[#0b101b]/70 border-white/10 hover:bg-white/[0.06] hover:border-white/25'
                  }`}
                >
                  {/* Left active indicator bar */}
                  <span
                    className="w-1.5 h-8 rounded-full shrink-0 transition-all"
                    style={{
                      backgroundColor: isSelected ? layer.primaryColor : 'rgba(255,255,255,0.15)',
                      boxShadow: isSelected ? `0 0 14px ${layer.primaryColor}` : 'none',
                    }}
                  />

                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div
                      className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 font-mono text-xs font-black border"
                      style={{
                        backgroundColor: isSelected ? `${layer.primaryColor}28` : 'rgba(255,255,255,0.04)',
                        borderColor: isSelected ? layer.primaryColor : 'rgba(255,255,255,0.12)',
                        color: isSelected ? layer.primaryColor : 'rgba(255,255,255,0.7)',
                      }}
                    >
                      0{layer.index + 1}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-white truncate">
                          {layer.shortName}
                        </span>
                        {isSelected && (
                          <span
                            className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-md uppercase"
                            style={{
                              backgroundColor: `${layer.primaryColor}25`,
                              color: layer.primaryColor,
                            }}
                          >
                            Активен в 3D
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-white/60 truncate mt-0.5">
                        {layer.leftBracketTitle} · {layer.rightBracketTitle}
                      </p>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <span
                      className="font-mono text-xs font-extrabold block"
                      style={{ color: isSelected ? layer.accentColor : 'rgba(255,255,255,0.75)' }}
                    >
                      {layer.SlabSpec.centerMetric}
                    </span>
                    <span className="text-[10px] font-mono text-white/45">
                      Слой 0{layer.index + 1}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Primary & Secondary Action Row */}
          <div className="flex flex-wrap items-center gap-3 w-full">
            <motion.a
              href={isAuthed ? `${appBase}/projects` : `${appBase}/login`}
              whileHover={{ scale: 1.02, y: -2 }}
              whileTap={{ scale: 0.98 }}
              className="inline-flex items-center justify-center gap-3 px-6 py-4 rounded-2xl bg-white text-[#070a12] font-extrabold text-sm shadow-[0_20px_50px_rgba(0,0,0,0.5)] hover:bg-slate-100 transition-all cursor-pointer"
            >
              <Sparkles className="w-4 h-4 text-emerald-600" />
              <span>
                {isAuthed ? 'Открыть рабочее пространство' : activeTariff.ctaText}
              </span>
              <ArrowUpRight className="w-4 h-4" />
            </motion.a>

            <motion.button
              type="button"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => onScrollToSection('prompt-sandbox')}
              className="inline-flex items-center gap-2.5 px-5 py-4 rounded-2xl bg-white/[0.07] hover:bg-white/[0.13] border border-white/20 backdrop-blur-xl text-white font-bold text-sm transition-all cursor-pointer"
            >
              <Play className="w-4 h-4 fill-white" />
              <span>Песочница: идея → план</span>
            </motion.button>
          </div>
        </div>

        {/* RIGHT COLUMN (7 cols): 3-Layer Depth Sandwich + Exploded 3D Hardware/Protocol Stack + Brackets */}
        <div className="lg:col-span-7 relative flex flex-col items-center justify-center min-h-[470px] sm:min-h-[540px] select-none overflow-hidden xl:overflow-visible">
          {/* LAYER 1 (z-0): Giant Backdrop Word */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-0">
            <AnimatePresence mode="wait">
              <motion.div
                key={`${activeLayer.id}-${activeLayer.giantWord}`}
                initial={{ opacity: 0, y: 32, scale: 0.9, filter: 'blur(10px)' }}
                animate={{ opacity: 0.16, y: -18, scale: 1, filter: 'blur(0px)' }}
                exit={{ opacity: 0, y: -32, scale: 1.06, filter: 'blur(10px)' }}
                transition={{ type: 'spring', stiffness: 300, damping: 24 }}
                className="font-display font-black uppercase text-[42px] sm:text-[84px] xl:text-[104px] 2xl:text-[124px] leading-none tracking-[-0.05em] text-white whitespace-nowrap select-none"
              >
                {activeLayer.giantWord}
              </motion.div>
            </AnimatePresence>
          </div>

          {/* LAYER 2 (z-10): Interactive WebGL 4-Layer Exploded Stack */}
          <div className="relative w-full h-[430px] sm:h-[500px] z-10">
            <ThreeProjectCoreStage
              activeLayerId={activeLayer.id}
              tariff={activeTariff}
              spinTrigger={spinTrigger}
              chassisMode={chassisMode}
              onSelectLayer={onSelectLayer}
            />
          </div>

          {/* LAYER 3 (z-20): Architectural Callout Brackets (inspired by Pinterest pin-04.jpg) */}
          <AnimatePresence mode="wait">
            <motion.div
              key={`bracket-left-${activeLayer.id}`}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
              transition={{ type: 'spring', stiffness: 320, damping: 24 }}
              className="hidden sm:flex items-start gap-3 px-4 py-3 rounded-2xl bg-[#070b14]/85 border border-white/25 backdrop-blur-2xl shadow-2xl absolute top-8 left-2 xl:left-4 z-20 pointer-events-none max-w-[250px]"
            >
              <div
                className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 mt-0.5"
                style={{
                  backgroundColor: `${activeLayer.primaryColor}25`,
                  color: activeLayer.primaryColor,
                }}
              >
                {LAYER_ICONS[activeLayer.id]}
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <span
                    className="font-mono text-[10px] font-bold uppercase"
                    style={{ color: activeLayer.primaryColor }}
                  >
                    {activeLayer.code}
                  </span>
                  <span className="text-white/30">•</span>
                  <span className="font-mono text-[10px] text-white/60">ВХОД КОНТУРА</span>
                </div>
                <p className="text-xs font-extrabold text-white mt-0.5">
                  {activeLayer.leftBracketTitle}
                </p>
                <p className="text-[11px] text-white/65 leading-snug mt-0.5">
                  {activeLayer.leftBracketSub}
                </p>
              </div>
            </motion.div>
          </AnimatePresence>

          <AnimatePresence mode="wait">
            <motion.div
              key={`bracket-right-${activeLayer.id}`}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 16 }}
              transition={{ type: 'spring', stiffness: 320, damping: 24 }}
              className="hidden sm:flex items-start gap-3 px-4 py-3 rounded-2xl bg-[#070b14]/85 border border-white/25 backdrop-blur-2xl shadow-2xl absolute bottom-20 right-2 xl:right-4 z-20 pointer-events-none max-w-[260px]"
            >
              <div
                className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 mt-0.5"
                style={{
                  backgroundColor: `${activeLayer.accentColor}25`,
                  color: activeLayer.accentColor,
                }}
              >
                <ShieldCheck className="w-4 h-4" />
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <span
                    className="font-mono text-[10px] font-bold uppercase"
                    style={{ color: activeLayer.accentColor }}
                  >
                    ТЕЛЕМЕТРИЯ СЛОЯ
                  </span>
                </div>
                <p className="text-xs font-extrabold text-white mt-0.5">
                  {activeLayer.rightBracketTitle}
                </p>
                <p className="text-[11px] text-white/65 leading-snug mt-0.5">
                  {activeLayer.rightBracketSub}
                </p>
              </div>
            </motion.div>
          </AnimatePresence>

          {/* 3 Live Telemetry Metrics Strip below 3D Stack (inspired by Solane pin) */}
          <div className="relative z-20 w-full grid grid-cols-3 gap-2.5 sm:gap-3 mt-1">
            {activeLayer.metrics.map((m) => (
              <div
                key={m.label}
                className="rounded-2xl px-3.5 py-2.5 bg-[#090d18]/80 border border-white/15 backdrop-blur-xl"
              >
                <div className="flex items-baseline justify-between gap-1">
                  <span
                    className="font-display font-black text-base sm:text-xl text-white"
                  >
                    {m.value}
                  </span>
                  <span
                    className="hidden sm:inline-block font-mono text-[10px] font-bold"
                    style={{ color: activeLayer.primaryColor }}
                  >
                    {m.delta}
                  </span>
                </div>
                <p className="text-[11px] text-white/60 truncate mt-0.5">{m.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* BOTTOM HUD: VisionOS Floating Magnetic Switcher Bar (floating-magnetic-dock dealt by deal-showcase.mjs) */}
      <div className="relative z-20 mt-4 rounded-[26px] p-2.5 sm:p-3 bg-[#080c16]/85 border border-white/20 backdrop-blur-2xl shadow-[0_24px_60px_rgba(0,0,0,0.6)] flex flex-col xl:flex-row items-center justify-between gap-3">
        {/* 1. 3D Chassis Mode Switcher */}
        <div className="flex items-center gap-1.5 bg-white/[0.04] p-1 rounded-2xl border border-white/10 w-full xl:w-auto justify-center">
          <span className="hidden sm:inline-block text-[11px] font-mono uppercase tracking-wider text-white/50 px-2.5">
            3D-режим:
          </span>
          {(
            [
              { id: 'exploded', label: 'Взрыв-схема (4 слоя)', icon: <Layers className="w-3.5 h-3.5" /> },
              { id: 'compact', label: 'Монолитное ядро', icon: <Box className="w-3.5 h-3.5" /> },
              { id: 'gyro', label: 'Гироскоп + Стек', icon: <Orbit className="w-3.5 h-3.5" /> },
            ] as const
          ).map((item) => {
            const active = chassisMode === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onChangeChassisMode(item.id)}
                className={`relative inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
                  active ? 'text-[#060911]' : 'text-white/75 hover:text-white'
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="chassisModePill"
                    transition={{ type: 'spring', stiffness: 340, damping: 24 }}
                    className="absolute inset-0 rounded-xl bg-white shadow-md"
                  />
                )}
                <span className="relative z-10 flex items-center gap-1.5">
                  {item.icon}
                  <span>{item.label}</span>
                </span>
              </button>
            );
          })}
        </div>

        {/* 2. Tariff Contour Switcher (updates 3D Slab Texture + Price in real time) */}
        <div className="flex items-center gap-1.5 bg-white/[0.04] p-1 rounded-2xl border border-white/10 w-full xl:w-auto justify-center">
          <span className="hidden sm:inline-block text-[11px] font-mono uppercase tracking-wider text-white/50 px-2.5">
            Тариф в 3D:
          </span>
          {TARIFF_OPTIONS.map((t) => {
            const isSelected = t.id === activeTariff.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => onSelectTariff(t)}
                className={`relative px-3.5 py-2 rounded-xl text-xs font-extrabold transition-colors cursor-pointer ${
                  isSelected ? 'text-[#060911]' : 'text-white/75 hover:text-white'
                }`}
              >
                {isSelected && (
                  <motion.span
                    layoutId="heroTariffPill"
                    transition={{ type: 'spring', stiffness: 340, damping: 24 }}
                    className="absolute inset-0 rounded-xl shadow-md"
                    style={{ backgroundColor: activeLayer.primaryColor }}
                  />
                )}
                <span className="relative z-10">
                  {t.name} · {t.priceFormatted}
                </span>
              </button>
            );
          })}
        </div>

        {/* 3. Layer Stepper & Quick Scroll to ROI Reactor */}
        <div className="flex items-center gap-2.5 w-full xl:w-auto justify-between xl:justify-end px-1">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              aria-label="Предыдущий слой"
              onClick={() => cycleLayer(-1)}
              className="w-8 h-8 rounded-xl bg-white/[0.06] hover:bg-white/[0.15] border border-white/15 flex items-center justify-center text-white transition-colors cursor-pointer"
            >
              <ChevronUp className="w-4 h-4" />
            </button>
            <span className="font-mono text-xs font-bold text-white/80 px-1.5">
              Слой 0{activeLayer.index + 1} / 04
            </span>
            <button
              type="button"
              aria-label="Следующий слой"
              onClick={() => cycleLayer(1)}
              className="w-8 h-8 rounded-xl bg-white/[0.06] hover:bg-white/[0.15] border border-white/15 flex items-center justify-center text-white transition-colors cursor-pointer"
            >
              <ChevronDown className="w-4 h-4" />
            </button>
          </div>

          <button
            type="button"
            onClick={() => onScrollToSection('pricing')}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 text-xs font-bold text-white transition-colors cursor-pointer"
          >
            <span>Сравнить тарифы</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </section>
  );
};
