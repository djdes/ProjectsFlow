import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  PILLARS_DATA,
  EXTRA_SPLIT_PILLARS,
  type ExtendedPillarCode,
  type PillarCode,
} from '@/data/showcaseData';

interface SplitCapabilitiesSectionProps {
  onSyncHeroPillar: (code: PillarCode) => void;
  appBase?: string;
}

const ALL_SIX_CODES: ExtendedPillarCode[] = ['AI', 'CL', 'FN', 'DP', 'LV', 'TM'];

export const SplitCapabilitiesSection: React.FC<SplitCapabilitiesSectionProps> = ({
  onSyncHeroPillar,
  appBase = '',
}) => {
  const [selectedCode, setSelectedCode] = useState<ExtendedPillarCode>('AI');

  const currentData =
    selectedCode === 'LV' || selectedCode === 'TM'
      ? EXTRA_SPLIT_PILLARS[selectedCode]
      : PILLARS_DATA[selectedCode];

  const handleSelect = (code: ExtendedPillarCode) => {
    setSelectedCode(code);
    if (code === 'AI' || code === 'CL' || code === 'FN' || code === 'DP') {
      onSyncHeroPillar(code);
    }
  };

  const stepSlide = (dir: -1 | 1) => {
    const idx = ALL_SIX_CODES.indexOf(selectedCode);
    const next = ALL_SIX_CODES[(idx + dir + ALL_SIX_CODES.length) % ALL_SIX_CODES.length]!;
    handleSelect(next);
  };

  return (
    <section
      id="features"
      className="scroll-mt-24 relative max-w-[1440px] mx-auto my-16 px-4 sm:px-9"
    >
      <div className="relative min-h-[760px] rounded-[36px] overflow-hidden border border-white/25 shadow-[0_38px_90px_rgba(0,0,0,0.5)] flex items-center">
        {/* Атмосферный кибер-фон с перспективой и свечением */}
        <div className="absolute inset-0 z-0 bg-[#061411]">
          <div
            className="absolute inset-0 opacity-90 transition-all duration-700"
            style={{
              background:
                'radial-gradient(circle at 72% 35%, rgba(29, 185, 84, 0.36) 0%, rgba(11, 56, 44, 0.65) 45%, rgba(6, 18, 28, 0.96) 95%)',
            }}
          />
          {/* Световая сетка горизонта */}
          <div
            className="absolute inset-0 opacity-25"
            style={{
              backgroundImage:
                'linear-gradient(to right, rgba(163,247,59,0.18) 1px, transparent 1px), linear-gradient(to bottom, rgba(163,247,59,0.18) 1px, transparent 1px)',
              backgroundSize: '56px 56px',
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-r from-[#071a14]/80 via-[#0b261e]/55 to-[#081220]/75" />
        </div>

        {/* Левая матовая стеклянная створка 46% ширины (референс AFRICAN FOREST) */}
        <div
          className="hidden lg:block absolute inset-y-0 left-0 w-[46%] bg-[#0d1c18]/65 backdrop-blur-2xl border-r border-white/25 z-10"
          aria-hidden="true"
        >
          {/* Декоративные 3D-лепестки на границе раздела как в AFRICAN FOREST */}
          <div className="absolute top-10 -right-7 flex flex-col gap-2.5">
            <span className="w-14 h-7 rounded-tl-3xl rounded-br-3xl bg-gradient-to-br from-[#a3f73b] to-[#1db954] shadow-xl -rotate-12 block" />
            <span className="w-10 h-5 rounded-tl-2xl rounded-br-2xl bg-gradient-to-br from-[#a3f73b] to-[#1db954] shadow-lg rotate-12 -translate-x-3 block opacity-85" />
          </div>
        </div>

        {/* Основной контент поверх границы матового стекла */}
        <div className="relative z-20 w-full px-6 sm:px-14 py-14">
          <div className="text-xs sm:text-sm font-extrabold tracking-[0.18em] italic text-[#a3f73b] mb-3">
            6 ОПОР ПЛАТФОРМЫ PROJECTSFLOW · ДЛЯ ТЕХ, КТО СТРОИТ С AI
          </div>

          {/* Двухслойный гигантский заголовок на стыке матового стекла (AFRICAN FOREST эффект) */}
          <div className="mb-8">
            <AnimatePresence mode="wait">
              <motion.div
                key={selectedCode}
                initial={{ opacity: 0, y: 22 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -22 }}
                transition={{ type: 'spring', stiffness: 250, damping: 24 }}
              >
                <h2 className="font-display font-black uppercase text-4xl sm:text-7xl xl:text-[102px] leading-[0.94] tracking-tight">
                  <span className="knockout-frosted-text">{currentData.splitLeft}</span>
                  <span className="text-white drop-shadow-[0_18px_44px_rgba(0,0,0,0.5)]">
                    {currentData.splitRight}
                  </span>
                </h2>
                <div className="font-display font-black text-xl sm:text-3xl xl:text-4xl text-white/30 tracking-tight mt-1.5">
                  {currentData.splitSubword}
                </div>
              </motion.div>
            </AnimatePresence>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[42%_1fr] gap-10 lg:gap-14 items-start">
            {/* Левая колонка внутри матового стекла */}
            <div className="flex flex-col gap-5">
              <p className="text-sm sm:text-[15.5px] leading-relaxed text-white/85">
                {currentData.story}
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                {currentData.metrics.map((m) => (
                  <div
                    key={m.label}
                    className="p-3 rounded-[18px] bg-white/10 border border-white/20 backdrop-blur-md"
                  >
                    <span className="block text-[11px] text-white/65 mb-1">{m.label}</span>
                    <strong className="text-xs sm:text-sm font-bold text-white">{m.value}</strong>
                  </div>
                ))}
              </div>

              <div className="pt-1 flex flex-wrap gap-3">
                <a
                  href={`${appBase}/register`}
                  data-auth-anon
                  className="inline-flex items-center gap-2.5 px-6 py-3.5 rounded-full bg-[#a3f73b] text-[#09190e] font-extrabold text-xs sm:text-sm tracking-wide shadow-lg hover:scale-105 transition"
                >
                  <span>ЗАПУСТИТЬ СВОЙ ПРОЕКТ БЕСПЛАТНО</span>
                  <ArrowRight className="w-4 h-4" />
                </a>
                <a
                  href={`${appBase}/`}
                  data-auth-authed
                  className="inline-flex items-center gap-2.5 px-6 py-3.5 rounded-full bg-[#a3f73b] text-[#09190e] font-extrabold text-xs sm:text-sm tracking-wide shadow-lg hover:scale-105 transition"
                >
                  <span>ОТКРЫТЬ ПРИЛОЖЕНИЕ</span>
                  <ArrowRight className="w-4 h-4" />
                </a>
              </div>
            </div>

            {/* Правая колонка: Интерактивные стеклянные карточки 6 возможностей */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pr-0 lg:pr-10">
              {[
                {
                  code: 'AI' as const,
                  icon: '⚡',
                  title: 'Автопилот задач (AI)',
                  badge: '24/7 Сама',
                  sub: 'Опиши идею словами — платформа доведёт до готового',
                },
                {
                  code: 'CL' as const,
                  icon: '🧠',
                  title: 'Claude онлайн (CL)',
                  badge: 'Без ключей',
                  sub: 'Встроенная подписка без VPN или подключение своей',
                },
                {
                  code: 'FN' as const,
                  icon: '💎',
                  title: 'Деньги и маржа (FN)',
                  badge: 'В рублях',
                  sub: 'Доходы, расходы на AI и прибыль с одного взгляда',
                },
                {
                  code: 'DP' as const,
                  icon: '🛡️',
                  title: 'Автопроверки (DP)',
                  badge: '4 из 4 Pass',
                  sub: 'Сборка, типы, секреты и мобильный адаптив до выкатки',
                },
                {
                  code: 'LV' as const,
                  icon: '🔴',
                  title: 'Живой стрим (LIVE)',
                  badge: 'Реалтайм',
                  sub: 'Видно каждый шаг AI-воркера и точную цену запуска',
                },
                {
                  code: 'TM' as const,
                  icon: '✈️',
                  title: 'Команда и Telegram',
                  badge: 'Всё рядом',
                  sub: 'Роли, заметки, доступы, алерты и мониторинг серверов',
                },
              ].map((item) => {
                const isSelected = selectedCode === item.code;
                return (
                  <motion.button
                    key={item.code}
                    whileHover={{ y: -3 }}
                    type="button"
                    onClick={() => handleSelect(item.code)}
                    className={`p-4 sm:p-4.5 rounded-[24px] text-left border transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-white text-[#0e1722] border-white shadow-2xl'
                        : 'bg-[#0c1420]/65 text-white border-white/20 hover:bg-[#0c1420]/85 backdrop-blur-xl'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-2xl">{item.icon}</span>
                      <span
                        className={`px-2.5 py-1 rounded-full text-[11px] font-bold ${
                          isSelected
                            ? 'bg-[#0e1722] text-white'
                            : 'bg-[#a3f73b]/20 text-[#b8ff5c]'
                        }`}
                      >
                        {item.badge}
                      </span>
                    </div>
                    <div className="font-bold text-base">{item.title}</div>
                    <div
                      className={`text-xs mt-0.5 ${
                        isSelected ? 'text-[#0e1722]/75' : 'text-white/75'
                      }`}
                    >
                      {item.sub}
                    </div>
                  </motion.button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Вертикальные ромбы справа как на референсе AFRICAN FOREST */}
        <div className="hidden sm:flex flex-col items-center gap-3.5 absolute right-6 top-1/2 -translate-y-1/2 z-30">
          <span className="w-0.5 h-9 bg-white/45" />
          {ALL_SIX_CODES.map((code) => {
            const active = selectedCode === code;
            return (
              <button
                key={code}
                type="button"
                onClick={() => handleSelect(code)}
                aria-label={`Выбрать модуль ${code}`}
                className={`w-3 h-3 rotate-45 border-2 border-white transition cursor-pointer ${
                  active ? 'bg-white scale-125' : 'bg-transparent hover:bg-white/40'
                }`}
              />
            );
          })}
          <span className="w-0.5 h-9 bg-white/45" />
        </div>

        {/* Квадратные кнопки стрелок в правом нижнем углу (AFRICAN FOREST) */}
        <div className="absolute right-8 bottom-6 z-30 flex gap-2.5">
          <button
            type="button"
            onClick={() => stepSlide(-1)}
            className="w-11 h-11 rounded-[10px] bg-white/85 text-[#0e1916] hover:bg-white grid place-items-center font-bold shadow-lg transition cursor-pointer"
            aria-label="Предыдущая возможность"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <button
            type="button"
            onClick={() => stepSlide(1)}
            className="w-11 h-11 rounded-[10px] bg-[#0e1916]/85 text-white border border-white/30 hover:bg-[#0e1916] grid place-items-center font-bold shadow-lg transition cursor-pointer"
            aria-label="Следующая возможность"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </div>
    </section>
  );
};
