import { useEffect, useState, type FormEvent } from 'react';
import { KeyRound, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/sonner';
import { useContainer } from '@/infrastructure/di/container';
import type { ParsedBulkPreview } from '@/application/kb/KbRepository';
import { HttpError } from '@/lib/HttpError';

type FrontmatterError = { code: string; message: string };

// Достаём подробности из HttpError, чтобы юзер видел КОНКРЕТНУЮ причину
// (например "credential_no_ref" — ни один чекбокс не отмечен) вместо общего
// "frontmatter_invalid".
function extractErrorMessage(e: unknown): string {
  if (e instanceof HttpError) {
    const details = e.body.details;
    if (Array.isArray(details) && details.length > 0) {
      return (details as FrontmatterError[]).map((d) => d.message).join('\n');
    }
    return e.body.message ?? e.body.error ?? e.message;
  }
  return (e as Error)?.message ?? 'Не удалось сохранить';
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  onCreated: (path: string) => void;
};

const EXAMPLE = `SSH: scanflow ПРОД
HOST: scanflow.ru
USER: scanflow
PASS: <значение>
PORT LOCAL: 22
PORT REMOTE: 50222`;

export function BulkCredentialDialog({
  open,
  onOpenChange,
  projectId,
  onCreated,
}: Props): React.ReactElement {
  const { kbRepository } = useContainer();
  const [rawText, setRawText] = useState('');
  const [preview, setPreview] = useState<ParsedBulkPreview | null>(null);
  const [title, setTitle] = useState('');
  const [secretOverrides, setSecretOverrides] = useState<Record<string, boolean>>({});
  const [fileSlug, setFileSlug] = useState('');
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Сбрасываем состояние при закрытии
  useEffect(() => {
    if (!open) {
      setRawText('');
      setPreview(null);
      setTitle('');
      setSecretOverrides({});
      setFileSlug('');
      setError(null);
    }
  }, [open]);

  const handleParse = async (): Promise<void> => {
    setParsing(true);
    setError(null);
    try {
      const p = await kbRepository.parseBulkCredential(projectId, rawText);
      setPreview(p);
      setTitle(p.title);
      setFileSlug(p.suggestedFileSlug);
      const overrides: Record<string, boolean> = {};
      for (const f of p.fields) overrides[f.key] = f.isSecret;
      setSecretOverrides(overrides);
    } catch (e) {
      setError(extractErrorMessage(e));
    } finally {
      setParsing(false);
    }
  };

  const toggleSecret = (key: string): void => {
    setSecretOverrides((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSave = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (!preview) return;
    setSaving(true);
    setError(null);
    try {
      const result = await kbRepository.bulkCreateCredential(projectId, {
        rawText,
        fileSlugOverride: fileSlug.trim() || null,
        titleOverride: title.trim() || null,
        secretOverrides,
      });
      toast.success(
        `Credential создан: ${result.path}` +
          (result.secretsWritten.length > 0
            ? ` (${result.secretsWritten.length} secret(s) сохранено в vault)`
            : ''),
      );
      onCreated(result.path);
      onOpenChange(false);
    } catch (e) {
      setError(extractErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="size-5" />
            Быстрое создание credential
          </DialogTitle>
          <DialogDescription>
            Вставь блок в&nbsp;формате <code>KEY: VALUE</code> по&nbsp;строке. Первая строка может
            быть <code>KIND: TITLE</code>. Поля с&nbsp;именами вроде PASS / TOKEN / SECRET / KEY
            будут автоматически предложены как секреты — значения уйдут в&nbsp;vault.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="bulk-raw">Текст</Label>
          <textarea
            id="bulk-raw"
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            placeholder={EXAMPLE}
            rows={8}
            className="w-full rounded-md border bg-background p-3 font-mono text-sm"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleParse}
              disabled={parsing || rawText.trim().length === 0}
            >
              {parsing ? <Loader2 className="size-4 animate-spin" /> : null}
              Распарсить
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setRawText(EXAMPLE)}
              disabled={rawText.length > 0}
            >
              Вставить пример
            </Button>
          </div>
        </div>

        {preview && (
          <form onSubmit={handleSave} className="space-y-4 border-t pt-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="bulk-title">Title</Label>
                <Input
                  id="bulk-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="scanflow ПРОД"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bulk-slug">Имя файла (без расширения)</Label>
                <Input
                  id="bulk-slug"
                  value={fileSlug}
                  onChange={(e) => setFileSlug(e.target.value)}
                  placeholder="scanflow-prod"
                />
              </div>
            </div>

            {preview.kind && (
              <p className="text-xs text-muted-foreground">
                kind: <code>{preview.kind}</code>
              </p>
            )}

            <div className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">
                Поля ({preview.fields.length})
              </p>
              <p className="text-xs text-muted-foreground">
                Отметь чекбоксами какие из&nbsp;них — секреты. Их значения уйдут в&nbsp;vault,
                во&nbsp;frontmatter будет только ссылка <code>vault://...</code>.
              </p>
              <ul className="divide-y rounded-md border">
                {preview.fields.map((f) => (
                  <li key={f.key} className="flex items-center gap-3 px-3 py-2">
                    <input
                      type="checkbox"
                      id={`secret-${f.key}`}
                      checked={secretOverrides[f.key] ?? false}
                      onChange={() => toggleSecret(f.key)}
                      className="size-4"
                    />
                    <label
                      htmlFor={`secret-${f.key}`}
                      className="cursor-pointer text-xs uppercase tracking-widest text-muted-foreground"
                    >
                      секрет
                    </label>
                    {/* Значение показываем plaintext в любом случае — юзер только что сам его
                        вставил и нуждается в визуальной проверке ПЕРЕД отправкой в vault.
                        Маскирование тут давало ложное чувство приватности (текст уже в textarea
                        выше), мешая поймать опечатки. */}
                    <span className="ml-2 flex-1 truncate font-mono text-sm">
                      <span className="font-medium">{f.key}</span>
                      <span className="text-muted-foreground">: </span>
                      <span className="text-foreground">{f.value}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            {error && <p className="whitespace-pre-line text-sm text-destructive">{error}</p>}

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Отмена
              </Button>
              <Button type="submit" disabled={saving || fileSlug.trim().length === 0}>
                {saving ? <Loader2 className="size-4 animate-spin" /> : null}
                Создать credential
              </Button>
            </DialogFooter>
          </form>
        )}

        {!preview && error && (
          <p className="whitespace-pre-line text-sm text-destructive">{error}</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
