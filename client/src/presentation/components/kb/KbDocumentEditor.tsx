import { useState, type FormEvent } from 'react';
import { Save, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { AutoGrowTextarea } from '@/components/ui/auto-grow-textarea';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/sonner';
import type { Frontmatter, KbDocument } from '@/domain/kb/KbDocument';
import { useContainer } from '@/infrastructure/di/container';
import { SecretField } from '@/presentation/components/secrets/SecretField';

type Props = {
  projectId: string;
  document: KbDocument;
  onCancel: () => void;
  onSaved: () => void;
};

function isSecretRefKey(key: string): boolean {
  return key.endsWith('_ref');
}

// ---------------------------------------------------------------------------
// Typed field detection
// ---------------------------------------------------------------------------

type FmFieldType = 'string' | 'number' | 'boolean' | 'array' | 'null' | 'unknown';

function detectType(v: unknown): FmFieldType {
  if (v === null) return 'null';
  if (typeof v === 'string') return 'string';
  if (typeof v === 'number') return 'number';
  if (typeof v === 'boolean') return 'boolean';
  if (Array.isArray(v)) return 'array';
  return 'unknown'; // object etc. — render readonly JSON
}

// ---------------------------------------------------------------------------
// Per-field component
// ---------------------------------------------------------------------------

type FieldProps = {
  fieldKey: string;
  value: unknown;
  onChange: (value: unknown) => void;
};

function FmField({ fieldKey, value, onChange }: FieldProps): React.ReactElement {
  // "activated null" — user clicked "Задать значение" on a null field
  const [nullActivated, setNullActivated] = useState(false);

  const type = detectType(value);

  const id = `fm-${fieldKey}`;

  if (type === 'boolean') {
    return (
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="checkbox"
          checked={value as boolean}
          onChange={(e) => onChange(e.target.checked)}
          className="size-4 rounded border"
        />
        <Label htmlFor={id}>{fieldKey}</Label>
      </div>
    );
  }

  if (type === 'number') {
    return (
      <div className="space-y-1.5">
        <Label htmlFor={id}>{fieldKey}</Label>
        <Input
          id={id}
          type="number"
          value={value as number}
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        />
      </div>
    );
  }

  if (type === 'array') {
    const arr = value as unknown[];
    return (
      <div className="space-y-1.5">
        <Label htmlFor={id}>{fieldKey} <span className="text-xs text-muted-foreground">(по одному на строку)</span></Label>
        <AutoGrowTextarea
          id={id}
          value={arr.join('\n')}
          onChange={(e) =>
            onChange(
              e.target.value
                .split('\n')
                .map((s) => s.trim())
                .filter(Boolean),
            )
          }
          minRows={Math.max(3, arr.length + 1)}
          className="w-full rounded-md border bg-background p-3 text-sm"
        />
      </div>
    );
  }

  if (type === 'null') {
    if (!nullActivated) {
      return (
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">{fieldKey}: (пусто)</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-6 text-xs"
            onClick={() => { setNullActivated(true); onChange(''); }}
          >
            Задать значение
          </Button>
        </div>
      );
    }
    // Fallthrough to string input after activation
    return (
      <div className="space-y-1.5">
        <Label htmlFor={id}>{fieldKey}</Label>
        <Input
          id={id}
          autoFocus
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    );
  }

  if (type === 'unknown') {
    // Object or other — readonly JSON display
    return (
      <div className="space-y-1.5">
        <Label>{fieldKey} <span className="text-xs text-amber-500">(объект — только чтение)</span></Label>
        <pre className="rounded-md border bg-muted p-2 text-xs overflow-x-auto">{JSON.stringify(value, null, 2)}</pre>
      </div>
    );
  }

  // Default: string
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{fieldKey}</Label>
      <Input
        id={id}
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main editor
// ---------------------------------------------------------------------------

export function KbDocumentEditor({ projectId, document, onCancel, onSaved }: Props): React.ReactElement {
  const { kbRepository } = useContainer();
  const [fm, setFm] = useState<Record<string, unknown>>({ ...document.frontmatter });
  const [body, setBody] = useState(document.body);
  const [saving, setSaving] = useState(false);

  const updateField = (key: string, value: unknown): void => {
    setFm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setSaving(true);
    try {
      await kbRepository.write(projectId, document.path, fm as Frontmatter, body, document.sha);
      toast.success('Сохранено');
      onSaved();
    } catch (err) {
      const e = err as Error & { body?: { details?: unknown } };
      const details = e.body?.details;
      if (Array.isArray(details)) {
        toast.error(`Валидация: ${(details as { message: string }[]).map((d) => d.message).join('; ')}`);
      } else {
        toast.error(e.message ?? 'Не удалось сохранить');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="flex-1 text-xl font-semibold">Редактирование</h2>
        <Button type="submit" size="sm" disabled={saving}>
          <Save className="size-4" />
          {saving ? 'Сохраняем…' : 'Сохранить'}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          <X className="size-4" />
          Отмена
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Frontmatter</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {Object.entries(fm).map(([key, value]) => (
            <div key={key}>
              {isSecretRefKey(key) ? (
                <SecretField
                  projectId={projectId}
                  fieldLabel={key}
                  vaultRef={String(value)}
                  editable
                  onChange={() => { /* vault ref stays the same — value changes in DB */ }}
                />
              ) : (
                <FmField
                  fieldKey={key}
                  value={value}
                  onChange={(v) => updateField(key, v)}
                />
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Содержимое (markdown)</CardTitle>
        </CardHeader>
        <CardContent>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={20}
            className="w-full rounded-md border bg-background p-3 font-mono text-sm"
          />
        </CardContent>
      </Card>
    </form>
  );
}
