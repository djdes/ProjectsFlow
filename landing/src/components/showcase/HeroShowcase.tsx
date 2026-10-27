import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowRight,
  ArrowUpRight,
  Play,
  Sparkles,
  Zap,
  ShieldCheck,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import {
  PILLARS_DATA,
  TARIFF_OPTIONS,
  type PillarCode,
  type PillarConfig,
} from '@/data/showcaseData';
import { ThreeProjectCoreStage } from './ThreeProjectCoreStage';

interface HeroShowcaseProps {
  activePillar: PillarCode;
  onSelectPillar: (pillar: PillarCode) => void;
  appBase?: string;
}

const PILLAR_ORDER: PillarCode[] = ['AI', 'CL', 'FN', 'DP'];

export const HeroShowcase: React.FC<HeroShowcaseProps> = ({
  activePillar,
  onSelectPillar,
  appBase = '',
}) => {
  const [tariffIndex, setTariffIndex] = useState<number>(1); // Прайм · 1 900 ₽ по умолчанию
  const [mode, setMode] = useState<'monolith' | 'stack'>('monolith');
  const [spinTrigger, setSpinTrigger] = useState<number>(0);

  const pillar: PillarConfig = PILLARS_DATA[activePillar];
  const currentTariff = TARIFF_OPTIONS[tariffIndex] ?? TARIFF_OPTIONS[1]!;
  const slideIdx = PILLAR_ORDER.indexOf(activePillar);

  const handlePillarChange = (code: PillarCode) => {
    onSelectPillar(code);
    setSpinTrigger((prev) => prev + 1);
  };

  const handleTariffChange = (idx: number) => {
    setTariffIndex(idx);
    setSpinTrigger((prev) => prev + 1);
  };

  const stepPillar = (dir: -1 | 1) => {
    const nextIdx = (slideIdx + dir + PILLAR_ORDER.length) % PILLAR_ORDER.length;
    handlePillarChange(PILLAR_ORDER[nextIdx]!);
  };

  return (
    <section
      id="showcase"
      aria-labelledby="hero-title"
      className="relative min-h-screen max-w-[1440px] mx-auto px-5 sm:px-9 pt-24 pb-8 flex flex-col justify-between"
    >
      {/* Верхние табы переключения 3D-режима (Planet BOLD: Monolith / Stack) */}
      <div className="flex flex-wrap justify-center gap-2.5 mb-2 z-20">
        {(['monolith', 'stack'] as const).map((tabMode) => {
          const isActive = mode === tabMode;
          return (
            <button
              key={tabMode}
              type="button"
              onClick={() => {
                setMode(tabMode);
                setSpinTrigger((s) => s + 1);
              }}
              className={`relative px-5 sm:px-6 py-2.5 rounded-full text-xs sm:text-sm font-semibold transition-colors cursor-pointer ${
                isActive
                  ? 'text-[#140a1c]'
                  : 'text-white/90 hover:text-white bg-white/10 border border-white/20 backdrop-blur-md'
              }`}
            >
              {isActive && (
                <motion.span
                  layoutId="heroModePill"
                  className="absolute inset-0 rounded-full bg-white shadow-xl"
                  transition={{ type: 'spring', stiffness: 320, damping: 26 }}
                />
              )}
              <span className="relative z-10">
                {tabMode === 'monolith'
                  ? '3D Монолит и Тарифы'
                  : '3D Ядро Автопилота + Claude'}
              </span>
            </button>
          );
        })}
      </div>

      {/* Главная 3-колоночная сцена (Planet BOLD + GROW + Mindly) */}
      <div className="grid grid-cols-1 xl:grid-cols-[360px_1fr_340px] items-center gap-6 my-auto py-4 relative">
        {/* Левая колонка: Типографика и пилюльные кнопки (Mindly + Planet BOLD) */}
        <motion.div
          initial={{ opacity: 0, x: -28 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
          className="relative z-20 flex flex-col items-center xl:items-start text-center xl:text-left gap-5"
        >
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/14 border border-white/25 backdrop-blur-xl text-xs sm:text-sm font-medium">
            <Sparkles className="w-4 h-4 text-amber-300 shrink-0" />
            <span>{pillar.tagline}</span>
          </div>

          <h1
            id="hero-title"
            className="font-display font-black uppercase text-3xl sm:text-5xl xl:text-[42px] leading-[1.06] tracking-tight"
          >
            ОПИШИ ИДЕЮ —{' '}
            <span
              className="block mt-1.5 bg-clip-text text-transparent"
              style={{
                backgroundImage: `linear-gradient(95deg, #ffffff 0%, ${pillar.cardAccentHex} 58%, #ffd6ff 100%)`,
              }}
            >
              ПОЛУЧИ ПРОДУКТ
            </span>
          </h1>

          <p className="text-sm sm:text-[15px] leading-relaxed text-white/85 max-w-md">
            Подписка на Claude уже внутри, проект движется на автопилоте, а прибыль и расходы видны в рублях. Без VPN, без чужих API-ключей и без технической рутины.
          </p>

          <div className="flex flex-wrap items-center justify-center xl:justify-start gap-3 pt-1">
            <motion.a
              whileHover={{ scale: 1.03, y: -2 }}
              whileTap={{ scale: 0.98 }}
              href={`${appBase}${currentTariff.href}`}
              data-auth-anon
              className="inline-flex items-center gap-3 px-7 py-4 rounded-full bg-white text-[#140a1c] font-bold text-sm sm:text-[15px] shadow-[0_18px_40px_rgba(0,0,0,0.32)]"
            >
              <span>{currentTariff.ctaLabel}</span>
              <ArrowRight className="w-4 h-4 shrink-0" />
            </motion.a>

            <motion.a
              whileHover={{ scale: 1.03, y: -2 }}
              whileTap={{ scale: 0.98 }}
              href={`${appBase}/`}
              data-auth-authed
              className="inline-flex items-center gap-3 px-7 py-4 rounded-full bg-white text-[#140a1c] font-bold text-sm sm:text-[15px] shadow-[0_18px_40px_rgba(0,0,0,0.32)]"
            >
              <span>Открыть приложение</span>
              <ArrowRight className="w-4 h-4 shrink-0" />
            </motion.a>

            <motion.a
              whileHover={{ scale: 1.03, y: -2 }}
              href="#live-board"
              className="inline-flex items-center gap-2.5 px-5 py-3.5 rounded-full bg-white/14 border border-white/25 backdrop-blur-xl text-sm font-semibold hover:bg-white/22 transition text-white"
            >
              <span className="w-7 h-7 rounded-full bg-white/25 grid place-items-center">
                <Play className="w-3.5 h-3.5 fill-current" />
              </span>
              <span>Живая доска AI</span>
            </motion.a>
          </div>

          <p className="text-xs text-white/70 max-w-sm">
            Первый час на Прайме — бесплатно и без карты. Не зашло — вернём деньги, а весь код и проект остаются твоими.
          </p>
        </motion.div>

        {/* Центральная 3D-сцена: Гигантское слово позади 3D-модели + парящие спутники спереди (BOLD + GROW) */}
        <div className="relative flex flex-col items-center justify-center min-h-[460px] sm:min-h-[520px] select-none overflow-hidden xl:overflow-visible">
          {/* Слой 1 (z-0): Гигантское слово во всю ширину центральной сцены */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-0 overflow-hidden xl:overflow-visible">
            <AnimatePresence mode="wait">
              <motion.div
                key={pillar.giantWord}
                initial={{ opacity: 0, y: 36, scale: 0.9, filter: 'blur(10px)' }}
                animate={{ opacity: 0.94, y: 0, scale: 1, filter: 'blur(0px)' }}
                exit={{ opacity: 0, y: -36, scale: 1.08, filter: 'blur(10px)' }}
                transition={{ type: 'spring', stiffness: 220, damping: 24 }}
                className="font-display font-black text-[44px] sm:text-[92px] xl:text-[100px] 2xl:text-[136px] leading-none tracking-[-0.05em] text-white drop-shadow-[0_24px_60px_rgba(0,0,0,0.35)] whitespace-nowrap"
              >
                {pillar.giantWord}
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Слой 2 (z-10): Интерактивная 3D-модель (React Three Fiber + Three.js) */}
          <ThreeProjectCoreStage
            pillar={pillar}
            tariff={currentTariff}
            spinTrigger={spinTrigger}
            mode={mode}
          />

          {/* Слой 3 (z-20): Стеклянные бейджи поверх гигантского слова (эффект глубины GROW) */}
          <motion.div
            key={`sat1-${pillar.code}`}
            initial={{ opacity: 0, x: -24, y: 10 }}
            animate={{ opacity: 1, x: 0, y: 0 }}
            transition={{ delay: 0.1, type: 'spring', stiffness: 240, damping: 22 }}
            className="hidden sm:flex items-center gap-3 px-4 py-3 rounded-[18px] bg-[#120d1f]/75 border border-white/30 backdrop-blur-xl shadow-2xl absolute top-10 left-2 lg:left-4 z-20 pointer-events-none"
          >
            <div className="w-9 h-9 rounded-[12px] bg-white/15 grid place-items-center text-white">
              <Zap className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xs font-bold text-white">{pillar.satellite1.title}</div>
              <div className="text-[11px] text-white/75">{pillar.satellite1.sub}</div>
            </div>
          </motion.div>

          <motion.div
            key={`sat2-${pillar.code}`}
            initial={{ opacity: 0, x: 24, y: 10 }}
            animate={{ opacity: 1, x: 0, y: 0 }}
            transition={{ delay: 0.16, type: 'spring', stiffness: 240, damping: 22 }}
            className="hidden sm:flex items-center gap-3 px-4 py-3 rounded-[18px] bg-[#120d1f]/75 border border-white/30 backdrop-blur-xl shadow-2xl absolute bottom-10 right-2 lg:right-4 z-20 pointer-events-none"
          >
            <div className="w-9 h-9 rounded-[12px] bg-white/15 grid place-items-center text-white">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <div className="text-xs font-bold text-white">{pillar.satellite2.title}</div>
              <div className="text-[11px] text-white/75">{pillar.satellite2.sub}</div>
            </div>
          </motion.div>

          {/* Подпись под 3D-моделью как в Planet BOLD */}
          <div className="relative z-20 flex items-center gap-3 text-xs font-semibold text-white/80 -mt-2">
            <span className="w-9 h-[1.5px] bg-white/40" />
            <span>Двигайте мышь для 3D-наклона или переключайте режим и тариф справа</span>
            <span className="w-9 h-[1.5px] bg-white/40" />
          </div>
        </div>

        {/* Правая колонка: Стеклянная карточка Mindly + Круглые свитчеры Planet BOLD */}
        <motion.div
          initial={{ opacity: 0, x: 28 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
          className="relative z-20 flex flex-col items-center xl:items-end gap-6"
        >
          {/* Плавающая стеклянная карточка в стиле Mindly */}
          <a
            href="#grow-calculator"
            className="w-full max-w-sm flex items-center gap-3.5 p-4 rounded-[24px] bg-white/15 border border-white/30 backdrop-blur-2xl shadow-[0_20px_48px_rgba(0,0,0,0.25)] hover:bg-white/22 transition group text-left text-white"
          >
            <div className="w-12 h-12 rounded-full bg-white/25 border border-white/40 grid place-items-center text-2xl shrink-0">
              {pillar.iconEmoji}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold text-white truncate">{pillar.mindlyTitle}</div>
              <p className="text-xs text-white/80 line-clamp-2 leading-snug mt-0.5">
                {pillar.mindlyDesc}
              </p>
            </div>
            <span className="w-8 h-8 rounded-full bg-white/20 grid place-items-center shrink-0 group-hover:translate-x-0.5 transition">
              <ArrowRight className="w-4 h-4" />
            </span>
          </a>

          {/* Цветовые сферы режимов как в Planet BOLD (Choose Your Color) */}
          <div className="flex flex-col items-center xl:items-end gap-2.5">
            <span className="text-xs font-semibold text-white/80">
              Выберите ядро платформы (цвет сцены)
            </span>
            <div className="flex items-center gap-3" role="radiogroup" aria-label="Ядро платформы ProjectsFlow">
              {PILLAR_ORDER.map((code) => {
                const p = PILLARS_DATA[code];
                const isSelected = activePillar === code;
                return (
                  <button
                    key={code}
                    type="button"
                    onClick={() => handlePillarChange(code)}
                    style={{ background: p.orbGradient }}
                    className={`relative w-11 h-11 rounded-full grid place-items-center text-xs font-extrabold text-white shadow-lg transition-transform cursor-pointer ${
                      isSelected
                        ? 'scale-110 ring-2 ring-white ring-offset-2 ring-offset-black/40'
                        : 'opacity-85 hover:opacity-100 hover:scale-105'
                    }`}
                    title={p.nameRu}
                  >
                    {code}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Круглые кнопки тарифов как размеры в Planet BOLD */}
          <div className="flex flex-col items-center xl:items-end gap-2.5">
            <span className="text-xs font-semibold text-white/80">Выберите тариф на 3D-сцене</span>
            <div className="flex flex-wrap items-center justify-center xl:justify-end gap-2" role="radiogroup" aria-label="Тариф ProjectsFlow">
              {TARIFF_OPTIONS.map((t, idx) => {
                const isSelected = tariffIndex === idx;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => handleTariffChange(idx)}
                    className={`relative h-11 px-4 rounded-full text-xs font-bold border transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-white text-[#140a1c] border-white shadow-xl -translate-y-0.5'
                        : 'bg-white/10 text-white border-white/40 hover:bg-white/20 backdrop-blur-md'
                    }`}
                  >
                    {t.shortLabel}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Кнопка перехода к 3D-конструктору в правом нижнем углу */}
          <a
            href="#grow-calculator"
            className="inline-flex items-center gap-2 px-5 py-3 rounded-full bg-white text-[#140a1c] text-xs font-bold shadow-lg hover:scale-105 transition"
          >
            <span>Собрать конфигурацию проекта</span>
            <ArrowUpRight className="w-4 h-4" />
          </a>
        </motion.div>
      </div>

      {/* Нижний стеклянный док с 4 опорами, прогрессом 01 — 04 и круглыми стрелками (Mindly + GROW) */}
      <div className="relative z-20 mt-2 p-3.5 sm:px-6 rounded-[24px] bg-[#100b1a]/55 border border-white/20 backdrop-blur-2xl flex flex-col lg:flex-row items-center justify-between gap-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 w-full lg:flex-1">
          {PILLAR_ORDER.map((code) => {
            const p = PILLARS_DATA[code];
            const isSelected = activePillar === code;
            return (
              <button
                key={code}
                type="button"
                onClick={() => handlePillarChange(code)}
                className={`flex items-center gap-3 p-2.5 rounded-[16px] text-left transition cursor-pointer ${
                  isSelected
                    ? 'bg-white/18 border border-white/35 shadow-md'
                    : 'bg-white/5 border border-transparent hover:bg-white/12'
                }`}
              >
                <span className="w-10 h-10 rounded-full bg-white/15 grid place-items-center text-lg shrink-0">
                  {p.iconEmoji}
                </span>
                <div className="min-w-0">
                  <div className="text-xs font-bold text-white truncate">
                    {p.nameRu} · {p.metrics[0].value}
                  </div>
                  <div className="text-[11px] text-white/75 truncate">{p.metrics[1].value}</div>
                </div>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-4 shrink-0">
          <div className="flex items-center gap-2.5 font-mono text-xs font-semibold text-white">
            <span>0{slideIdx + 1}</span>
            <span className="w-16 h-1 rounded-full bg-white/25 overflow-hidden">
              <motion.span
                className="block h-full bg-white"
                animate={{ width: `${((slideIdx + 1) / PILLAR_ORDER.length) * 100}%` }}
                transition={{ type: 'spring', stiffness: 260, damping: 26 }}
              />
            </span>
            <span>04</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => stepPillar(-1)}
              className="w-10 h-10 rounded-full border border-white/35 bg-white/10 hover:bg-white hover:text-black text-white grid place-items-center transition cursor-pointer"
              aria-label="Предыдущий режим"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => stepPillar(1)}
              className="w-10 h-10 rounded-full border border-white/35 bg-white/10 hover:bg-white hover:text-black text-white grid place-items-center transition cursor-pointer"
              aria-label="Следующий режим"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
};
