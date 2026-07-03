import { useState } from 'react';
import { Loader2, Shuffle } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import { useUpdateProject } from '@/presentation/hooks/useUpdateProject';
import { defaultProjectIcon as FolderIcon } from '@/presentation/layout/projectIcons';
import { EMOJI_CATEGORIES } from './emojiData';

// Курируемая палитра (Notion-style) — используется формой «Новый проект» (EmojiGrid).
// Полный набор для пикера иконки проекта живёт в emojiData.ts (EMOJI_CATEGORIES).
export const EMOJI = [
  '🚀', '🎯', '⭐', '🔥', '💡', '📦', '🛠️', '⚙️',
  '💻', '🖥️', '📱', '🌐', '🤖', '🧠', '🔬', '🧪',
  '📈', '📊', '💰', '🏦', '🛒', '🏷️', '📝', '📚',
  '🎵', '🎧', '🎬', '🎨', '📷', '🎮', '🏠', '🏗️',
  '✈️', '🚗', '🌱', '🌍', '☀️', '🌙', '❤️', '✅',
] as const;

const RECENT_KEY = 'pf:recent-emojis';
const RECENT_MAX = 27;

// Случайная иконка из всего набора (кнопка-шафл, Notion-style).
function randomEmoji(): string {
  const all = EMOJI_CATEGORIES.flatMap((c) => c.emojis);
  return all.length ? all[Math.floor(Math.random() * all.length)] : '🚀';
}

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const arr = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(arr)
      ? arr.filter((x): x is string => typeof x === 'string').slice(0, RECENT_MAX)
      : [];
  } catch {
    return [];
  }
}

function pushRecent(emoji: string): string[] {
  const next = [emoji, ...loadRecent().filter((e) => e !== emoji)].slice(0, RECENT_MAX);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* localStorage недоступен — просто не персистим */
  }
  return next;
}

type Props = {
  projectId: string;
  icon: string | null;
  // Крупный вариант (для большого заголовка проекта в шапке страницы, Notion-style).
  big?: boolean;
};

// Иконка проекта рядом с заголовком: эмодзи (или дефолтная папка). Клик открывает пикер с
// категориями + «Недавние» (большой набор emojiData). Сама иконка занимает квадрат целиком
// (от края до края), на hover — только курсор-поинтер, без серой заливки (Notion-style).
export function ProjectIconPicker({ projectId, icon, big = false }: Props): React.ReactElement {
  const { submit, saving } = useUpdateProject();
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<string[]>(loadRecent);
  // Активная категория: 'all' — все секции (с «Недавние»), либо id одной категории.
  const [activeCat, setActiveCat] = useState<string>('all');

  const choose = async (next: string | null): Promise<void> => {
    setOpen(false);
    if (next && next !== icon) setRecent(pushRecent(next));
    if (next === icon) return;
    try {
      await submit(projectId, { icon: next });
    } catch (e) {
      toast.error(`Не удалось сменить иконку: ${(e as Error).message}`);
    }
  };

  const sections = activeCat === 'all' ? EMOJI_CATEGORIES : EMOJI_CATEGORIES.filter((c) => c.id === activeCat);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={saving}
          aria-label={icon ? 'Сменить иконку проекта' : 'Добавить иконку проекта'}
          title="Иконка проекта"
          className={cn(
            'shrink-0 cursor-pointer select-none leading-none disabled:opacity-50',
            // С иконкой — квадрат-контейнер (иконка от края до края, на hover только курсор).
            icon || saving
              ? cn('grid place-items-center overflow-hidden rounded-md', big ? 'size-12' : 'size-9')
              : // Пусто (big) — Notion-style призрачная кнопка «Добавить иконку», проявляется
                // при наведении на заголовок; при открытом пикере остаётся видимой.
                big
                ? cn(
                    'flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-muted-foreground',
                    'opacity-0 transition-opacity hover:bg-muted focus-visible:opacity-100',
                    'group-hover/title:opacity-100 data-[state=open]:opacity-100',
                  )
                : cn('grid place-items-center rounded-md', 'size-9'),
          )}
        >
          {saving ? (
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          ) : icon ? (
            <span aria-hidden className={cn('block leading-none', big ? 'text-[2.9rem]' : 'text-[1.9rem]')}>
              {icon}
            </span>
          ) : big ? (
            <>
              <FolderIcon className="size-4" />
              Добавить иконку
            </>
          ) : (
            <FolderIcon className="size-8 text-muted-foreground" />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[22rem] max-w-[92vw] overflow-hidden p-0"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {/* Шапка пикера: чипы категорий (горизонтальный скролл) + «Убрать». */}
        <div className="flex items-center gap-1 border-b px-2 py-1.5">
          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
            <CatChip active={activeCat === 'all'} onClick={() => setActiveCat('all')}>
              Все
            </CatChip>
            {EMOJI_CATEGORIES.map((c) => (
              <CatChip key={c.id} active={activeCat === c.id} onClick={() => setActiveCat(c.id)}>
                {c.label.split(' ')[0]}
              </CatChip>
            ))}
          </div>
          <button
            type="button"
            onClick={() => void choose(randomEmoji())}
            aria-label="Случайная иконка"
            title="Случайная иконка"
            className="grid size-7 shrink-0 place-items-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Shuffle className="size-4" />
          </button>
          {icon && (
            <button
              type="button"
              onClick={() => void choose(null)}
              className="shrink-0 rounded px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              Убрать
            </button>
          )}
        </div>

        <div className="max-h-[52vh] overflow-y-auto p-2">
          {activeCat === 'all' && recent.length > 0 && (
            <EmojiSection label="Недавние" emojis={recent} current={icon} onPick={(e) => void choose(e)} />
          )}
          {sections.map((c) => (
            <EmojiSection
              key={c.id}
              label={c.label}
              emojis={c.emojis}
              current={icon}
              onPick={(e) => void choose(e)}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// Чип категории в шапке пикера.
function CatChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'shrink-0 whitespace-nowrap rounded-md px-2 py-1 text-xs transition-colors',
        active
          ? 'bg-primary/10 font-medium text-primary'
          : 'text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}

// Секция эмодзи одной категории (заголовок + сетка кнопок).
function EmojiSection({
  label,
  emojis,
  current,
  onPick,
}: {
  label: string;
  emojis: readonly string[];
  current: string | null;
  onPick: (emoji: string) => void;
}): React.ReactElement {
  return (
    <div className="mb-2 last:mb-0">
      <p className="mb-1 px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
        {label}
      </p>
      <div className="grid grid-cols-9 gap-0.5">
        {emojis.map((e, i) => (
          <button
            key={`${e}-${i}`}
            type="button"
            onClick={() => onPick(e)}
            aria-label={`Иконка ${e}`}
            className={cn(
              'grid aspect-square place-items-center rounded-md text-xl leading-none transition-colors hover:bg-accent',
              e === current && 'bg-accent ring-1 ring-primary/40',
            )}
          >
            <span aria-hidden>{e}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
