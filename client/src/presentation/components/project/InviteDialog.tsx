import { useEffect, useState, type FormEvent } from 'react';
import { Copy, Loader2, Users } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/sonner';
import type {
  ProjectInvite,
  ProjectInviteRole,
} from '@/domain/project/ProjectInvite';
import type { SharedMember } from '@/application/project/ProjectRepository';
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
  // Список юзеров, с которыми caller уже состоит в общих проектах. Подгружаем при
  // открытии и предлагаем выбрать одним кликом — частый кейс «пригласить того же».
  const [sharedMembers, setSharedMembers] = useState<SharedMember[] | null>(null);

  useEffect(() => {
    if (!open) {
      // На закрытии чистим стейт чтобы при следующем открытии форма была пустая.
      setEmail('');
      setRole('editor');
      setCreated(null);
      return;
    }
    let cancelled = false;
    projectRepository
      .listSharedMembers()
      .then((list) => {
        if (!cancelled) setSharedMembers(list);
      })
      .catch(() => {
        if (!cancelled) setSharedMembers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, projectRepository]);

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

  const hasSharedMembers = sharedMembers !== null && sharedMembers.length > 0;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Пригласить в проект</DialogTitle>
          <DialogDescription>
            Если у получателя есть аккаунт — ему придёт уведомление в системе и письмо на
            email. Иначе — отправь ссылку любым каналом. Срок действия — 7 дней.
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
              {created.email
                ? 'Уведомление и письмо отправлены. Ссылку также можно скопировать и переслать вручную.'
                : 'Это единственная возможность увидеть ссылку. Если потеряешь — отзови приглашение и создай новое.'}
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
              <div className="flex items-center justify-between">
                <Label htmlFor="invite-email">Email</Label>
                {hasSharedMembers && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs">
                        <Users className="size-3.5" />
                        Из знакомых
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="max-h-72 w-64 overflow-y-auto">
                      {sharedMembers!.map((m) => (
                        <DropdownMenuItem key={m.id} onSelect={() => setEmail(m.email)}>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm">{m.displayName}</p>
                            <p className="truncate text-xs text-muted-foreground">{m.email}</p>
                          </div>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
              <Input
                id="invite-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="kolya@example.com"
              />
              <p className="text-xs text-muted-foreground">
                Если email пустой — создастся «бесхозная» ссылка: её можно отправить вручную.
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
                Пригласить
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
