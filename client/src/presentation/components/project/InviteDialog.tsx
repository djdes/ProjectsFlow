import { useEffect, useState, type FormEvent } from 'react';
import { Copy, Loader2 } from 'lucide-react';
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
import type {
  ProjectInvite,
  ProjectInviteRole,
} from '@/domain/project/ProjectInvite';
import { useContainer } from '@/infrastructure/di/container';

type Props = {
  projectId: string;
  open: boolean;
  onClose: () => void;
  onCreated: (invite: ProjectInvite) => void;
};

export function InviteDialog({ projectId, open, onClose, onCreated }: Props): React.ReactElement {
  const { projectRepository } = useContainer();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<ProjectInviteRole>('editor');
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<ProjectInvite | null>(null);

  useEffect(() => {
    if (!open) {
      // На закрытии чистим стейт чтобы при следующем открытии форма была пустая.
      setEmail('');
      setRole('editor');
      setCreated(null);
    }
  }, [open]);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const invite = await projectRepository.createInvite(projectId, {
        role,
        email: email.trim().length > 0 ? email.trim() : null,
      });
      setCreated(invite);
      onCreated(invite);
    } catch (e2) {
      toast.error(`Не удалось: ${(e2 as Error).message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const copyUrl = async (): Promise<void> => {
    if (!created?.url) return;
    try {
      await navigator.clipboard.writeText(created.url);
      toast.success('Скопировано');
    } catch {
      toast.error('Не удалось скопировать. Скопируй из поля ниже вручную.');
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Пригласить в проект</DialogTitle>
          <DialogDescription>
            Скопируй ссылку и отправь коллеге любым способом (мессенджер, email). Срок действия — 7
            дней.
          </DialogDescription>
        </DialogHeader>

        {created ? (
          <div className="space-y-3">
            <Label htmlFor="invite-url">Ссылка</Label>
            <div className="flex gap-2">
              <Input
                id="invite-url"
                value={created.url ?? ''}
                readOnly
                onFocus={(e) => e.target.select()}
                className="font-mono text-xs"
              />
              <Button type="button" variant="outline" size="icon" onClick={() => void copyUrl()}>
                <Copy className="size-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Это единственная возможность увидеть ссылку. Если потеряешь — отзови приглашение и
              создай новое.
            </p>
            <DialogFooter>
              <Button variant="ghost" onClick={onClose}>
                Готово
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="invite-email">Email (необязательно)</Label>
              <Input
                id="invite-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="kolya@example.com"
              />
              <p className="text-xs text-muted-foreground">
                Email — пометка «для кого». На него ничего не отправится (SMTP пока не подключён).
                Принять приглашение может любой залогиненный юзер по ссылке.
              </p>
            </div>
            <div className="space-y-2">
              <Label>Роль</Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={role === 'editor' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setRole('editor')}
                  className="flex-1"
                >
                  Редактор
                </Button>
                <Button
                  type="button"
                  variant={role === 'viewer' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setRole('viewer')}
                  className="flex-1"
                >
                  Наблюдатель
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {role === 'editor'
                  ? 'Редактор: создаёт/правит задачи, комментарии, KB, аттачи. Не может управлять командой.'
                  : 'Наблюдатель: только смотрит. Может оставлять комментарии.'}
              </p>
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
                Отмена
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
                Создать ссылку
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
