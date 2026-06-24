import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
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
import { EmojiGrid } from './EmojiGrid';
import { useCreateWorkspace } from '@/presentation/hooks/useCreateWorkspace';
import { WorkspaceIcon } from '@/presentation/layout/WorkspaceIcon';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

// Модалка создания пространства: название + опциональная эмодзи-иконка. На «Создать»
// сервер создаёт пространство, делает его активным и возвращает isCurrent=true —
// мы закрываем модалку и перебрасываем юзера в новое (пустое) пространство.
export function NewWorkspaceDialog({ open, onOpenChange }: Props): React.ReactElement {
  const navigate = useNavigate();
  const { submit, saving } = useCreateWorkspace();
  const [name, setName] = useState('');
  const [icon, setIcon] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setName('');
      setIcon(null);
      setSubmitError(null);
    }
  }, [open]);

  const trimmed = name.trim();
  const disabled = saving || trimmed.length === 0;

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setSubmitError(null);
    try {
      await submit(trimmed, icon);
      onOpenChange(false);
      navigate('/');
    } catch {
      setSubmitError('Не удалось создать пространство');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Новое пространство</DialogTitle>
          <DialogDescription>
            Командное пространство со своими участниками, проектами и чатом — отдельно от
            вашего пространства по&nbsp;умолчанию. Создаётся пустым.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex items-center gap-3">
            <WorkspaceIcon name={trimmed || 'П'} icon={icon} className="size-11 text-lg" />
            <div className="flex-1 space-y-2">
              <Label htmlFor="workspaceName">
                Название <span className="text-destructive">*</span>
              </Label>
              <Input
                id="workspaceName"
                autoFocus
                maxLength={120}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Работа, Клиент, Команда…"
                aria-invalid={Boolean(submitError)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Иконка</Label>
            <EmojiGrid value={icon} onChange={setIcon} />
          </div>

          {submitError && <p className="text-xs text-destructive">{submitError}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Отмена
            </Button>
            <Button type="submit" disabled={disabled}>
              {saving ? 'Создаём…' : 'Создать'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
