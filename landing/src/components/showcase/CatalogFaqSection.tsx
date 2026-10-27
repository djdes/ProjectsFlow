import React, { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowUpRight,
  BookOpen,
  ChevronDown,
  Code2,
  Cpu,
  HelpCircle,
  Lock,
  Sparkles,
} from 'lucide-react';
import { FAQ_ITEMS, type StackLayerId } from '../../data/showcaseData';

export interface BlogTeaserItem {
  slug: string;
  title: string;
  topic: 'Практика' | 'Продукт' | 'Деньги' | 'Автоматизация';
  dateIso: string;
  dateFormatted: string;
  minutes: number;
  description: string;
}

interface CatalogFaqSectionProps {
  posts: BlogTeaserItem[];
  isAuthed: boolean;
  appBase: string;
  onSelectLayer?: (id: StackLayerId) => void;
}

export const CatalogFaqSection: React.FC<CatalogFaqSectionProps> = ({
  posts,
  isAuthed,
  appBase,
  onSelectLayer,
}) => {
  const [openFaqIdx, setOpenFaqIdx] = useState<number | null>(0);

  return (
    <div className="relative z-10 max-w-[1440px] mx-auto px-4 sm:px-8 py-14 space-y-20">
      {/* 1. 3 CLEAN GUARANTEES CARDS */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div
          onClick={() => onSelectLayer?.('layer-claude')}
          className="rounded-[28px] p-7 bg-[#140720]/90 border border-white/15 hover:border-purple-400/50 transition-all cursor-pointer flex flex-col justify-between"
        >
          <div>
            <div className="w-12 h-12 rounded-2xl bg-purple-500/20 border border-purple-400/40 flex items-center justify-center text-purple-300 mb-5">
              <Cpu className="w-6 h-6" />
            </div>
            <h3 className="font-display font-black text-xl text-white mb-2">
              Claude уже внутри без VPN
            </h3>
            <p className="text-sm text-white/70 leading-relaxed">
              На тарифах «Прайм» и «VIP» подписка работает сразу из браузера, а первый час на «Прайме» — бесплатный.
            </p>
          </div>
          <span className="mt-5 font-mono text-xs font-bold text-purple-300 inline-flex items-center gap-1">
            Показать в 3D <ArrowUpRight className="w-3.5 h-3.5" />
          </span>
        </div>

        <div
          onClick={() => onSelectLayer?.('layer-deploy')}
          className="rounded-[28px] p-7 bg-[#140720]/90 border border-white/15 hover:border-rose-400/50 transition-all cursor-pointer flex flex-col justify-between"
        >
          <div>
            <div className="w-12 h-12 rounded-2xl bg-rose-500/20 border border-rose-400/40 flex items-center justify-center text-rose-300 mb-5">
              <Code2 className="w-6 h-6" />
            </div>
            <h3 className="font-display font-black text-xl text-white mb-2">
              100% ваш код и Git
            </h3>
            <p className="text-sm text-white/70 leading-relaxed">
              Никакой привязки к закрытому конструктору. Чистый стек React, TypeScript и Node.js в вашем репозитории.
            </p>
          </div>
          <span className="mt-5 font-mono text-xs font-bold text-rose-300 inline-flex items-center gap-1">
            Показать в 3D <ArrowUpRight className="w-3.5 h-3.5" />
          </span>
        </div>

        <div
          onClick={() => onSelectLayer?.('layer-finance')}
          className="rounded-[28px] p-7 bg-[#140720]/90 border border-white/15 hover:border-amber-400/50 transition-all cursor-pointer flex flex-col justify-between"
        >
          <div>
            <div className="w-12 h-12 rounded-2xl bg-amber-500/20 border border-amber-400/40 flex items-center justify-center text-amber-300 mb-5">
              <Lock className="w-6 h-6" />
            </div>
            <h3 className="font-display font-black text-xl text-white mb-2">
              Гарантия возврата средств
            </h3>
            <p className="text-sm text-white/70 leading-relaxed">
              Если после оплаты что-то не подойдёт — вернём деньги без вопросов, а весь созданный код останется у вас.
            </p>
          </div>
          <span className="mt-5 font-mono text-xs font-bold text-amber-300 inline-flex items-center gap-1">
            Показать в 3D <ArrowUpRight className="w-3.5 h-3.5" />
          </span>
        </div>
      </section>

      {/* 2. FAQ ACCORDION (#faq) */}
      <section id="faq" className="scroll-mt-24">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          <div className="lg:col-span-5">
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/10 border border-white/20 mb-3">
              <HelpCircle className="w-3.5 h-3.5 text-rose-400" />
              <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-white/90">
                Частые вопросы
              </span>
            </div>
            <h2 className="font-display font-black uppercase text-3xl sm:text-5xl leading-[0.96] tracking-[-0.03em] text-white mb-4">
              ОТВЕТЫ НА{' '}
              <span className="text-rose-400">ВОПРОСЫ</span>
            </h2>
            <p className="text-white/75 text-sm sm:text-base leading-relaxed mb-6">
              Главное о встроенной подписке на Claude, бесплатном часе на «Прайме» и правах на код.
            </p>

            <a
              href={isAuthed ? `${appBase}/projects` : `${appBase}/login`}
              className="inline-flex items-center gap-2.5 px-6 py-4 rounded-2xl bg-white text-[#140720] font-extrabold text-sm hover:bg-rose-50 transition-all shadow-lg"
            >
              <Sparkles className="w-4 h-4 text-rose-600" />
              <span>Начать бесплатно</span>
              <ArrowUpRight className="w-4 h-4" />
            </a>
          </div>

          <div className="lg:col-span-7 space-y-3">
            {FAQ_ITEMS.map((item, idx) => {
              const isOpen = openFaqIdx === idx;
              return (
                <div
                  key={item.q}
                  className={`rounded-2xl border transition-all overflow-hidden ${
                    isOpen
                      ? 'bg-[#1c0a2b] border-white/40 shadow-xl'
                      : 'bg-[#12061c]/80 border-white/15 hover:border-white/30'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setOpenFaqIdx(isOpen ? null : idx)}
                    className="w-full px-6 py-5 text-left flex items-center justify-between gap-4 cursor-pointer"
                  >
                    <span className="font-bold text-sm sm:text-base text-white">
                      {item.q}
                    </span>
                    <ChevronDown
                      className={`w-5 h-5 text-white/60 shrink-0 transition-transform ${
                        isOpen ? 'rotate-180 text-rose-400' : ''
                      }`}
                    />
                  </button>

                  <AnimatePresence initial={false}>
                    {isOpen && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.22 }}
                      >
                        <div className="px-6 pb-5 text-sm text-white/75 leading-relaxed border-t border-white/10 pt-4">
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
      </section>

      {/* 3. BLOG TEASER (#blog) */}
      {posts.length > 0 && (
        <section id="blog" className="scroll-mt-24">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8">
            <div>
              <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-white/10 border border-white/20 mb-3">
                <BookOpen className="w-3.5 h-3.5 text-rose-400" />
                <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-white/90">
                  Журнал ProjectsFlow
                </span>
              </div>
              <h2 className="font-display font-black uppercase text-2xl sm:text-4xl text-white">
                СТАТЬИ И <span className="text-rose-400">РАЗБОРЫ</span>
              </h2>
            </div>

            <a
              href="/blog/"
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/15 text-xs font-bold text-white transition-all self-start sm:self-auto"
            >
              <span>Все статьи</span>
              <ArrowUpRight className="w-4 h-4" />
            </a>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {posts.map((post) => (
              <a
                key={post.slug}
                href={`/blog/${post.slug}/`}
                className="group rounded-[26px] p-6 bg-[#140720]/85 border border-white/15 hover:border-rose-400/50 transition-all flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between gap-2 text-xs font-mono text-white/55 mb-3">
                    <span>{post.dateFormatted} · {post.minutes} мин</span>
                    <span className="px-2.5 py-0.5 rounded-md bg-white/10 text-rose-300">
                      #{post.topic}
                    </span>
                  </div>
                  <h3 className="font-bold text-base sm:text-lg text-white group-hover:text-rose-300 transition-colors mb-2 line-clamp-2">
                    {post.title}
                  </h3>
                  <p className="text-xs sm:text-sm text-white/65 leading-relaxed line-clamp-3">
                    {post.description}
                  </p>
                </div>

                <span className="mt-5 inline-flex items-center gap-1.5 text-xs font-mono font-bold text-white/85 group-hover:text-white">
                  Читать статью <ArrowUpRight className="w-3.5 h-3.5" />
                </span>
              </a>
            ))}
          </div>
        </section>
      )}
    </div>
  );
};
