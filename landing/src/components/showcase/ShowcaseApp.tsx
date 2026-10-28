import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import Lenis from 'lenis';
import { ArrowUpRight, Layers, Menu, X } from 'lucide-react';
import {
  STACK_LAYERS,
  TARIFF_OPTIONS,
  type ChassisMode,
  type StackLayerId,
  type StackLayerSpec,
  type TariffOption,
} from '../../data/showcaseData';
import { AuroraCanvas } from './AuroraCanvas';
import { HeroShowcase } from './HeroShowcase';
import { SplitCapabilitiesSection } from './SplitCapabilitiesSection';
import { GrowCalculatorSection } from './GrowCalculatorSection';
import { ProductWalkthroughSection } from './ProductWalkthroughSection';
import { CatalogFaqSection, type BlogTeaserItem } from './CatalogFaqSection';

export interface ShowcaseAppProps {
  posts?: BlogTeaserItem[];
  appBase?: string;
}

export const ShowcaseApp: React.FC<ShowcaseAppProps> = ({
  posts = [],
  appBase = '',
}) => {
  const [activeLayerId, setActiveLayerId] = useState<StackLayerId>('layer-autopilot');
  const [activeTariff, setActiveTariff] = useState<TariffOption>(TARIFF_OPTIONS[1]!);
  const [chassisMode, setChassisMode] = useState<ChassisMode>('exploded');
  const [spinTrigger, setSpinTrigger] = useState<number>(0);
  const [activeNav, setActiveNav] = useState<string>('hero');
  const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);
  const [isAuthed, setIsAuthed] = useState<boolean>(false);

  const activeLayer: StackLayerSpec =
    STACK_LAYERS.find((l) => l.id === activeLayerId) ?? STACK_LAYERS[0]!;

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches;
    if (prefersReducedMotion) return;

    const lenis = new Lenis({
      duration: 1.05,
      smoothWheel: true,
      wheelMultiplier: 0.95,
    });

    let rafId = 0;
    function raf(time: number) {
      lenis.raf(time);
      rafId = requestAnimationFrame(raf);
    }
    rafId = requestAnimationFrame(raf);

    return () => {
      cancelAnimationFrame(rafId);
      lenis.destroy();
    };
  }, []);

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then((res) => {
        if (res.ok) setIsAuthed(true);
      })
      .catch(() => {});
  }, []);

  // Scroll-spy: automatically highlight active top navigation tab when scrolling
  useEffect(() => {
    const sectionIds = [
      'hero',
      'prompt-sandbox',
      'walkthrough',
      'live-board',
      'grow-calculator',
      'pricing',
      'faq',
      'blog',
    ];

    const handleScroll = () => {
      const triggerY = window.innerHeight * 0.35;
      let currentId = 'hero';

      for (const id of sectionIds) {
        const el = document.getElementById(id);
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        if (rect.top <= triggerY) {
          currentId = id;
        }
      }

      // If scrolled near the bottom of the page, highlight 'blog'
      if (
        window.innerHeight + window.scrollY >=
        document.documentElement.scrollHeight - 120
      ) {
        if (document.getElementById('blog')) {
          currentId = 'blog';
        }
      }

      setActiveNav((prev) => (prev === currentId ? prev : currentId));
    };

    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const handleSelectLayer = (id: StackLayerId) => {
    setActiveLayerId(id);
    setSpinTrigger((prev) => prev + 1);
  };

  const handleSelectTariff = (tariff: TariffOption) => {
    setActiveTariff(tariff);
    setSpinTrigger((prev) => prev + 1);
  };

  const handleChangeChassisMode = (mode: ChassisMode) => {
    setChassisMode(mode);
    setSpinTrigger((prev) => prev + 1);
  };

  const scrollToSection = (sectionId: string) => {
    setActiveNav(sectionId);
    setMobileMenuOpen(false);
    const el = document.getElementById(sectionId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const navItems = [
    { id: 'hero', label: '3D Стек' },
    { id: 'prompt-sandbox', label: 'Песочница ИИ' },
    { id: 'walkthrough', label: 'Узлы 01–03' },
    { id: 'live-board', label: 'Живая доска' },
    { id: 'grow-calculator', label: 'Реактор ₽' },
    { id: 'pricing', label: 'Тарифы' },
    { id: 'faq', label: 'FAQ' },
    { id: 'blog', label: 'Журнал' },
  ];

  return (
    <div
      className="min-h-screen w-full text-white transition-all duration-700 relative overflow-x-clip bg-[#050811]"
      style={{ backgroundColor: '#050811', backgroundImage: activeLayer.stageGradient }}
    >
      {/* Fixed Caustic Horizon Grid & Vertical Glass Columns */}
      <AuroraCanvas glowRgb={activeLayer.glowRgb} />

      {/* Top Glass Header */}
      <header className="sticky top-0 z-50 backdrop-blur-2xl bg-[#0c0514]/80 border-b border-white/15">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-8 h-20 flex items-center justify-between gap-4">
          <a
            href="#hero"
            onClick={(e) => {
              e.preventDefault();
              scrollToSection('hero');
            }}
            className="flex items-center gap-3 group cursor-pointer"
          >
            <div
              className="w-10 h-10 rounded-xl border border-white/25 flex items-center justify-center shadow-lg transition-transform group-hover:scale-105"
              style={{ backgroundColor: `${activeLayer.primaryColor}28` }}
            >
              <Layers
                className="w-5 h-5"
                style={{ color: activeLayer.accentColor }}
              />
            </div>
            <div>
              <span className="font-display font-black text-base sm:text-lg tracking-tight text-white block leading-none">
                ProjectsFlow
              </span>
              <span className="font-mono text-[10px] text-white/60 tracking-wider uppercase block mt-0.5">
                AI Architecture OS
              </span>
            </div>
          </a>

          {/* Desktop Navigation Pills */}
          <nav
            aria-label="Основная навигация"
            className="hidden xl:flex items-center gap-1 p-1.5 rounded-2xl bg-white/[0.06] border border-white/15"
          >
            {navItems.map((item) => {
              const isActive = activeNav === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => scrollToSection(item.id)}
                  aria-current={isActive ? 'location' : undefined}
                  className={`relative px-3.5 py-2 rounded-xl text-xs font-bold transition-all duration-200 cursor-pointer ${
                    isActive
                      ? 'bg-white text-[#12061c] shadow-md scale-[1.02]'
                      : 'text-white/75 hover:text-white hover:bg-white/[0.08]'
                  }`}
                >
                  <span className="relative z-10">{item.label}</span>
                </button>
              );
            })}
          </nav>

          {/* Right Auth / CTA Buttons */}
          <div className="flex items-center gap-2.5">
            {!isAuthed && (
              <a
                href={`${appBase}/login`}
                data-auth-anon=""
                className="hidden sm:inline-flex items-center px-4 py-2.5 rounded-xl bg-white/[0.06] hover:bg-white/[0.14] border border-white/15 text-xs font-bold text-white transition-all"
              >
                Войти
              </a>
            )}
            <a
              href={isAuthed ? `${appBase}/projects` : `${appBase}/login`}
              data-auth-authed={isAuthed ? '' : undefined}
              className="inline-flex items-center gap-1.5 px-4 sm:px-5 py-2.5 rounded-xl bg-white text-[#12061c] font-extrabold text-xs hover:bg-rose-50 transition-all shadow-md"
            >
              <span>{isAuthed ? 'В проекты' : '1 час Прайма бесплатно'}</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </a>

            <button
              type="button"
              aria-label="Открыть меню"
              onClick={() => setMobileMenuOpen((v) => !v)}
              className="xl:hidden w-10 h-10 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center text-white cursor-pointer"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Mobile Drawer */}
        <AnimatePresence>
          {mobileMenuOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="xl:hidden overflow-hidden bg-[#12061c]/95 border-b border-white/15 px-4 pb-4"
            >
              <div className="grid grid-cols-2 gap-2 pt-2">
                {navItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => scrollToSection(item.id)}
                    className={`px-3.5 py-2.5 rounded-xl border text-left text-xs font-bold ${
                      activeNav === item.id
                        ? 'bg-white text-[#12061c] border-white'
                        : 'bg-white/[0.06] text-white border-white/10'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      {/* Main Content */}
      <main>
        <HeroShowcase
          activeLayer={activeLayer}
          activeTariff={activeTariff}
          chassisMode={chassisMode}
          spinTrigger={spinTrigger}
          isAuthed={isAuthed}
          appBase={appBase}
          onSelectLayer={handleSelectLayer}
          onSelectTariff={handleSelectTariff}
          onChangeChassisMode={handleChangeChassisMode}
          onScrollToSection={scrollToSection}
        />

        <SplitCapabilitiesSection
          onSelectLayer={handleSelectLayer}
          isAuthed={isAuthed}
          appBase={appBase}
        />

        <ProductWalkthroughSection onSelectLayer={handleSelectLayer} />

        <GrowCalculatorSection
          activeLayer={activeLayer}
          activeTariff={activeTariff}
          spinTrigger={spinTrigger}
          isAuthed={isAuthed}
          appBase={appBase}
          onSelectLayer={handleSelectLayer}
          onSelectTariff={handleSelectTariff}
        />

        <CatalogFaqSection
          posts={posts}
          isAuthed={isAuthed}
          appBase={appBase}
          onSelectLayer={handleSelectLayer}
        />
      </main>

      {/* Footer */}
      <footer className="relative z-10 border-t border-white/15 bg-[#0a0412]/90 backdrop-blur-xl mt-12">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-8 py-10 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-white/60">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg bg-rose-500/20 border border-rose-400/30 flex items-center justify-center">
              <Layers className="w-4 h-4 text-rose-400" />
            </div>
            <span className="font-bold text-white">ProjectsFlow</span>
            <span>© {new Date().getFullYear()} · Все расчёты в ₽ · Код принадлежит вам</span>
          </div>

          <div className="flex flex-wrap items-center gap-5">
            <a href="#hero" className="hover:text-white transition-colors">
              3D Архитектура
            </a>
            <a href="#prompt-sandbox" className="hover:text-white transition-colors">
              Песочница ИИ
            </a>
            <a href="#pricing" className="hover:text-white transition-colors">
              Тарифы
            </a>
            <a href="/blog/" className="hover:text-white transition-colors">
              Все статьи журнала
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default ShowcaseApp;
