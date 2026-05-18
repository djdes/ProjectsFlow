import { useState } from 'react';
import { Copy, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/sonner';
import { useContainer } from '@/infrastructure/di/container';

type Props = {
  fieldLabel: string;
  vaultRef: string;     // "vault://<project>/<file>/<field>"
  onChange?: (newValue: string | null) => void;  // null = delete
  editable?: boolean;
};

function parseVaultRef(ref: string): string | null {
  const m = ref.match(/^vault:\/\/(.+)$/);
  return m ? m[1] : null;
}

export function SecretField({ fieldLabel, vaultRef, onChange, editable = false }: Props): React.ReactElement {
  const { secretsRepository } = useContainer();
  const key = parseVaultRef(vaultRef);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [newValue, setNewValue] = useState('');

  const handleReveal = async (): Promise<void> => {
    if (!key) { toast.error('Невалидный vault://-ref'); return; }
    if (revealed) { setRevealed(null); return; }
    setLoading(true);
    try {
      const value = await secretsRepository.get(key);
      setRevealed(value);
    } catch (err) {
      toast.error((err as Error).message ?? 'Не удалось получить секрет');
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async (): Promise<void> => {
    if (!revealed) {
      // Если не открыт — открываем и копируем
      if (!key) return;
      try {
        const value = await secretsRepository.get(key);
        await navigator.clipboard.writeText(value);
        toast.success('Скопировано');
      } catch {
        toast.error('Не удалось скопировать');
      }
      return;
    }
    await navigator.clipboard.writeText(revealed);
    toast.success('Скопировано');
  };

  const handleSave = async (): Promise<void> => {
    if (!key) return;
    setLoading(true);
    try {
      await secretsRepository.put(key, newValue);
      toast.success('Секрет обновлён');
      setEditing(false);
      setNewValue('');
      setRevealed(null);
      onChange?.(newValue);
    } catch (err) {
      toast.error((err as Error).message ?? 'Не удалось сохранить');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-1.5">
      <Label>{fieldLabel}</Label>
      {editing ? (
        <div className="flex items-center gap-2">
          <Input type="password" value={newValue} onChange={(e) => setNewValue(e.target.value)} autoFocus />
          <Button size="sm" onClick={handleSave} disabled={loading || newValue.length === 0}>
            Сохранить
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Отмена</Button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Input
            type={revealed ? 'text' : 'password'}
            value={revealed ?? '••••••••'}
            readOnly
            className="font-mono"
          />
          <Button size="icon" variant="outline" onClick={handleReveal} disabled={loading} aria-label="Reveal">
            {revealed ? <EyeOff /> : <Eye />}
          </Button>
          <Button size="icon" variant="outline" onClick={handleCopy} disabled={loading} aria-label="Copy">
            <Copy />
          </Button>
          {editable && (
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>Изменить</Button>
          )}
        </div>
      )}
    </div>
  );
}
