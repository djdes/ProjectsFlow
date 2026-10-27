import React, { useState, useEffect } from 'react';
import Lenis from 'lenis';
import { ArrowUpRight, Layers, Menu, X } from 'lucide-react';
import '@fontsource-variable/unbounded';
import '@fontsource-variable/golos-text';
import '@fontsource-variable/jetbrains-mono';
import { PILLARS_DATA, type PillarCode } from '@/data/showcaseData';
import { AuroraCanvas } from './AuroraCanvas';
import { HeroShowcase } from './HeroShowcase';
import { SplitCapabilitiesSection } from './SplitCapabilitiesSection';
import { GrowCalculatorSection } from './GrowCalculatorSection';
import { ProductWalkthroughSection } from './ProductWalkthroughSection';
import { CatalogFaqSection, type BlogPostPreview } from './CatalogFaqSection';

interface ShowcaseAppProps {
  posts?: readonly BlogPostPreview[];
  appBase?: string;
}

const NAV_ITEMS = [
  { href: '#showcase', label: '3D Витрина' },
  { href: '#features', label: '6 Опор' },
  { href: '#live-board', label: 'Живая доска' },
  { href: '#pricing', label: 'Тарифы 3D' },
  { href: '#how', label: 'Экраны' },
  { href: '#faq', label: 'Вопросы' },
  { href: '/blog', label: 'Блог' },
] as const;

