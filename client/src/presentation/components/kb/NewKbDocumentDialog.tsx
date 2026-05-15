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
  projectName: string;
  /** The folder where the document will be created (e.g. 'credentials', 'notes') */
  folder: string;
  /** Preset type derived from the folder */
  typePreset: string;
  onCreated: (path: string) => void;
};

function slugify(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function NewKbDocumentDialog({
  open,
  onOpenChange,
  projectId,
  projectName,
  folder,
  typePreset,
  onCreated,
}: Props): React.ReactElement {
  const { kbRepository } = useContainer();
  const [title, setTitle] = useState('');
  const [fileSlug, setFileSlug] = useState('');
  const [body, setBody] = useState('');
  const [passwordRef, setPasswordRef] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isCredential = typePreset === 'credential';
  const projectSlug = slugify(projectName);

  // Reset form when dialog opens/closes
  useEffect(() => {
    if (!open) {
      setTitle('');
      setFileSlug('');
      setBody('');
      setPasswordRef('');
      setError(null);
    }
  }, [open]);

  // Auto-update passwordRef when title or fileSlug changes (for credential type)
  useEffect(() => {
    if (!isCredential) return;
    const slug = fileSlug.trim() || slugify(title);
    setPasswordRef(`vault://${projectSlug}/${slug || 'password'}/password`);
  }, [isCredential, title, fileSlug, projectSlug]);

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
    if (isCredential) {
      (fm as Record<string, unknown>).password_ref = passwordRef;
    }

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Новая заметка в «{folder}»</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Type — read-only */}
          <div className="space-y-1.5">
            <Label>Тип</Label>
            <Input value={typePreset} readOnly className="bg-muted text-muted-foreground" />
          </div>

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
              placeholder="Например: Stripe API keys"
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

          {/* Credential-specific: password_ref */}
          {isCredential && (
            <div className="space-y-1.5">
              <Label htmlFor="new-kb-password-ref">password_ref</Label>
              <Input
                id="new-kb-password-ref"
                value={passwordRef}
                onChange={(e) => setPasswordRef(e.target.value)}
              />
            </div>
          )}

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
