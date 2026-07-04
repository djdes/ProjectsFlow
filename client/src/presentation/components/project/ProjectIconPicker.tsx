import { useMemo, useRef, useState } from 'react';
import { Loader2, Shuffle, Trash2, Search, ImageUp, Link2 } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/components/ui/sonner';
import { cn } from '@/lib/utils';
import { useUpdateProject } from '@/presentation/hooks/useUpdateProject';
import { defaultProjectIcon as FolderIcon } from '@/presentation/layout/projectIcons';
import { EMOJI_CATEGORIES } from './emojiData';
import { EMOJI_KEYWORDS } from './emojiKeywords';
import { LUCIDE_ICONS, LUCIDE_COLORS, LUCIDE_COLOR_MAP } from './lucideIconList';
import { ProjectIconView } from './projectIconView';

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

// Все эмодзи одним плоским списком (для фильтра/рандома).
const ALL_EMOJIS: readonly string[] = EMOJI_CATEGORIES.flatMap((c) => c.emojis);

// Случайная иконка из всего набора (кнопка-шафл, Notion-style).
function randomEmoji(): string {
  return ALL_EMOJIS.length ? ALL_EMOJIS[Math.floor(Math.random() * ALL_EMOJIS.length)] : '🚀';
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

// Загруженный файл → квадратный data-URL (клиентский ресайз, без бэкенда): рисуем cover
// в canvas 128×128 и кодируем в webp. Хранится прямо в строковом поле `icon`.
async function fileToIconDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const SIZE = 128;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas недоступен');
  // cover: масштабируем по меньшей стороне, центрируем.
  const scale = Math.max(SIZE / bitmap.width, SIZE / bitmap.height);
  const w = bitmap.width * scale;
  const h = bitmap.height * scale;
  ctx.drawImage(bitmap, (SIZE - w) / 2, (SIZE - h) / 2, w, h);
  bitmap.close();
  return canvas.toDataURL('image/webp', 0.85);
}

type Props = {
  projectId: string;
  icon: string | null;
  // Крупный вариант (для большого заголовка проекта в шапке страницы, Notion-style).
  big?: boolean;
};

// Иконка проекта рядом с заголовком. Клик открывает пикер с тремя вкладками (Notion-style):
// «Эмодзи» (категории + недавние), «Иконки» (lucide), «Загрузить» (файл/ссылка). Сверху —
// фильтр, справа — «случайная» и «убрать». Сама иконка занимает квадрат целиком.
export function ProjectIconPicker({ projectId, icon, big = false }: Props): React.ReactElement {
  const { submit, saving } = useUpdateProject();
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<string[]>(loadRecent);
  const [tab, setTab] = useState<'emoji' | 'icons' | 'upload'>('emoji');
  const [query, setQuery] = useState('');

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
            icon || saving
              ? cn('grid place-items-center overflow-hidden rounded-md', big ? 'size-12' : 'size-9')
              : big
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
            <ProjectIconView
              icon={icon}
              pixelSize={big ? 44 : 30}
              className={big ? 'text-[2.9rem]' : 'text-[1.9rem]'}
            />
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
        className="w-[24rem] max-w-[94vw] overflow-hidden p-0"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          {/* Шапка: вкладки + «случайная» + «убрать». */}
          <div className="flex items-center gap-1 border-b px-2 py-1.5">
            <TabsList className="h-7 gap-0.5 bg-transparent p-0">
              <TabsTrigger value="emoji" className="h-7 px-2 text-xs">Эмодзи</TabsTrigger>
              <TabsTrigger value="icons" className="h-7 px-2 text-xs">Иконки</TabsTrigger>
              <TabsTrigger value="upload" className="h-7 px-2 text-xs">Загрузить</TabsTrigger>
            </TabsList>
            <div className="ml-auto flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => void choose(randomEmoji())}
                aria-label="Случайная иконка"
                title="Случайная иконка"
                className="grid size-7 place-items-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <Shuffle className="size-4" />
              </button>
              {icon && (
                <button
                  type="button"
                  onClick={() => void choose(null)}
                  aria-label="Убрать иконку"
                  title="Убрать иконку"
                  className="grid size-7 place-items-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <Trash2 className="size-4" />
                </button>
              )}
            </div>
          </div>

          {/* Фильтр — для «Эмодзи» и «Иконки». */}
          {tab !== 'upload' && (
            <div className="border-b px-2 py-1.5">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Фильтр…"
                  aria-label="Фильтр иконок"
                  className="h-7 w-full rounded-md border bg-transparent pl-7 pr-2 text-sm outline-none placeholder:text-muted-foreground/70 focus:border-foreground/30"
                />
              </div>
            </div>
          )}

          <TabsContent value="emoji" className="m-0">
            <EmojiPane query={query} recent={recent} current={icon} onPick={(e) => void choose(e)} />
          </TabsContent>
          <TabsContent value="icons" className="m-0">
            <IconsPane query={query} current={icon} onPick={(value) => void choose(value)} />
          </TabsContent>
          <TabsContent value="upload" className="m-0">
            <UploadPane onPick={(url) => void choose(url)} />
          </TabsContent>
        </Tabs>
      </PopoverContent>
    </Popover>
  );
}

