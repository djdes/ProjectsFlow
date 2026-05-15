import { useState, type FormEvent } from 'react';
import { Save, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
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
                  fieldLabel={key}
                  vaultRef={String(value)}
                  editable
                  onChange={() => { /* значение секрета меняется в БД, ref остаётся тот же */ }}
                />
              ) : (
                <div className="space-y-1.5">
                  <Label htmlFor={`fm-${key}`}>{key}</Label>
                  <Input
                    id={`fm-${key}`}
                    value={typeof value === 'string' ? value : JSON.stringify(value)}
                    onChange={(e) => updateField(key, e.target.value)}
                  />
                </div>
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
