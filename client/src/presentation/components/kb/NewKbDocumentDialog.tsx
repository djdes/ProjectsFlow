import { useEffect, useState, type FormEvent } from 'react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/sonner';
import type { Frontmatter } from '@/domain/kb/KbDocument';
import { useContainer } from '@/infrastructure/di/container';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  /** The folder where the document will be created (e.g. 'credentials', 'notes') */
  folder: string;
  /** Preset type derived from the folder */
  typePreset: string;
  onCreated: (path: string) => void;
  // Опционально: открыть «Bulk add» — для credentials с паролями там нормальный UX
  // (parse KEY:VALUE, секреты ↦ vault). Этот диалог же — просто пустая заметка.
  onOpenBulk?: () => void;
};

function slugify(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

const PLACEHOLDER_BY_TYPE: Record<string, string> = {
  credential: 'Например: Stripe API',
  note: 'Например: Заметка о деплое',
};

export function NewKbDocumentDialog({
  open,
  onOpenChange,
  projectId,
  folder,
  typePreset,
  onCreated,
  onOpenBulk,
}: Props): React.ReactElement {
  const { kbRepository } = useContainer();
  const [title, setTitle] = useState('');
  const [fileSlug, setFileSlug] = useState('');
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isCredential = typePreset === 'credential';
  const titlePlaceholder = PLACEHOLDER_BY_TYPE[typePreset] ?? 'Название заметки';

  // Reset form when dialog opens/closes
  useEffect(() => {
    if (!open) {
      setTitle('');
      setFileSlug('');
      setBody('');
      setError(null);
    }
  }, [open]);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setError(null);

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError('Введите название');
      return;
    }

    const slug = fileSlug.trim() || slugify(trimmedTitle);
    if (!slug) {
      setError('Не удалось сформировать имя файла');
      return;
    }

    const path = `${folder}/${slug}.md`;
    const fm: Frontmatter = { type: typePreset, title: trimmedTitle };

    setSaving(true);
    try {
      await kbRepository.write(projectId, path, fm, body, null);
      toast.success('Файл создан');
      onOpenChange(false);
      onCreated(path);
    } catch (err) {
      const e = err as Error & { body?: { details?: unknown } };
      const details = e.body?.details;
      if (Array.isArray(details)) {
        setError((details as { message: string }[]).map((d) => d.message).join('; '));
      } else {
        setError(e.message ?? 'Не удалось создать файл');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleSwitchToBulk = (): void => {
    if (!onOpenBulk) return;
    onOpenChange(false);
    onOpenBulk();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Новая заметка в «{folder}»</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Title — required */}
          <div className="space-y-1.5">
            <Label htmlFor="new-kb-title">
              Название <span className="text-destructive">*</span>
            </Label>
            <Input
              id="new-kb-title"
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={titlePlaceholder}
            />
          </div>

          {/* File slug — optional */}
          <div className="space-y-1.5">
            <Label htmlFor="new-kb-slug">Имя файла (необязательно)</Label>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <span>{folder}/</span>
              <Input
                id="new-kb-slug"
                value={fileSlug}
                onChange={(e) => setFileSlug(e.target.value)}
                placeholder={slugify(title) || 'auto'}
                className="h-7 flex-1 text-xs"
              />
              <span>.md</span>
            </div>
          </div>

          {/* Body — optional textarea */}
          <div className="space-y-1.5">
            <Label htmlFor="new-kb-body">Содержимое (необязательно)</Label>
            <textarea
              id="new-kb-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
              className="w-full rounded-md border bg-background p-3 text-sm"
              placeholder="Markdown-описание…"
            />
          </div>

          {/* Подсказка для credentials: пароли через Bulk add, не сюда */}
          {isCredential && onOpenBulk && (
            <p className="rounded-md border border-dashed bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              Нужен credential с&nbsp;паролем или несколькими полями?{' '}
              <button
                type="button"
                onClick={handleSwitchToBulk}
                className="font-medium text-primary hover:underline"
              >
                Используй «Bulk add»
              </button>{' '}
              — он сам распарсит пары <code className="font-mono">key: value</code> и&nbsp;спрячет
              секреты в&nbsp;vault.
            </p>
          )}

          {error && <p className="text-xs text-destructive">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Отмена
            </Button>
            <Button type="submit" disabled={saving || !title.trim()}>
              {saving ? 'Создаём…' : 'Создать'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
