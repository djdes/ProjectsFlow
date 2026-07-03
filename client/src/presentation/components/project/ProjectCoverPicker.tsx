import { useEffect, useRef, useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import {
  COVER_GRADIENTS,
  COVER_SCENES,
  presetTileStyle,
  gradientToken,
} from './coverGallery';

type Props = {
  // Выбор готового значения (градиент/фото/ссылка) — ставим coverUrl через PATCH.
  onSetCover: (coverUrl: string) => void;
  // Загрузка своего файла (multipart). Поповер НЕ закрываем здесь — родитель закроет по завершении.
  onUploadFile: (file: File) => void;
  // Убрать обложку.
  onRemove: () => void;
  // Закрыть поповер (после выбора пресета/ссылки/убрать).
  onClose: () => void;
  busy?: boolean;
  // Идёт аплоад файла (показываем прогресс-бар).
  uploading?: boolean;
  // Прогресс аплоада 0..100.
  uploadPct?: number;
};

// Достаёт файл-изображение из буфера обмена (ctrl+v). null — если картинки в буфере нет
// (например, скопирован текст/ссылка) — тогда вставку не перехватываем.
function imageFromClipboard(data: DataTransfer | null): File | null {
  if (!data) return null;
  for (const item of Array.from(data.items)) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const f = item.getAsFile();
      if (f) return f;
    }
  }
  return null;
}

// Поповер «Поменять обложку» — как в Notion: вкладки Галерея / Загрузить / Ссылка, а справа —
// «Убрать». Плюс: пока поповер открыт, ctrl+v из любого места (на любой вкладке) вставляет
// картинку из буфера и грузит её с мгновенным прогресс-баром.
export function ProjectCoverPicker({
  onSetCover,
  onUploadFile,
  onRemove,
  onClose,
  busy,
  uploading,
  uploadPct = 0,
}: Props): React.ReactElement {
  const fileRef = useRef<HTMLInputElement>(null);
  const [link, setLink] = useState('');

  // Перехват ctrl+v пока открыт поповер — вставка картинки из буфера на любой вкладке.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent): void => {
      if (busy || uploading) return;
      const file = imageFromClipboard(e.clipboardData);
      if (!file) return; // в буфере не картинка — не мешаем обычной вставке (напр. ссылки)
      e.preventDefault();
      onUploadFile(file);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [busy, uploading, onUploadFile]);

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

        {/* Прогресс аплоада (файл или ctrl+v) — виден на любой вкладке, появляется моментально. */}
        {uploading && (
          <div className="space-y-1.5 border-b px-3 py-2.5">
            <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
              <span>Загрузка обложки…</span>
              <span className="tabular-nums">{uploadPct}%</span>
            </div>
            <Progress value={uploadPct} />
          </div>
        )}

        {/* Галерея: арт-обложки + одноцветные градиенты (всё — чистый CSS) */}
        <TabsContent value="gallery" className="max-h-[50vh] space-y-3 overflow-y-auto p-3">
          <div>
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Обложки
            </p>
            <div className="grid grid-cols-3 gap-2">
              {COVER_SCENES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => pick(gradientToken(s.id))}
                  style={presetTileStyle(s.css)}
                  className="h-14 rounded-md bg-cover bg-center ring-1 ring-black/5 transition-transform hover:scale-[1.03] dark:ring-white/10"
                  aria-label={`Обложка ${s.id}`}
                />
              ))}
            </div>
          </div>
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
                  style={presetTileStyle(g.css)}
                  className="h-10 rounded-md ring-1 ring-black/5 transition-transform hover:scale-[1.04] dark:ring-white/10"
                  aria-label={`Градиент ${g.id}`}
                />
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
              // Поповер не закрываем — покажем прогресс-бар, родитель закроет по завершении.
              if (f) onUploadFile(f);
            }}
          />
          <p className="text-center text-xs text-muted-foreground">
            jpg, png, webp, gif · до 20&nbsp;МБ · лучше шире 1500&nbsp;px
            <br />
            или просто вставьте картинку через&nbsp;Ctrl+V
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