export const ShowcaseApp: React.FC<ShowcaseAppProps> = ({ posts = [], appBase = '' }) => {
  const [activePillar, setActivePillar] = useState<PillarCode>('AI');
  const [scrolled, setScrolled] = useState<boolean>(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);

  const pillarConfig = PILLARS_DATA[activePillar];
  const currentYear = new Date().getFullYear();

  useEffect(() => {
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let lenis: Lenis | null = null;
    let rafId = 0;

    if (!prefersReduced) {
      lenis = new Lenis({
        duration: 1.12,
        smoothWheel: true,
      });
      const raf = (time: number) => {
        lenis?.raf(time);
        rafId = requestAnimationFrame(raf);
      };
      rafId = requestAnimationFrame(raf);
    }

    const onScroll = () => {
      setScrolled(window.scrollY > 24);
    };
    window.addEventListener('scroll', onScroll, { passive: true });

    return () => {
      cancelAnimationFrame(rafId);
      lenis?.destroy();
      window.removeEventListener('scroll', onScroll);
    };
  }, []);

  return (
    <div
      className="min-h-screen text-white transition-[background] duration-700 relative font-sans selection:bg-white selection:text-black overflow-x-clip"
      style={{ backgroundImage: pillarConfig.stageBgGradient }}
    >
      {/* Анимированная световая волна в стиле референса Mindly */}
      <AuroraCanvas colors={pillarConfig.auroraColors} />

      {/* Плавающая стеклянная шапка (Mindly + Planet BOLD) */}
      <header
        className={`fixed top-0 inset-x-0 z-50 transition-all duration-300 ${
          scrolled
            ? 'py-3 px-4 sm:px-9 bg-[#0e0918]/80 backdrop-blur-2xl border-b border-white/15'
            : 'py-5 px-4 sm:px-9'
        }`}
      >
        <div className="max-w-[1440px] mx-auto flex items-center justify-between gap-4">
          <a
            href="#showcase"
            className="inline-flex items-center gap-2.5 font-display font-black text-base sm:text-lg tracking-tight text-white"
          >
            <span className="w-9 h-9 rounded-[12px] bg-white/18 border border-white/30 grid place-items-center shadow-lg">
              <Layers className="w-5 h-5 text-white" />
            </span>
            <span>ProjectsFlow</span>
          </a>

          <nav
            aria-label="Основная навигация"
            className="hidden lg:flex items-center gap-1 p-1.5 rounded-full bg-white/12 border border-white/20 backdrop-blur-xl"
          >
            {NAV_ITEMS.map((item, idx) => (
              <a
                key={item.href}
                href={item.href}
                className={`px-3.5 py-1.5 rounded-full text-xs sm:text-sm font-semibold transition ${
                  idx === 0
                    ? 'bg-white text-[#120b1d] shadow'
                    : 'text-white/85 hover:text-white hover:bg-white/15'
                }`}
              >
                {item.label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-2.5">
            <a
              href={`${appBase}/login`}
              data-auth-anon
              className="hidden sm:inline-flex items-center px-4 py-2 rounded-full bg-white/12 border border-white/25 text-white font-semibold text-xs sm:text-sm hover:bg-white/20 transition"
            >
              Войти
            </a>
            <a
              href={`${appBase}/register`}
              data-auth-anon
              className="inline-flex items-center gap-1.5 px-4 sm:px-5 py-2.5 rounded-full bg-white text-[#120b1d] font-bold text-xs sm:text-sm shadow-xl hover:scale-105 transition"
            >
              <span>Начать бесплатно</span>
              <ArrowUpRight className="w-4 h-4" />
            </a>
            <a
              href={`${appBase}/`}
              data-auth-authed
              className="inline-flex items-center gap-1.5 px-4 sm:px-5 py-2.5 rounded-full bg-white text-[#120b1d] font-bold text-xs sm:text-sm shadow-xl hover:scale-105 transition"
            >
              <span>Открыть приложение</span>
              <ArrowUpRight className="w-4 h-4" />
            </a>

            <button
              type="button"
              onClick={() => setMobileMenuOpen((v) => !v)}
              aria-label="Меню навигации"
              aria-expanded={mobileMenuOpen}
              className="lg:hidden w-10 h-10 rounded-full bg-white/14 border border-white/25 grid place-items-center text-white cursor-pointer"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Выпадающее мобильное меню */}
        {mobileMenuOpen && (
          <div className="lg:hidden mt-3 p-4 rounded-[24px] bg-[#100b1d]/95 border border-white/25 backdrop-blur-2xl flex flex-col gap-2 shadow-2xl">
            {NAV_ITEMS.map((item) => (
              <a
                key={item.href}
                href={item.href}
                onClick={() => setMobileMenuOpen(false)}
                className="px-4 py-2.5 rounded-[14px] text-sm font-semibold text-white hover:bg-white/12 transition"
              >
                {item.label}
              </a>
            ))}
            <div className="pt-2 mt-1 border-t border-white/15 flex flex-col gap-2">
              <a
                href={`${appBase}/register`}
                data-auth-anon
                className="w-full py-2.5 rounded-full bg-white text-[#120b1d] font-bold text-sm text-center"
              >
                Создать аккаунт
              </a>
              <a
                href={`${appBase}/login`}
                data-auth-anon
                className="w-full py-2.5 rounded-full bg-white/12 border border-white/25 text-white font-semibold text-sm text-center"
              >
                Войти
              </a>
              <a
                href={`${appBase}/`}
                data-auth-authed
                className="w-full py-2.5 rounded-full bg-white text-[#120b1d] font-bold text-sm text-center"
              >
                Открыть приложение
              </a>
            </div>
          </div>
        )}
      </header>

      <main id="main" className="relative z-10">
        {/* Экран 1: 3D Showcase Hero (Planet BOLD + GROW + Mindly) */}
        <HeroShowcase
          activePillar={activePillar}
          onSelectPillar={setActivePillar}
          appBase={appBase}
        />

        {/* Экран 2: Split Frosted Glass Stage (AFRICAN FOREST) */}
        <SplitCapabilitiesSection onSyncHeroPillar={setActivePillar} appBase={appBase} />

        {/* Экран 3: Живая Канбан-доска + 3D Конструктор проекта и тарифов (GROWTREE) */}
        <GrowCalculatorSection appBase={appBase} />

        {/* Экран 4: 3D-веер из трёх экранов платформы */}
        <ProductWalkthroughSection />

        {/* Экран 5: Поиск по возможностям, гарантии, FAQ и блог */}
        <CatalogFaqSection posts={posts} appBase={appBase} />
      </main>

      <footer className="relative z-10 max-w-[1440px] mx-auto px-5 sm:px-9 py-10 border-t border-white/15 text-xs sm:text-sm text-white/75">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <div>
            <strong className="text-white font-bold block">
              © {currentYear} ProjectsFlow · Платформа для тех, кто строит с AI
            </strong>
            <span>
              Опиши идею — получи готовый продукт · Встроенный Claude онлайн · Прозрачные финансы в ₽
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <a
              href="/blog"
              className="px-4 py-2 rounded-full bg-white/10 hover:bg-white/20 text-white font-semibold transition"
            >
              Блог
            </a>
            <a
              href={`${appBase}/login`}
              data-auth-anon
              className="px-4 py-2 rounded-full bg-white/10 hover:bg-white/20 text-white font-semibold transition"
            >
              Войти
            </a>
            <a
              href={`${appBase}/register`}
              data-auth-anon
              className="px-4 py-2 rounded-full bg-white/18 hover:bg-white/28 text-white font-bold transition"
            >
              Начать бесплатно ↗
            </a>
            <a
              href={`${appBase}/`}
              data-auth-authed
              className="px-4 py-2 rounded-full bg-white/18 hover:bg-white/28 text-white font-bold transition"
            >
              Открыть приложение ↗
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default ShowcaseApp;
