import { useState, type FormEvent } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/sonner';
import { useContainer } from '@/infrastructure/di/container';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  onConnected: () => void;
};

export function ConnectKbDialog({ open, onOpenChange, projectId, onConnected }: Props): React.ReactElement {
  const { kbRepository } = useContainer();
  const [fullName, setFullName] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setSaving(true);
    try {
      await kbRepository.connectRepo(projectId, fullName.trim());
      toast.success('KB-репо подключён');
      onConnected();
      onOpenChange(false);
      setFullName('');
    } catch (err) {
      toast.error((err as Error).message ?? 'Не удалось подключить');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Подключить существующий KB-репо</DialogTitle>
          <DialogDescription>
            Введи имя репо в формате owner/repo. Юзер должен иметь к нему доступ через свой GitHub.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="fullName">owner/repo</Label>
            <Input
              id="fullName"
              autoFocus
              placeholder="oleg/scanflow-kb"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Отмена</Button>
            <Button type="submit" disabled={saving || fullName.trim().length === 0}>
              {saving ? 'Подключаем…' : 'Подключить'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
