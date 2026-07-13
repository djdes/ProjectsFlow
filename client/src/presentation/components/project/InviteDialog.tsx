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
import type { WorkspaceInvite, WorkspaceInviteRole } from '@/domain/workspace/WorkspaceInvite';
import type { SharedMember } from '@/application/project/ProjectRepository';
import { useContainer } from '@/infrastructure/di/container';
import { useCurrentWorkspace } from '@/presentation/hooks/useCurrentWorkspace';

type Props = {
  open: boolean;
  onClose: () => void;
  // Пространство, в которое приглашаем. Не задано — активное пространство юзера
  // (кейс «пригласить из проекта»: проект живёт в текущем пространстве).
  workspaceId?: string;
  onCreated?: (invite: WorkspaceInvite) => void;
};

// Диалог приглашения в ПРОСТРАНСТВО (единая точка: из настроек пространства, со страницы
// проекта, из панели участников). Приглашённый получает доступ ко всем проектам
// пространства, включая будущие. Роль editor/viewer, email опционален (без email —
// «бесхозная» токен-ссылка).
export function InviteDialog({ open, onClose, workspaceId, onCreated }: Props): React.ReactElement {
  const { workspaceRepository, projectRepository } = useContainer();
  const { workspace } = useCurrentWorkspace();
  const targetWorkspaceId = workspaceId ?? workspace?.id ?? null;
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<WorkspaceInviteRole>('editor');
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<WorkspaceInvite | null>(null);
  // Люди, с которыми caller уже состоит в общих пространствах — выбор одним кликом.
  const [sharedMembers, setSharedMembers] = useState<SharedMember[] | null>(null);

  useEffect(() => {
    if (!open) {
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
    if (!targetWorkspaceId) {
      toast.error('Пространство ещё не загружено — попробуйте ещё раз');
      return;
    }
    setSubmitting(true);
    try {
      const invite = await workspaceRepository.createInvite(targetWorkspaceId, {
        role,
        email: email.trim().length > 0 ? email.trim() : null,
      });
      setCreated(invite);
      onCreated?.(invite);
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
          <DialogTitle>Пригласить в пространство</DialogTitle>
          <DialogDescription>
            Участник получит доступ ко всем проектам пространства, включая будущие. Если у
            получателя есть аккаунт — придёт уведомление и письмо; иначе отправь ссылку любым
            каналом. Срок действия — 7 дней.
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
                  ? 'Редактор: создаёт/правит задачи, комментарии, KB во всех проектах пространства. Не управляет командой.'
                  : 'Наблюдатель: только смотрит проекты пространства. Может оставлять комментарии.'}
              </p>
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
                Отмена
              </Button>
              <Button type="submit" disabled={submitting || !targetWorkspaceId}>
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
