import { useState, type ReactNode } from 'react';
import { toast } from '@/components/ui/sonner';
import type { AdminUser } from '@/application/admin/AdminRepository';
import { useContainer } from '@/infrastructure/di/container';
import { useAuth } from '@/presentation/auth/AuthProvider';
import { AdminUserDispatchersDialog } from '@/presentation/components/admin/AdminUserDispatchersDialog';
import { DeleteUserDialog, EditUserDialog, UserPlanDialog } from '@/presentation/components/admin/AdminUserDialogs';
import { AdminConfirmDialog } from './AdminUserActionDialogs';

export type AdminUserActions = {
  readonly edit: (u: AdminUser) => void;
  readonly plan: (u: AdminUser) => void;
  readonly remove: (u: AdminUser) => void;
  readonly dispatchers: (u: AdminUser) => void;
  readonly toggleAdmin: (u: AdminUser) => void;
  readonly impersonate: (u: AdminUser) => void;
  readonly signOutAll: (u: AdminUser) => void;
  readonly sendPasswordReset: (u: AdminUser) => void;
  readonly impersonating: string | null;
  readonly isSelf: (u: AdminUser) => boolean;
};

type Open =
  | { kind: 'edit' | 'plan' | 'delete' | 'dispatchers' | 'admin' | 'signout' | 'reset'; user: AdminUser }
  | null;

// One place for every per-user action of the console: the row menu and the user panel open
// the same dialogs. Destructive or wide actions always go through a confirmation.
export function useAdminUserActions({
  onChanged,
  onDeleted,
}: {
  onChanged: () => void;
  onDeleted: (u: AdminUser) => void;
}): { actions: AdminUserActions; dialogs: ReactNode } {
  const { adminRepository, authRepository } = useContainer();
  const { user: me, applyUserUpdate } = useAuth();
  const [open, setOpen] = useState<Open>(null);
  const [impersonating, setImpersonating] = useState<string | null>(null);
  const close = (): void => setOpen(null);
  const isSelf = (u: AdminUser): boolean => u.id === me?.id;

  // The server switches the cookie; a full reload makes every cache the user's own.
  const impersonate = (u: AdminUser): void => {
    if (isSelf(u) || impersonating) return;
    setImpersonating(u.id);
    authRepository.startImpersonation(u.id)
      .then(() => window.location.assign('/'))
      .catch((e: unknown) => {
        setImpersonating(null);
        toast.error(e instanceof Error ? e.message : 'Не удалось войти от имени пользователя');
      });
  };

  const actions: AdminUserActions = {
    edit: (user) => setOpen({ kind: 'edit', user }),
    plan: (user) => setOpen({ kind: 'plan', user }),
    remove: (user) => setOpen({ kind: 'delete', user }),
    dispatchers: (user) => setOpen({ kind: 'dispatchers', user }),
    toggleAdmin: (user) => setOpen({ kind: 'admin', user }),
    signOutAll: (user) => setOpen({ kind: 'signout', user }),
    sendPasswordReset: (user) => setOpen({ kind: 'reset', user }),
    impersonate,
    impersonating,
    isSelf,
  };

  let dialogs: ReactNode = null;
  if (open) {
    const u = open.user;
    const who = <><strong className="font-medium text-foreground">{u.displayName}</strong> ({u.email})</>;
    switch (open.kind) {
      case 'edit':
        dialogs = <EditUserDialog user={u} onClose={close} onSaved={(patch) => {
          if (me?.id === u.id) applyUserUpdate({ ...me, ...patch });
          close(); onChanged();
        }} />;
        break;
      case 'plan':
        dialogs = <UserPlanDialog user={u} onClose={close} onSaved={() => { close(); onChanged(); }} />;
        break;
      case 'delete':
        dialogs = <DeleteUserDialog user={u} onClose={close} onSaved={() => { close(); onDeleted(u); }} />;
        break;
      case 'dispatchers':
        dialogs = <AdminUserDispatchersDialog user={u} onClose={close} />;
        break;
      case 'admin':
        dialogs = (
          <AdminConfirmDialog
            title={u.isAdmin ? 'Снять права администратора?' : 'Сделать администратором?'}
            description={u.isAdmin
              ? <>{who} потеряет доступ к администрированию и чужим проектам.</>
              : <>{who} получит доступ к администрированию, всем пользователям и всем проектам платформы.</>}
            confirmLabel={u.isAdmin ? 'Снять права' : 'Назначить'}
            destructive={u.isAdmin}
            onConfirm={async () => {
              await adminRepository.updateUser(u.id, { isAdmin: !u.isAdmin });
              toast.success(u.isAdmin ? 'Права администратора сняты' : 'Назначен администратором');
              onChanged();
            }}
            onClose={close}
          />
        );
        break;
      case 'signout':
        dialogs = (
          <AdminConfirmDialog
            title="Завершить все сессии?"
            description={<>{who} выйдет из аккаунта на всех устройствах и войдёт заново по паролю. Токены агентов (Ralph, MCP) продолжат работать.</>}
            confirmLabel="Завершить сессии"
            destructive
            onConfirm={async () => {
              await adminRepository.signOutEverywhere(u.id);
              toast.success('Все сессии завершены');
              onChanged();
            }}
            onClose={close}
          />
        );
        break;
      case 'reset':
        dialogs = (
          <AdminConfirmDialog
            title="Отправить ссылку для смены пароля?"
            description={<>Письмо со ссылкой придёт на {u.email}. Ссылка действует час, прежние ссылки перестанут работать. Текущий пароль останется, пока пользователь его не сменит.</>}
            confirmLabel="Отправить письмо"
            onConfirm={async () => {
              const { email } = await adminRepository.sendPasswordReset(u.id);
              toast.success(`Ссылка отправлена на ${email}`);
              onChanged();
            }}
            onClose={close}
          />
        );
        break;
    }
  }
  return { actions, dialogs };
}
