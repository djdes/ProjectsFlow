import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Plus, ShieldCheck, ArrowUpRight, BookOpen } from 'lucide-react';
import { USE_CASE_CATALOG } from '@/data/showcaseData';
import { FAQ } from '@/data/faq';

export interface BlogPostPreview {
  readonly slug: string;
  readonly title: string;
  readonly topic: string;
  readonly dateIso: string;
  readonly dateFormatted: string;
  readonly minutes: number;
  readonly description: string;
}

interface CatalogFaqSectionProps {
  posts?: readonly BlogPostPreview[];
  appBase?: string;
}

export const CatalogFaqSection: React.FC<CatalogFaqSectionProps> = ({
  posts = [],
  appBase = '',
}) => {
  const [query, setQuery] = useState<string>('');
  const [openFaq, setOpenFaq] = useState<number>(0);

  const filteredCatalog = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return USE_CASE_CATALOG;
    return USE_CASE_CATALOG.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q) ||
        item.priceHint.toLowerCase().includes(q) ||
        item.tags.some((t) => t.toLowerCase().includes(q)),
    );
  }, [query]);

  return (
    <section id="faq" className="scroll-mt-24 max-w-[1440px] mx-auto my-20 px-4 sm:px-9 space-y-12">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-7">
        {/* Левая стеклянная панель: Живой поиск по задачам и гарантии */}
        <div className="p-6 sm:p-9 rounded-[32px] bg-[#100b1d]/65 border border-white/22 backdrop-blur-2xl shadow-2xl flex flex-col justify-between gap-6">
          <div>
            <span className="text-xs font-extrabold tracking-[0.14em] text-amber-300 block mb-2">
              КАТАЛОГ ВОЗМОЖНОСТЕЙ И ЗАДАЧ
            </span>
            <h3 className="font-display font-black text-2xl sm:text-3xl text-white mb-2">
              Что можно поручить ProjectsFlow
            </h3>
            <p className="text-xs sm:text-sm text-white/80 mb-5">
              Введите задачу или модуль (например, лендинг, бот, СБП, Claude, финансы, мониторинг), чтобы увидеть, как платформа решает её на автопилоте.
            </p>

            <div className="flex items-center gap-3 px-4 py-3 rounded-[16px] bg-white/10 border border-white/25 mb-4">
              <Search className="w-4 h-4 text-white/70 shrink-0" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Лендинг, Telegram-бот, оплата СБП, Claude, финансы..."
                className="w-full bg-transparent text-sm text-white placeholder:text-white/50 outline-none"
              />
            </div>

            <div className="flex flex-col gap-2.5 max-h-[320px] overflow-y-auto pr-1">
              {filteredCatalog.map((item) => (
                <div
                  key={item.name}
                  className="flex items-center justify-between gap-3 p-3.5 rounded-[16px] bg-white/6 border border-white/12 hover:bg-white/12 transition"
                >
                  <div className="min-w-0">
                    <strong className="block text-sm font-bold text-white truncate">
                      {item.name}
                    </strong>
                    <span className="text-xs text-white/75">
                      {item.category} · {item.priceHint}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5 shrink-0">
                    {item.tags.map((t) => (
                      <span
                        key={t}
                        className="px-2.5 py-1 rounded-full bg-white/16 text-[11px] font-bold text-white"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Плашка снятия риска (Гарантии) */}
          <div className="p-4.5 rounded-[22px] bg-[#0e241b]/80 border border-[#94f23c]/40 flex items-start gap-3.5">
            <ShieldCheck className="w-6 h-6 text-[#94f23c] shrink-0 mt-0.5" />
            <div>
              <strong className="block text-sm font-bold text-white">
                Первый час бесплатно · Не зашло — вернём деньги
              </strong>
              <p className="text-xs text-white/80 leading-relaxed mt-1">
                Начинаешь без карты. Платный тариф не подошёл — возвращаем оплату без мелкого шрифта. Весь созданный код и проект на 100% остаются твоими.
              </p>
            </div>
          </div>
        </div>

        {/* Правая стеклянная панель: Плавный аккордеон FAQ */}
        <div className="p-6 sm:p-9 rounded-[32px] bg-[#100b1d]/65 border border-white/22 backdrop-blur-2xl shadow-2xl">
          <span className="text-xs font-extrabold tracking-[0.14em] text-amber-300 block mb-2">
            ЧАСТЫЕ ВОПРОСЫ
          </span>
          <h3 className="font-display font-black text-2xl sm:text-3xl text-white mb-5">
            Честные ответы перед стартом
          </h3>

          <div className="flex flex-col gap-3">
            {FAQ.map((item, idx) => {
              const isOpen = openFaq === idx;
              return (
                <div
                  key={item.q}
                  className="rounded-[18px] bg-white/8 border border-white/18 overflow-hidden"
                >
                  <button
                    type="button"
                    onClick={() => setOpenFaq(isOpen ? -1 : idx)}
                    className="w-full p-4 flex items-center justify-between gap-4 text-left font-bold text-sm sm:text-[15px] text-white cursor-pointer"
                  >
                    <span>{item.q}</span>
                    <span
                      className={`w-7 h-7 rounded-full grid place-items-center shrink-0 transition-transform ${
                        isOpen ? 'rotate-45 bg-white text-[#120b1d]' : 'bg-white/15 text-white'
                      }`}
                    >
                      <Plus className="w-4 h-4" />
                    </span>
                  </button>
                  <AnimatePresence initial={false}>
                    {isOpen && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.25 }}
                        className="overflow-hidden"
                      >
                        <div className="px-4 pb-4 text-xs sm:text-sm leading-relaxed text-white/80">
                          {item.a}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Секция блога (3 свежие статьи + переход в /blog) */}
      {posts.length > 0 && (
        <div
          id="blog"
          className="scroll-mt-24 p-6 sm:p-10 rounded-[32px] bg-[#100b1d]/65 border border-white/22 backdrop-blur-2xl shadow-2xl"
        >
          <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
            <div>
              <span className="inline-flex items-center gap-1.5 text-xs font-extrabold tracking-[0.14em] text-[#a3f73b] mb-1.5">
                <BookOpen className="w-3.5 h-3.5" />
                <span>БЛОГ И ПРАКТИКА</span>
              </span>
              <h2 className="font-display font-black text-2xl sm:text-3xl text-white">
                Идеи и практика для тех, кто строит с AI
              </h2>
            </div>
            <a
              href="/blog"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-white/14 hover:bg-white/24 border border-white/25 text-xs sm:text-sm font-bold text-white transition"
            >
              <span>Все статьи блога</span>
              <ArrowUpRight className="w-4 h-4" />
            </a>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {posts.map((post) => (
              <a
                key={post.slug}
                href={`/blog/${post.slug}/`}
                className="group p-5 rounded-[24px] bg-white/8 border border-white/15 hover:bg-white/14 hover:border-white/30 transition flex flex-col justify-between gap-4 text-left"
              >
                <div>
                  <div className="flex items-center justify-between gap-2 text-xs text-white/70 mb-2.5">
                    <span className="px-2.5 py-0.5 rounded-full bg-white/15 text-white font-semibold">
                      {post.topic}
                    </span>
                    <span>{post.minutes} мин чтения</span>
                  </div>
                  <h3 className="font-bold text-base sm:text-lg text-white group-hover:text-[#a3f73b] transition leading-snug mb-2">
                    {post.title}
                  </h3>
                  <p className="text-xs sm:text-sm text-white/75 line-clamp-3 leading-relaxed">
                    {post.description}
                  </p>
                </div>
                <div className="flex items-center justify-between text-xs text-white/60 pt-2 border-t border-white/10">
                  <time dateTime={post.dateIso}>{post.dateFormatted}</time>
                  <span className="font-bold text-white group-hover:translate-x-0.5 transition">
                    Читать →
                  </span>
                </div>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Финальный CTA-блок */}
      <div className="p-8 sm:p-12 rounded-[36px] bg-gradient-to-r from-[#1d1138]/90 via-[#13252c]/90 to-[#0e261c]/90 border border-white/25 backdrop-blur-2xl shadow-2xl flex flex-col lg:flex-row items-center justify-between gap-6 text-center lg:text-left">
        <div className="max-w-xl">
          <h2 className="font-display font-black text-2xl sm:text-4xl text-white tracking-tight mb-2">
            Попробуй на своей идее уже сегодня
          </h2>
          <p className="text-sm sm:text-base text-white/80">
            Начни бесплатно и без карты — первый результат увидишь уже в первый час. Не зашло — вернём деньги, а код и проект всегда остаются твоими.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3 shrink-0">
          <a
            href={`${appBase}/register`}
            data-auth-anon
            className="inline-flex items-center gap-2.5 px-7 py-4 rounded-full bg-white text-[#120b1d] font-extrabold text-sm sm:text-base shadow-xl hover:scale-105 transition"
          >
            <span>Начать бесплатно</span>
            <ArrowUpRight className="w-4 h-4" />
          </a>
          <a
            href={`${appBase}/login`}
            data-auth-anon
            className="inline-flex items-center gap-2 px-6 py-4 rounded-full bg-white/12 border border-white/25 text-white font-bold text-sm hover:bg-white/20 transition"
          >
            <span>Войти</span>
          </a>
          <a
            href={`${appBase}/`}
            data-auth-authed
            className="inline-flex items-center gap-2.5 px-7 py-4 rounded-full bg-white text-[#120b1d] font-extrabold text-sm sm:text-base shadow-xl hover:scale-105 transition"
          >
            <span>Открыть приложение</span>
            <ArrowUpRight className="w-4 h-4" />
          </a>
        </div>
      </div>
    </section>
  );
};