// ── Вкладка «Эмодзи» ────────────────────────────────────────────────────────
function EmojiPane({
  query,
  recent,
  current,
  onPick,
}: {
  query: string;
  recent: string[];
  current: string | null;
  onPick: (emoji: string) => void;
}): React.ReactElement {
  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!q) return null;
    return ALL_EMOJIS.filter((e) => e === query || (EMOJI_KEYWORDS[e] ?? '').includes(q));
  }, [q, query]);

  return (
    <div className="pf-scroll-visible max-h-[46vh] min-h-[12rem] p-2">
      {filtered ? (
        filtered.length > 0 ? (
          <EmojiGridInner emojis={filtered} current={current} onPick={onPick} />
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">Ничего не найдено</p>
        )
      ) : (
        <>
          {recent.length > 0 && (
            <EmojiSection label="Недавние" emojis={recent} current={current} onPick={onPick} />
          )}
          {EMOJI_CATEGORIES.map((c) => (
            <EmojiSection key={c.id} label={c.label} emojis={c.emojis} current={current} onPick={onPick} />
          ))}
        </>
      )}
    </div>
  );
}

// ── Вкладка «Иконки» (lucide) ───────────────────────────────────────────────
// onPick получает готовую строку иконки `lucide:<Name>[:<colorKey>]`.
function IconsPane({
  query,
  current,
  onPick,
}: {
  query: string;
  current: string | null;
  onPick: (value: string) => void;
}): React.ReactElement {
  const [color, setColor] = useState('default');
  const q = query.trim().toLowerCase();
  const items = useMemo(
    () => (q ? LUCIDE_ICONS.filter((i) => i.keywords.includes(q) || i.name.toLowerCase().includes(q)) : LUCIDE_ICONS),
    [q],
  );
  const currentName = current?.startsWith('lucide:') ? current.slice('lucide:'.length).split(':')[0] : null;
  const previewHex = LUCIDE_COLOR_MAP[color]; // undefined для 'default'
  const compose = (name: string): string => `lucide:${name}${color !== 'default' ? `:${color}` : ''}`;

  return (
    <div className="pf-scroll-visible max-h-[46vh] min-h-[12rem]">
      {/* Палитра цветов (Notion-style) — закреплена сверху. */}
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-1.5 border-b bg-popover px-2 py-2">
        {LUCIDE_COLORS.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => setColor(c.key)}
            aria-label={c.label}
            title={c.label}
            className={cn(
              'size-5 rounded-full border border-border transition',
              color === c.key && 'ring-2 ring-primary ring-offset-1 ring-offset-popover',
            )}
            style={{ backgroundColor: c.hex || undefined }}
          >
            {/* «По умолчанию» — точка цвета текста. */}
            {!c.hex && <span className="block size-full rounded-full bg-foreground/70" />}
          </button>
        ))}
      </div>

      <div className="p-2">
        {items.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Ничего не найдено</p>
        ) : (
          <div className="grid grid-cols-8 gap-0.5">
            {items.map(({ name, Icon }) => (
              <button
                key={name}
                type="button"
                onClick={() => onPick(compose(name))}
                aria-label={`Иконка ${name}`}
                title={name}
                className={cn(
                  'grid aspect-square place-items-center rounded-md text-muted-foreground transition-colors hover:bg-accent',
                  !previewHex && 'hover:text-foreground',
                  name === currentName && 'bg-accent ring-1 ring-primary/40',
                )}
              >
                <Icon className="size-5" style={{ color: previewHex }} />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Вкладка «Загрузить» ─────────────────────────────────────────────────────
function UploadPane({ onPick }: { onPick: (url: string) => void }): React.ReactElement {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState('');

  const handleFile = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    setBusy(true);
    try {
      onPick(await fileToIconDataUrl(file));
    } catch (e) {
      toast.error(`Не удалось загрузить: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-[12rem] space-y-3 p-3">
      <button
        type="button"
        disabled={busy}
        onClick={() => fileRef.current?.click()}
        className="flex w-full flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed py-8 text-sm text-muted-foreground transition-colors hover:border-foreground/30 hover:bg-muted/50 disabled:opacity-60"
      >
        {busy ? <Loader2 className="size-5 animate-spin" /> : <ImageUp className="size-5" />}
        {busy ? 'Загрузка…' : 'Выбрать файл'}
        <span className="text-xs text-muted-foreground/70">PNG, JPG, WEBP, GIF — квадрат 128×128</span>
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={(e) => void handleFile(e.target.files?.[0])}
      />

      {/* Ссылка на изображение. */}
      <div className="space-y-1.5">
        <label className="text-xs text-muted-foreground">Или вставьте ссылку на картинку</label>
        <div className="flex items-center gap-1.5">
          <div className="relative flex-1">
            <Link2 className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="https://…"
              className="h-8 w-full rounded-md border bg-transparent pl-7 pr-2 text-sm outline-none placeholder:text-muted-foreground/70 focus:border-foreground/30"
            />
          </div>
          <button
            type="button"
            disabled={!/^https?:\/\//.test(link.trim())}
            onClick={() => onPick(link.trim())}
            className="h-8 shrink-0 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            Ок
          </button>
        </div>
      </div>
    </div>
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
      <EmojiGridInner emojis={emojis} current={current} onPick={onPick} />
    </div>
  );
}

function EmojiGridInner({
  emojis,
  current,
  onPick,
}: {
  emojis: readonly string[];
  current: string | null;
  onPick: (emoji: string) => void;
}): React.ReactElement {
  return (
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
  );
}
