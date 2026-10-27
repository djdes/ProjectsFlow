import React, { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { ArrowUpRight, Play, Check, ShieldCheck, Sparkles } from 'lucide-react';
import { PLANS, formatRub } from '@/data/pricing';
import KanbanBoard from '@/components/KanbanBoard';

type ProjectTypeKey = 'saas' | 'tgbot' | 'landing' | 'internal';
type ModuleKey = 'autopilot' | 'claude' | 'finance' | 'checks';

const PROJECT_TYPES: {
  key: ProjectTypeKey;
  label: string;
  icon: string;
  tasksPerMonth: number;
  studioSavingsRub: number;
}[] = [
  { key: 'saas', label: 'Веб-сервис / SaaS', icon: '🚀', tasksPerMonth: 45, studioSavingsRub: 120000 },
  { key: 'tgbot', label: 'Telegram-бот + App', icon: '🤖', tasksPerMonth: 35, studioSavingsRub: 75000 },
  { key: 'landing', label: 'Лендинг и запуск', icon: '⚡', tasksPerMonth: 25, studioSavingsRub: 45000 },
  { key: 'internal', label: 'CRM / Внутренний софт', icon: '📊', tasksPerMonth: 50, studioSavingsRub: 140000 },
];

const MODULE_META: { key: ModuleKey; name: string; icon: string; tag: string }[] = [
  { key: 'autopilot', name: 'Автопилот задач AI', icon: '⚙️', tag: 'Сама' },
  { key: 'claude', name: 'Claude онлайн внутри', icon: '🧠', tag: 'Без VPN' },
  { key: 'finance', name: 'Финансы и маржа в ₽', icon: '💎', tag: 'Учёт ₽' },
  { key: 'checks', name: 'Автопроверки 4/4', icon: '🛡️', tag: 'CI Pass' },
];

interface GrowCalculatorSectionProps {
  appBase?: string;
}

export const GrowCalculatorSection: React.FC<GrowCalculatorSectionProps> = ({ appBase = '' }) => {
  const [projectType, setProjectType] = useState<ProjectTypeKey>('saas');
  const [selectedModules, setSelectedModules] = useState<ModuleKey[]>([
    'autopilot',
    'claude',
    'finance',
    'checks',
  ]);
  const [selectedPlanId, setSelectedPlanId] = useState<'free' | 'prime' | 'vip'>('prime');

  const toggleModule = (key: ModuleKey) => {
    setSelectedModules((prev) => {
      if (prev.includes(key)) {
        return prev.length > 1 ? prev.filter((k) => k !== key) : prev;
      }
      return [...prev, key];
    });
  };

  const calcResult = useMemo(() => {
    const pt = PROJECT_TYPES.find((p) => p.key === projectType) ?? PROJECT_TYPES[0]!;
    const plan = PLANS.find((p) => p.id === selectedPlanId) ?? PLANS[1]!;
    const moduleMultiplier = 0.75 + selectedModules.length * 0.12;
    const estTasks = Math.round(pt.tasksPerMonth * (selectedPlanId === 'vip' ? 1.8 : 1));
    const savingsRub = Math.max(0, Math.round(pt.studioSavingsRub * moduleMultiplier) - plan.priceRub);

    return {
      pt,
      plan,
      estTasks,
      savingsRub,
    };
  }, [projectType, selectedModules, selectedPlanId]);

  return (
    <>
      {/* Экран 3А: Живая интерактивная Канбан-доска внутри витрины */}
      <section id="live-board" className="scroll-mt-24 max-w-[1440px] mx-auto my-20 px-4 sm:px-9">
        <div className="rounded-[36px] p-5 sm:p-10 bg-[#100b1d]/75 border border-white/22 backdrop-blur-2xl shadow-[0_34px_85px_rgba(0,0,0,0.5)]">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
            <div>
              <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-white/12 border border-white/25 text-xs font-bold text-amber-300 mb-2">
                <Sparkles className="w-3.5 h-3.5" />
                <span>ИНТЕРАКТИВНОЕ ДЕМО ПРЯМО В БРАУЗЕРЕ</span>
              </div>
              <h2 className="font-display font-black text-2xl sm:text-4xl text-white tracking-tight">
                Живая доска «Входящие» — нажми на задачу, её возьмёт AI
              </h2>
            </div>
            <p className="text-xs sm:text-sm text-white/80 max-w-md">
              Нажми на любую карточку проекта — AI начнёт выполнение и пришлёт готовый результат в колонку «На утверждении». Или перетащи карточку в «Сейчас».
            </p>
          </div>

          <div className="rounded-[20px] overflow-hidden shadow-2xl">
            <KanbanBoard />
          </div>
        </div>
      </section>

      {/* Экран 3Б: 3D-Конструктор проекта и витрина тарифов (GROWTREE) */}
      <section id="pricing" className="scroll-mt-24 max-w-[1440px] mx-auto my-20 px-4 sm:px-9">
        <div
          id="grow-calculator"
          className="scroll-mt-24 relative rounded-[36px] p-6 sm:p-12 border border-white/25 shadow-[0_38px_85px_rgba(0,0,0,0.48)] overflow-hidden"
          style={{
            background:
              'radial-gradient(circle at 50% 22%, rgba(148, 242, 60, 0.25) 0%, rgba(11, 35, 28, 0.94) 68%, #071410 100%)',
          }}
        >
          {/* Верхняя строка как в референсе GROWTREE */}
          <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
            <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-[#94f23c]/20 border border-[#94f23c]/45 text-[#b8ff66] text-xs font-bold">
              🌱 3D-КОНСТРУКТОР ПРОЕКТА И ТАРИФОВ
            </span>
            <span className="text-xs sm:text-sm text-white/80">
              Выберите формат продукта, модули и тариф — первый час Прайма бесплатно и без карты
            </span>
          </div>

          {/* Центральная 3D-композиция поверх гигантского слова ПРОДУКТ (эффект GROWTREE) */}
          <div className="relative min-h-[250px] flex items-center justify-center my-4 select-none">
            <div
              className="absolute font-display font-black text-[54px] sm:text-[112px] xl:text-[146px] tracking-[-0.04em] text-white/90 drop-shadow-[0_22px_50px_rgba(0,0,0,0.45)] pointer-events-none z-0"
              aria-hidden="true"
            >
              ПРОДУКТ
            </div>

            {/* 3D-ядро расчёта, перекрывающее гигантские буквы спереди */}
            <motion.div
              key={`${projectType}-${selectedPlanId}-${selectedModules.join(',')}`}
              initial={{ scale: 0.94, y: 10 }}
              animate={{ scale: 1, y: 0 }}
              transition={{ type: 'spring', stiffness: 280, damping: 22 }}
              className="relative z-10 px-8 py-6 rounded-[28px] bg-[#0b1f18]/85 border-2 border-[#94f23c]/60 backdrop-blur-2xl shadow-[0_28px_65px_rgba(0,0,0,0.55)] text-center max-w-md"
            >
              <span className="text-xs font-bold text-[#b8ff66] block mb-1">
                {calcResult.pt.icon} {calcResult.pt.label} · Тариф «{calcResult.plan.name}»
              </span>
              <div className="font-display font-black text-4xl sm:text-5xl text-white tracking-tight">
                {formatRub(calcResult.plan.priceRub)} ₽
                <span className="text-base sm:text-lg font-sans font-semibold text-white/75 ml-2">
                  {calcResult.plan.priceNote}
                </span>
              </div>
              <div className="text-xs sm:text-sm font-semibold text-white/85 mt-1.5">
                До ~{calcResult.estTasks} готовых AI-задач в месяц · {selectedModules.length} из 4 модулей
              </div>
              <div className="inline-block mt-3 px-3.5 py-1 rounded-full bg-[#94f23c]/22 text-[#caff85] text-xs font-bold">
                Экономия ~{calcResult.savingsRub.toLocaleString('ru-RU')} ₽/мес против найма и ручной рутины
              </div>
            </motion.div>
          </div>

          {/* 3 блока интерактивных переключателей */}
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.35fr_1fr] gap-5 my-8 relative z-10">
            {/* 1. Выбор типа продукта */}
            <div className="p-5 rounded-[24px] bg-white/6 border border-white/15 backdrop-blur-md">
              <div className="text-xs font-bold text-white/80 mb-3">1. Что вы запускаете</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {PROJECT_TYPES.map((pt) => {
                  const active = projectType === pt.key;
                  return (
                    <button
                      key={pt.key}
                      type="button"
                      onClick={() => setProjectType(pt.key)}
                      className={`py-2.5 px-3 rounded-[14px] text-xs font-bold border text-left transition cursor-pointer ${
                        active
                          ? 'bg-[#94f23c] text-[#08190d] border-[#94f23c] shadow-lg'
                          : 'bg-white/8 text-white border-white/15 hover:bg-white/15'
                      }`}
                    >
                      {pt.icon} {pt.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 2. Выбор AI-модулей */}
            <div className="p-5 rounded-[24px] bg-white/6 border border-white/15 backdrop-blur-md">
              <div className="text-xs font-bold text-white/80 mb-3">
                2. Какие модули платформы задействуем
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {MODULE_META.map((mod) => {
                  const isSelected = selectedModules.includes(mod.key);
                  return (
                    <button
                      key={mod.key}
                      type="button"
                      onClick={() => toggleModule(mod.key)}
                      className={`flex items-center justify-between gap-2 p-3 rounded-[16px] border text-left transition cursor-pointer ${
                        isSelected
                          ? 'bg-[#94f23c]/22 border-[#94f23c] text-white shadow-md'
                          : 'bg-white/6 border-white/15 text-white/80 hover:bg-white/12'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-base">{mod.icon}</span>
                        <span className="text-xs font-bold truncate">{mod.name}</span>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="font-mono text-[11px] text-[#caff85]">{mod.tag}</span>
                        {isSelected && <Check className="w-3.5 h-3.5 text-[#94f23c]" />}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 3. Выбор тарифа */}
            <div className="p-5 rounded-[24px] bg-white/6 border border-white/15 backdrop-blur-md">
              <div className="text-xs font-bold text-white/80 mb-3">3. Выберите тариф старта</div>
              <div className="grid grid-cols-1 gap-2">
                {PLANS.map((plan) => {
                  const active = selectedPlanId === plan.id;
                  return (
                    <button
                      key={plan.id}
                      type="button"
                      onClick={() => setSelectedPlanId(plan.id)}
                      className={`py-2.5 px-3.5 rounded-[14px] text-xs font-bold border flex items-center justify-between transition cursor-pointer ${
                        active
                          ? 'bg-[#94f23c] text-[#08190d] border-[#94f23c] shadow-lg'
                          : 'bg-white/8 text-white border-white/15 hover:bg-white/15'
                      }`}
                    >
                      <span>
                        {plan.name} {plan.badge ? `· ${plan.badge}` : ''}
                      </span>
                      <span className="font-mono">
                        {formatRub(plan.priceRub)} ₽ ({plan.priceNote})
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Сравнительные карточки 3 тарифов (Бесплатный / Прайм / VIP) */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 my-8 relative z-10">
            {PLANS.map((plan) => {
              const isSelected = selectedPlanId === plan.id;
              return (
                <article
                  key={plan.id}
                  onClick={() => setSelectedPlanId(plan.id)}
                  className={`p-6 rounded-[28px] border transition-all cursor-pointer flex flex-col justify-between ${
                    isSelected
                      ? 'bg-[#0e291f]/90 border-2 border-[#94f23c] shadow-[0_24px_50px_rgba(0,0,0,0.45)]'
                      : 'bg-white/6 border-white/18 hover:bg-white/10 backdrop-blur-xl'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <h3 className="font-display font-black text-xl text-white">{plan.name}</h3>
                      {plan.badge && (
                        <span className="px-3 py-1 rounded-full bg-[#94f23c] text-[#08190d] text-[11px] font-extrabold">
                          {plan.badge}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-white/75 mb-4">{plan.tagline}</p>

                    <div className="flex items-baseline gap-2 mb-5">
                      <span className="font-display font-black text-3xl sm:text-4xl text-white">
                        {formatRub(plan.priceRub)} ₽
                      </span>
                      <span className="text-xs text-white/70">{plan.priceNote}</span>
                    </div>

                    <ul className="flex flex-col gap-2.5 mb-6">
                      {plan.features.map((feat) => (
                        <li key={feat} className="flex items-start gap-2.5 text-xs sm:text-sm text-white/90">
                          <Check className="w-4 h-4 text-[#94f23c] shrink-0 mt-0.5" />
                          <span>{feat}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="flex flex-col gap-2">
                    <a
                      href={`${appBase}${plan.href}`}
                      data-auth-anon
                      className={`w-full py-3 px-4 rounded-full font-bold text-xs sm:text-sm text-center transition ${
                        plan.highlight || isSelected
                          ? 'bg-[#94f23c] text-[#08190d] shadow-lg hover:scale-102'
                          : 'bg-white/15 text-white hover:bg-white/25'
                      }`}
                    >
                      {plan.cta}
                    </a>
                    <a
                      href={`${appBase}/`}
                      data-auth-authed
                      className="w-full py-3 px-4 rounded-full font-bold text-xs sm:text-sm text-center bg-[#94f23c] text-[#08190d] shadow-lg"
                    >
                      Открыть приложение
                    </a>
                    {plan.trialCta && (
                      <a
                        href={`${appBase}${plan.href}`}
                        data-auth-anon
                        className="w-full py-2.5 px-4 rounded-full font-semibold text-xs text-center bg-white/10 text-white/90 border border-white/20 hover:bg-white/18 transition"
                      >
                        {plan.trialCta}
                      </a>
                    )}
                  </div>
                </article>
              );
            })}
          </div>

          {/* Нижняя панель с лаймовой пилюлей и плавающим превью справа (в точности как в GROWTREE) */}
          <div className="flex flex-wrap items-center justify-between gap-5 relative z-10 pt-2">
            <div className="flex flex-wrap items-center gap-4">
              <motion.a
                whileHover={{ scale: 1.03, y: -2 }}
                whileTap={{ scale: 0.98 }}
                href={`${appBase}${calcResult.plan.href}`}
                data-auth-anon
                className="inline-flex items-center gap-3 px-8 py-4 rounded-full bg-[#94f23c] text-[#08190d] font-extrabold text-sm sm:text-base shadow-[0_16px_38px_rgba(148,242,60,0.35)]"
              >
                <span>
                  {calcResult.plan.cta} ({formatRub(calcResult.plan.priceRub)} ₽)
                </span>
                <ArrowUpRight className="w-5 h-5" />
              </motion.a>
              <span className="inline-flex items-center gap-2 text-xs sm:text-sm text-white/85">
                <ShieldCheck className="w-4 h-4 text-[#94f23c] shrink-0" />
                <span>Гарантия возврата: не подошло — вернём деньги без вопросов</span>
              </span>
            </div>

            <a
              href="#how"
              className="flex items-center gap-3.5 p-2.5 pr-5 rounded-[18px] bg-[#0a1c15]/85 border border-white/25 hover:-translate-y-1 transition relative text-white"
            >
              <div className="relative w-24 h-14 rounded-[12px] overflow-hidden shrink-0 bg-[#122620]">
                <img
                  src="/shots/app-board.png"
                  alt="Превью интерфейса ProjectsFlow"
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
                <span className="absolute inset-0 m-auto w-8 h-8 rounded-full bg-[#94f23c] text-[#08190d] grid place-items-center shadow-lg">
                  <Play className="w-3.5 h-3.5 fill-current" />
                </span>
              </div>
              <div>
                <strong className="block text-xs sm:text-sm font-bold text-white">
                  Как устроен процесс внутри
                </strong>
                <span className="text-xs text-white/75">3D-веер реальных экранов продукта</span>
              </div>
            </a>
          </div>
        </div>
      </section>
    </>
  );
};
