import { useRef, useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  COVER_GRADIENTS,
  COVER_PHOTOS,
  gradientTileStyle,
  gradientToken,
} from './coverGallery';

type Props = {
  // Выбор готового значения (градиент/фото/ссылка) — ставим coverUrl через PATCH.
  onSetCover: (coverUrl: string) => void;
  // Загрузка своего файла (multipart).
  onUploadFile: (file: File) => void;
  // Убрать обложку.
  onRemove: () => void;
  // Закрыть поповер (после выбора/загрузки/ссылки/убрать).
  onClose: () => void;
  busy?: boolean;
};

// Поповер «Поменять обложку» — как в Notion: вкладки Галерея / Загрузить / Ссылка, а справа —
// «Убрать». Любой выбор сразу применяет обложку и закрывает поповер.
export function ProjectCoverPicker({ onSetCover, onUploadFile, onRemove, onClose, busy }: Props): React.ReactElement {
  const fileRef = useRef<HTMLInputElement>(null);
  const [link, setLink] = useState('');

  const pick = (coverUrl: string): void => {
    onSetCover(coverUrl);
    onClose();
  };

  const submitLink = (): void => {
    const url = link.trim();
    if (!url) return;
    pick(url);
  };

  return (
    <div className="w-[min(28rem,90vw)]">
      <Tabs defaultValue="gallery" className="flex flex-col">
        <div className="flex items-center justify-between gap-2 border-b px-2 pt-1.5">
          <TabsList className="h-8 bg-transparent p-0">
            <TabsTrigger value="gallery" className="h-7 px-2 text-xs">Галерея</TabsTrigger>
            <TabsTrigger value="upload" className="h-7 px-2 text-xs">Загрузить</TabsTrigger>
            <TabsTrigger value="link" className="h-7 px-2 text-xs">Ссылка</TabsTrigger>
          </TabsList>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              onRemove();
              onClose();
            }}
            className="rounded px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
          >
            Убрать
          </button>
        </div>

        {/* Галерея: градиенты + фото */}
        <TabsContent value="gallery" className="max-h-[50vh] space-y-3 overflow-y-auto p-3">
          <div>
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Цвета и градиенты
            </p>
            <div className="grid grid-cols-4 gap-2">
              {COVER_GRADIENTS.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => pick(gradientToken(g.id))}
                  style={gradientTileStyle(g.css)}
                  className="h-10 rounded-md ring-1 ring-black/5 transition-transform hover:scale-[1.04] dark:ring-white/10"
                  aria-label={`Градиент ${g.id}`}
                />
              ))}
            </div>
          </div>
          <div>
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Фото
            </p>
            <div className="grid grid-cols-3 gap-2">
              {COVER_PHOTOS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => pick(p.url)}
                  className="h-14 overflow-hidden rounded-md ring-1 ring-black/5 transition-transform hover:scale-[1.03] dark:ring-white/10"
                  aria-label={`Фото ${p.id}`}
                >
                  <img src={p.thumb} alt="" loading="lazy" className="size-full object-cover" />
                </button>
              ))}
            </div>
          </div>
        </TabsContent>

        {/* Загрузить свой файл */}
        <TabsContent value="upload" className="space-y-2 p-3">
          <Button
            variant="secondary"
            className="w-full"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            Загрузить файл
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) {
                onUploadFile(f);
                onClose();
              }
            }}
          />
          <p className="text-center text-xs text-muted-foreground">
            jpg, png, webp, gif · до 20&nbsp;МБ · лучше шире 1500&nbsp;px
          </p>
        </TabsContent>

        {/* Ссылка на картинку из интернета */}
        <TabsContent value="link" className="space-y-2 p-3">
          <input
            value={link}
            onChange={(e) => setLink(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submitLink();
              }
            }}
            placeholder="Вставьте ссылку на картинку…"
            className={cn(
              'w-full rounded-md border bg-background px-3 py-2 text-sm outline-none',
              'focus-visible:ring-2 focus-visible:ring-ring',
            )}
          />
          <Button className="w-full" disabled={busy || link.trim().length === 0} onClick={submitLink}>
            Готово
          </Button>
          <p className="text-center text-xs text-muted-foreground">Подходит любая картинка из интернета.</p>
        </TabsContent>
      </Tabs>
    </div>
  );
}
