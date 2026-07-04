import { useState } from 'react';
import { Search, Shuffle, Trash2 } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { defaultProjectIcon as FolderIcon } from '@/presentation/layout/projectIcons';
import { ProjectIconView } from './projectIconView';
import {
  EmojiPane,
  IconsPane,
  UploadPane,
  isPlainEmoji,
  loadRecent,
  pushRecent,
  randomEmoji,
} from './ProjectIconPicker';

type Props = {
  value: string | null;
  onChange: (icon: string | null) => void;
  // Размер квадрата-триггера.
  size?: 'sm' | 'lg';
  triggerClassName?: string;
  // Кастомный триггер (напр. текстовая кнопка «Добавить иконку»). Если задан — заменяет
  // квадрат-превью. Оборачивается в PopoverTrigger asChild.
  trigger?: React.ReactNode;
  // Открылся/закрылся поповер — родителю (напр. inline-создание) нужно знать, чтобы не
  // коммитить/не закрывать карточку, пока пикер открыт.
  onOpenChange?: (open: boolean) => void;
};

// Универсальный пикер иконки (value + onChange) — то же окно, что у иконки проекта
// (эмодзи / lucide / загрузка + фильтр + случайная + убрать), но без привязки к проекту.
// Используется для иконки задачи (inline-создание и окно редактирования).
export function IconPicker({ value, onChange, size = 'sm', triggerClassName, trigger, onOpenChange }: Props): React.ReactElement {
  const [open, setOpenState] = useState(false);
  const setOpen = (next: boolean): void => {
    setOpenState(next);
    onOpenChange?.(next);
  };
  const [recent, setRecent] = useState<string[]>(loadRecent);
  const [tab, setTab] = useState<'emoji' | 'icons' | 'upload'>('emoji');
  const [query, setQuery] = useState('');
  const big = size === 'lg';

  const pick = (next: string | null): void => {
    setOpen(false);
    if (next && isPlainEmoji(next)) setRecent(pushRecent(next));
    onChange(next);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {trigger ?? (
          <button
            type="button"
            // Не крадём фокус у поля рядом (inline-создание: клик по иконке не должен
            // блёрить textarea → закрывать карточку до открытия пикера).
            onMouseDown={(e) => e.preventDefault()}
            aria-label={value ? 'Сменить иконку' : 'Добавить иконку'}
            title="Иконка"
            className={cn(
              'grid shrink-0 cursor-pointer select-none place-items-center overflow-hidden rounded-md leading-none text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
              big ? 'size-9' : 'size-7',
              triggerClassName,
            )}
          >
            {value ? (
              <ProjectIconView
                icon={value}
                pixelSize={big ? 26 : 18}
                className={big ? 'text-[1.5rem]' : 'text-[1.1rem]'}
              />
            ) : (
              <FolderIcon className={big ? 'size-5' : 'size-4'} />
            )}
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[24rem] max-w-[94vw] overflow-hidden p-0"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
          <div className="flex items-center gap-1 border-b px-2 py-1.5">
            <TabsList className="h-7 gap-0.5 bg-transparent p-0">
              <TabsTrigger value="emoji" className="h-7 px-2 text-xs">Эмодзи</TabsTrigger>
              <TabsTrigger value="icons" className="h-7 px-2 text-xs">Иконки</TabsTrigger>
              <TabsTrigger value="upload" className="h-7 px-2 text-xs">Загрузить</TabsTrigger>
            </TabsList>
            <div className="ml-auto flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => pick(randomEmoji())}
                aria-label="Случайная иконка"
                title="Случайная иконка"
                className="grid size-7 place-items-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <Shuffle className="size-4" />
              </button>
              {value && (
                <button
                  type="button"
                  onClick={() => pick(null)}
                  aria-label="Убрать иконку"
                  title="Убрать иконку"
                  className="grid size-7 place-items-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <Trash2 className="size-4" />
                </button>
              )}
            </div>
          </div>

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
            <EmojiPane query={query} recent={recent} current={value} onPick={(e) => pick(e)} />
          </TabsContent>
          <TabsContent value="icons" className="m-0">
            <IconsPane query={query} current={value} onPick={(v) => pick(v)} />
          </TabsContent>
          <TabsContent value="upload" className="m-0">
            <UploadPane onPick={(u) => pick(u)} />
          </TabsContent>
        </Tabs>
      </PopoverContent>
    </Popover>
  );
}
