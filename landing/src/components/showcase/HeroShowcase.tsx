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
  'layer-autopilot': <Zap className="w-4 h-4" />,
  'layer-claude': <Cpu className="w-4 h-4" />,
  'layer-finance': <TrendingUp className="w-4 h-4" />,
  'layer-deploy': <ShieldCheck className="w-4 h-4" />,
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
      {/* Main Clean 50/50 Stage */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center my-auto py-2">
        {/* LEFT COLUMN (5 cols): Punchy Headline + Clean 2x2 Layer Switcher + CTA */}
        <div className="lg:col-span-5 flex flex-col items-start text-left z-20">
          <motion.div
            key={`tag-${activeLayer.id}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="inline-flex items-center gap-2.5 px-4 py-1.5 rounded-full bg-white/10 border border-white/20 backdrop-blur-xl mb-5"
          >
            <span
              className="w-2 h-2 rounded-full animate-pulse"
              style={{ backgroundColor: activeLayer.accentColor }}
            />
            <span className="font-mono text-[11px] font-bold tracking-wider uppercase text-white">
              {activeLayer.layerTag}
            </span>
          </motion.div>

          <AnimatePresence mode="wait">
            <motion.h1
              key={`h1-${activeLayer.id}`}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ type: 'spring', stiffness: 340, damping: 24 }}
              className="font-display font-black uppercase text-[34px] sm:text-[46px] xl:text-[52px] leading-[0.96] tracking-[-0.03em] text-white mb-4"
            >
              {activeLayer.headline}
              <span
                className="block mt-1.5"
                style={{ color: activeLayer.accentColor }}
              >
                {activeLayer.accentHeadline}
              </span>
            </motion.h1>
          </AnimatePresence>

          <p className="text-white/80 text-base leading-relaxed mb-7 max-w-lg">
            {activeLayer.description}
          </p>

          {/* Compact 2x2 Architectural Layer Selector (Minimal text, instant visual feedback) */}
          <div className="w-full grid grid-cols-2 gap-3 mb-7">
            {STACK_LAYERS.map((layer) => {
              const isSelected = layer.id === activeLayer.id;
              return (
                <button
                  key={layer.id}
                  type="button"
                  onClick={() => onSelectLayer(layer.id)}
                  className={`group relative flex flex-col justify-between p-4 rounded-2xl border text-left transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-white text-[#12061c] border-white shadow-[0_18px_45px_rgba(0,0,0,0.45)] -translate-y-0.5'
                      : 'bg-black/35 text-white border-white/15 hover:bg-white/10 hover:border-white/30'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span
                      className={`inline-flex items-center gap-1.5 font-mono text-[11px] font-extrabold uppercase ${
                        isSelected ? 'text-rose-600' : 'text-white/65'
                      }`}
                    >
                      {LAYER_ICONS[layer.id]}
                      <span>{layer.code.split('·')[0]}</span>
                    </span>
                    <span
                      className={`font-mono text-xs font-black px-2 py-0.5 rounded-md ${
                        isSelected
                          ? 'bg-[#12061c] text-white'
                          : 'bg-white/10 text-white/90'
                      }`}
                    >
                      {layer.SlabSpec.centerMetric}
                    </span>
                  </div>

                  <span className="font-extrabold text-sm sm:text-[15px] block truncate">
                    {layer.shortName}
                  </span>
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
              className="inline-flex items-center justify-center gap-3 px-7 py-4 rounded-2xl bg-white text-[#12061c] font-extrabold text-sm shadow-[0_20px_50px_rgba(0,0,0,0.5)] hover:bg-rose-50 transition-all cursor-pointer"
            >
              <Sparkles className="w-4 h-4 text-rose-600" />
              <span>
                {isAuthed ? 'Открыть проекты' : activeTariff.ctaText}
              </span>
              <ArrowUpRight className="w-4 h-4" />
            </motion.a>

            <motion.button
              type="button"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => onScrollToSection('prompt-sandbox')}
              className="inline-flex items-center gap-2.5 px-5 py-4 rounded-2xl bg-black/35 hover:bg-black/55 border border-white/25 backdrop-blur-xl text-white font-bold text-sm transition-all cursor-pointer"
            >
              <Play className="w-4 h-4 fill-white" />
              <span>Примеры проектов</span>
            </motion.button>
          </div>
        </div>

        {/* RIGHT COLUMN (7 cols): Clean 3D Exploded Stack + Giant Backdrop Word + 3 Big Counters */}
        <div className="lg:col-span-7 relative flex flex-col items-center justify-center min-h-[470px] sm:min-h-[540px] select-none overflow-hidden xl:overflow-visible">
          {/* LAYER 1 (z-0): Giant Backdrop Word */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-0">
            <AnimatePresence mode="wait">
              <motion.div
                key={`${activeLayer.id}-${activeLayer.giantWord}`}
                initial={{ opacity: 0, y: 32, scale: 0.9, filter: 'blur(10px)' }}
                animate={{ opacity: 0.22, y: -24, scale: 1, filter: 'blur(0px)' }}
                exit={{ opacity: 0, y: -32, scale: 1.06, filter: 'blur(10px)' }}
                transition={{ type: 'spring', stiffness: 300, damping: 24 }}
                className="font-display font-black uppercase text-[44px] sm:text-[90px] xl:text-[116px] 2xl:text-[136px] leading-none tracking-[-0.05em] text-white whitespace-nowrap select-none"
              >
                {activeLayer.giantWord}
              </motion.div>
            </AnimatePresence>
          </div>

          {/* LAYER 2 (z-10): Interactive WebGL 4-Layer Exploded Stack */}
          <div className="relative w-full h-[430px] sm:h-[490px] z-10">
            <ThreeProjectCoreStage
              activeLayerId={activeLayer.id}
              tariff={activeTariff}
              spinTrigger={spinTrigger}
              chassisMode={chassisMode}
              onSelectLayer={onSelectLayer}
            />
          </div>

          {/* LAYER 3 (z-20): Compact Pill Satellites (1-line, zero clutter) */}
          <AnimatePresence mode="wait">
            <motion.div
              key={`sat-left-${activeLayer.id}`}
              initial={{ opacity: 0, x: -16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              className="hidden sm:inline-flex items-center gap-2.5 px-4 py-2.5 rounded-full bg-black/70 border border-white/25 backdrop-blur-xl shadow-2xl absolute top-10 left-4 z-20 pointer-events-none"
            >
              <span
                className="w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: activeLayer.accentColor }}
              />
              <span className="text-xs font-extrabold text-white">
                {activeLayer.leftBracketTitle}
              </span>
              <span className="text-xs text-white/65">
                · {activeLayer.leftBracketSub}
              </span>
            </motion.div>
          </AnimatePresence>

          {/* 3 Clean Big-Number Counters Below 3D Stage */}
          <div className="relative z-20 w-full grid grid-cols-3 gap-3 mt-1">
            {activeLayer.metrics.map((m) => (
              <div
                key={m.label}
                className="rounded-2xl px-4 py-3 bg-black/45 border border-white/15 backdrop-blur-xl text-center sm:text-left"
              >
                <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-1">
                  <span className="font-display font-black text-lg sm:text-2xl text-white">
                    {m.value}
                  </span>
                  <span
                    className="hidden sm:inline-block font-mono text-[11px] font-bold"
                    style={{ color: activeLayer.accentColor }}
                  >
                    {m.delta}
                  </span>
                </div>
                <p className="text-xs text-white/65 truncate mt-0.5">{m.label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* BOTTOM HUD: VisionOS Floating Magnetic Switcher Bar */}
      <div className="relative z-20 mt-4 rounded-[26px] p-2.5 sm:p-3 bg-black/55 border border-white/20 backdrop-blur-2xl shadow-[0_24px_60px_rgba(0,0,0,0.55)] flex flex-col xl:flex-row items-center justify-between gap-3">
        {/* 1. 3D Chassis Mode Switcher */}
        <div className="flex items-center gap-1.5 bg-white/[0.06] p-1 rounded-2xl border border-white/10 w-full xl:w-auto justify-center">
          <span className="hidden sm:inline-block text-[11px] font-mono uppercase tracking-wider text-white/60 px-2.5">
            3D-вид:
          </span>
          {(
            [
              { id: 'exploded', label: '4 слоя (Стек)', icon: <Layers className="w-3.5 h-3.5" /> },
              { id: 'compact', label: 'Монолит', icon: <Box className="w-3.5 h-3.5" /> },
              { id: 'gyro', label: 'Гироскоп', icon: <Orbit className="w-3.5 h-3.5" /> },
            ] as const
          ).map((item) => {
            const active = chassisMode === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onChangeChassisMode(item.id)}
                className={`relative inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
                  active ? 'text-[#12061c]' : 'text-white/80 hover:text-white'
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

        {/* 2. Tariff Switcher */}
        <div className="flex items-center gap-1.5 bg-white/[0.06] p-1 rounded-2xl border border-white/10 w-full xl:w-auto justify-center">
          <span className="hidden sm:inline-block text-[11px] font-mono uppercase tracking-wider text-white/60 px-2.5">
            Тариф:
          </span>
          {TARIFF_OPTIONS.map((t) => {
            const isSelected = t.id === activeTariff.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => onSelectTariff(t)}
                className={`relative px-3.5 py-2 rounded-xl text-xs font-extrabold transition-colors cursor-pointer ${
                  isSelected ? 'text-[#12061c]' : 'text-white/80 hover:text-white'
                }`}
              >
                {isSelected && (
                  <motion.span
                    layoutId="heroTariffPill"
                    transition={{ type: 'spring', stiffness: 340, damping: 24 }}
                    className="absolute inset-0 rounded-xl shadow-md"
                    style={{ backgroundColor: activeLayer.accentColor }}
                  />
                )}
                <span className="relative z-10">
                  {t.name} · {t.priceFormatted}
                </span>
              </button>
            );
          })}
        </div>

        {/* 3. Quick Layer Stepper */}
        <div className="flex items-center gap-2.5 w-full xl:w-auto justify-between xl:justify-end px-1">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              aria-label="Предыдущий слой"
              onClick={() => cycleLayer(-1)}
              className="w-8 h-8 rounded-xl bg-white/10 hover:bg-white/20 border border-white/15 flex items-center justify-center text-white transition-colors cursor-pointer"
            >
              <ChevronUp className="w-4 h-4" />
            </button>
            <span className="font-mono text-xs font-bold text-white/90 px-2">
              0{activeIdx + 1} / 04
            </span>
            <button
              type="button"
              aria-label="Следующий слой"
              onClick={() => cycleLayer(1)}
              className="w-8 h-8 rounded-xl bg-white/10 hover:bg-white/20 border border-white/15 flex items-center justify-center text-white transition-colors cursor-pointer"
            >
              <ChevronDown className="w-4 h-4" />
            </button>
          </div>

          <button
            type="button"
            onClick={() => onScrollToSection('pricing')}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white/15 hover:bg-white/25 border border-white/20 text-xs font-bold text-white transition-colors cursor-pointer"
          >
            <span>Все тарифы</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </section>
  );
};
