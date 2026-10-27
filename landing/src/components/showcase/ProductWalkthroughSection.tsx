import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Copy, Check, Sparkles } from 'lucide-react';
import { WALKTHROUGH_STEPS } from '@/data/showcaseData';

export const ProductWalkthroughSection: React.FC = () => {
  const [activeStep, setActiveStep] = useState<number>(0);
  const [copied, setCopied] = useState<boolean>(false);

  const currentPrompt = WALKTHROUGH_STEPS[activeStep]?.demoPrompt ?? WALKTHROUGH_STEPS[0]!.demoPrompt;

  const handleCopyDemo = async () => {
    try {
      await navigator.clipboard.writeText(currentPrompt);
    } catch {
      // Fallback
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2200);
  };

  return (
    <section id="how" className="scroll-mt-24 max-w-[1440px] mx-auto my-24 px-4 sm:px-9">
      <div className="text-center max-w-2xl mx-auto mb-12 flex flex-col items-center gap-3.5">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/12 border border-white/25 backdrop-blur-xl text-xs sm:text-sm font-medium text-white">
          <Sparkles className="w-4 h-4 text-amber-300" />
          <span>Реальные экраны платформы · От идеи до прибыли</span>
        </div>
        <h2 className="font-display font-black text-3xl sm:text-5xl tracking-tight text-white">
          Три шага внутри ProjectsFlow
        </h2>
        <p className="text-sm sm:text-base text-white/80 leading-relaxed">
          Ты остаёшься на уровне идей и решений. Доска задач, живой стрим работы AI, предрелизные проверки и финансовая аналитика собраны в одном окне.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[460px_1fr] gap-10 items-center">
        {/* Левая колонка: Интерактивные карточки шагов */}
        <div className="flex flex-col gap-3.5">
          {WALKTHROUGH_STEPS.map((item, idx) => {
            const isSelected = activeStep === idx;
            return (
              <motion.button
                key={item.step}
                whileHover={{ x: 6 }}
                type="button"
                onClick={() => setActiveStep(idx)}
                className={`flex items-start gap-4 p-5 rounded-[24px] text-left border transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-white text-[#120b1d] border-white shadow-2xl'
                    : 'bg-white/8 text-white border-white/18 hover:bg-white/14 backdrop-blur-xl'
                }`}
              >
                <div
                  className={`w-10 h-10 rounded-[12px] font-mono font-bold text-sm grid place-items-center shrink-0 ${
                    isSelected ? 'bg-[#120b1d] text-white' : 'bg-white/15 text-white'
                  }`}
                >
                  {item.step}
                </div>
                <div>
                  <div className="font-bold text-base mb-1">{item.title}</div>
                  <p
                    className={`text-xs sm:text-sm leading-relaxed ${
                      isSelected ? 'text-[#120b1d]/80' : 'text-white/80'
                    }`}
                  >
                    {item.desc}
                  </p>
                </div>
              </motion.button>
            );
          })}

          {/* Демо-виджет копирования готовой постановки задачи */}
          <div className="mt-2 p-5 rounded-[24px] bg-[#100b1d]/70 border border-white/25 backdrop-blur-xl">
            <div className="flex items-center justify-between text-xs text-white/75 mb-2.5">
              <span>Пример постановки задачи для AI:</span>
              <span className="font-bold text-[#94f23c]">
                {copied ? '✓ Скопировано в буфер!' : 'Попробуй на старте'}
              </span>
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <code className="font-mono font-semibold text-xs sm:text-sm text-white/95 leading-snug">
                «{currentPrompt}»
              </code>
              <button
                type="button"
                onClick={handleCopyDemo}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-full bg-white text-[#130b1d] text-xs font-bold hover:scale-105 transition cursor-pointer shrink-0"
              >
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Скопировано' : 'Скопировать'}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Правая колонка: 3D-веер из трёх титановых капсул с экранами ProjectsFlow */}
        <div
          className="relative h-[540px] sm:h-[600px] flex items-center justify-center overflow-hidden sm:overflow-visible"
          style={{ perspective: '1400px' }}
        >
          {WALKTHROUGH_STEPS.map((item, idx) => {
            const offset = idx - activeStep;
            const isCenter = offset === 0;
            const translateX = offset * 175;
            const translateZ = isCenter ? 60 : -70;
            const rotateY = offset * -22;
            const scale = isCenter ? 1 : 0.86;

            return (
              <motion.div
                key={item.step}
                onClick={() => setActiveStep(idx)}
                animate={{
                  x: translateX,
                  z: translateZ,
                  rotateY,
                  scale,
                  opacity: isCenter ? 1 : 0.72,
                }}
                transition={{ type: 'spring', stiffness: 240, damping: 26 }}
                style={{ zIndex: isCenter ? 20 : 10 - Math.abs(offset) }}
                className="absolute w-[305px] sm:w-[370px] cursor-pointer select-none"
              >
                <div className="relative rounded-[34px] p-3 bg-gradient-to-b from-[#3d404a] to-[#15171e] border-2 border-white/40 shadow-[0_34px_75px_rgba(0,0,0,0.6)]">
                  <div className="absolute top-4 left-1/2 -translate-x-1/2 w-16 h-3.5 rounded-full bg-black z-10" />
                  <div className="w-full h-[400px] sm:h-[430px] rounded-[24px] bg-[#0a0d14] overflow-hidden flex flex-col justify-between p-3 pt-7 border border-white/10">
                    {/* Верхний бейдж статуса внутри 3D-экрана */}
                    <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-[12px] bg-white/8 border border-white/12 text-[11px]">
                      <span className="font-bold text-white truncate">ProjectsFlow · {item.step}</span>
                      <span className="px-2 py-0.5 rounded-full bg-[#94f23c]/20 text-[#b8ff66] font-semibold">
                        {item.badge}
                      </span>
                    </div>

                    {/* Скриншот реального интерфейса с единым контейнером */}
                    <div className="my-auto py-2 flex items-center justify-center overflow-hidden rounded-[14px]">
                      <img
                        src={item.shotUrl}
                        alt={item.caption}
                        className="max-w-full max-h-[210px] w-auto h-auto object-contain rounded-[12px] border border-white/15 shadow-lg"
                        loading="lazy"
                      />
                    </div>

                    {/* Живая телеметрия конкретного шага в нижней части экрана */}
                    {item.screenType === 'board' && (
                      <div className="p-3 rounded-[16px] bg-white/6 border border-white/12 text-xs text-white/90 space-y-1.5">
                        <div className="flex items-center justify-between font-semibold">
                          <span>Сайт кофейни · 12 задач</span>
                          <span className="text-amber-300">На утверждении: 1</span>
                        </div>
                        <div className="text-[11px] text-white/70">
                          Кликни по задаче — её заберёт AI-воркер и пришлёт готовый коммит.
                        </div>
                      </div>
                    )}

                    {item.screenType === 'live' && (
                      <div className="p-3 rounded-[16px] bg-white/6 border border-white/12 text-xs text-white/90 space-y-2">
                        <div className="flex items-center justify-between font-semibold">
                          <span>✓ Сборка и типы · 4/4 Pass</span>
                          <span className="font-mono text-[#94f23c]">84% · 3,20 ₽</span>
                        </div>
                        <div className="w-full h-2 rounded-full bg-white/15 overflow-hidden">
                          <div className="w-[84%] h-full bg-[#94f23c] rounded-full" />
                        </div>
                      </div>
                    )}

                    {item.screenType === 'finance' && (
                      <div className="grid grid-cols-3 gap-1.5 text-center">
                        <div className="p-2 rounded-[12px] bg-white/6 border border-white/12">
                          <span className="block text-[10px] text-white/60">Доход</span>
                          <strong className="text-xs text-white">+214k ₽</strong>
                        </div>
                        <div className="p-2 rounded-[12px] bg-white/6 border border-white/12">
                          <span className="block text-[10px] text-white/60">Расходы</span>
                          <strong className="text-xs text-white/85">−85,6k ₽</strong>
                        </div>
                        <div className="p-2 rounded-[12px] bg-[#94f23c]/20 border border-[#94f23c]/40">
                          <span className="block text-[10px] text-[#caff85]">Прибыль</span>
                          <strong className="text-xs text-[#94f23c]">+128,4k ₽</strong>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                <div className="text-center mt-3">
                  <span className="inline-block px-3.5 py-1 rounded-full bg-black/55 border border-white/25 text-xs font-bold text-white">
                    {item.caption}
                  </span>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
};
