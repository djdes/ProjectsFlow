import { useEffect, useState, type FormEvent } from 'react';
import type { AdminUser, AdminUserDeletionBlocker, AdminUserDeletionPreview, AdminUserPatch } from '@/application/admin/AdminRepository';
import type { PlanId } from '@/domain/usage/Usage';
import { useContainer } from '@/infrastructure/di/container';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { toast } from '@/components/ui/sonner';
import { planNameRu } from '@/presentation/usage/usageFormat';
import { pluralRu } from '@/presentation/components/admin/mailing/mailingFormat';

type Props = { user: AdminUser; onClose: () => void; onSaved: () => void };

export function EditUserDialog({ user, onClose, onSaved }: Omit<Props, 'onSaved'> & {
  onSaved: (patch: AdminUserPatch) => void;
}): React.ReactElement {
  const { adminRepository } = useContainer();
  const [displayName, setDisplayName] = useState(user.displayName);
  const [email, setEmail] = useState(user.email);
  const [removeAvatar, setRemoveAvatar] = useState(false);
  const [unlinkTelegram, setUnlinkTelegram] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const save = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (saving) return;
    const profile = { displayName: displayName.trim(), email: email.trim().toLowerCase(),
      ...(removeAvatar ? { avatarUrl: null } : {}) };
    const patch = { ...profile, ...(unlinkTelegram ? { telegram: null } : {}) };
    if (!patch.displayName || patch.displayName.length > 80 || patch.email.length > 255
      || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(patch.email)) {
      setError('Укажите имя до 80 символов и корректную почту'); return;
    }
    setSaving(true); setError('');
    try {
      await adminRepository.updateUser(user.id, patch);
      // Only profile fields go back: the caller merges them into the signed-in user.
      toast.success('Пользователь обновлён'); onSaved(profile);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось сохранить пользователя'); }
    finally { setSaving(false); }
  };
  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent hideClose={saving}>
        <DialogHeader>
          <DialogTitle>Редактировать пользователя</DialogTitle>
          <DialogDescription>Имя, почта для входа, фотография профиля и Telegram.</DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => void save(event)} className="space-y-4">
          <fieldset disabled={saving} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="admin-edit-name">Имя</Label>
              <Input id="admin-edit-name" required maxLength={80} value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="admin-edit-email">Почта для входа</Label>
              <Input id="admin-edit-email" type="email" required maxLength={255} value={email} onChange={(event) => setEmail(event.target.value)} />
            </div>
            {user.avatarUrl && <div className="flex items-center gap-2">
              <Checkbox id="admin-remove-avatar" checked={removeAvatar} onCheckedChange={(checked) => setRemoveAvatar(checked === true)} />
              <Label htmlFor="admin-remove-avatar">Удалить фотографию профиля</Label>
            </div>}
            {user.telegramLinked && <div className="flex items-center gap-2">
              <Checkbox id="admin-unlink-telegram" checked={unlinkTelegram} onCheckedChange={(checked) => setUnlinkTelegram(checked === true)} />
              <Label htmlFor="admin-unlink-telegram" className="min-w-0 break-words">
                Отвязать Telegram{user.telegramUsername ? ` @${user.telegramUsername}` : ''}
              </Label>
            </div>}
          </fieldset>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>Отмена</Button>
            <Button type="submit" disabled={saving}>{saving ? 'Сохраняем…' : 'Сохранить'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function localDateTime(value: Date): string {
  return new Date(value.getTime() - value.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

const DAY_MS = 86400000;
const DATE_RU: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' };

// The plan the user has right now, as the admin sees it before changing anything.
function currentPlanLabel(user: Pick<AdminUser, 'plan' | 'subscriptionExpiresAt'>, now = Date.now()): string {
  if (user.plan === 'free') return 'Сейчас: Бесплатный';
  if (!user.subscriptionExpiresAt) return `Сейчас: ${planNameRu(user.plan)}, бессрочно`;
  const expires = new Date(user.subscriptionExpiresAt);
  const date = expires.toLocaleString('ru-RU', DATE_RU);
  if (expires.getTime() <= now) return `Срок ${planNameRu(user.plan)} истёк ${date}`;
  const days = Math.ceil((expires.getTime() - now) / DAY_MS);
  return `Сейчас: ${planNameRu(user.plan)} до ${date} (${days} ${pluralRu(days, 'день', 'дня', 'дней')})`;
}

// Extensions add to the date in the field while it is in the future, otherwise to now.
const EXTENSIONS = [{ days: 7, label: '+7 дней' }, { days: 30, label: '+30 дней' }, { days: 365, label: '+1 год' }] as const;

export function UserPlanDialog({ user, onClose, onSaved }: Props): React.ReactElement {
  const { adminRepository } = useContainer();
  const [plan, setPlan] = useState<PlanId>(user.plan);
  const [unlimited, setUnlimited] = useState(user.plan !== 'free' && user.subscriptionExpiresAt === null);
  const [expiry, setExpiry] = useState(() => localDateTime(user.subscriptionExpiresAt
    ? new Date(user.subscriptionExpiresAt) : new Date(Date.now() + 30 * 86400000)));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const save = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (saving) return;
    const date = new Date(expiry);
    if (plan !== 'free' && !unlimited && (!expiry || !Number.isFinite(date.getTime())
      || date.getTime() < 1000 || date.getTime() > Date.parse('2038-01-19T03:14:07Z'))) {
      setError('Укажите дату окончания до 19 января 2038 года'); return;
    }
    // Preserve the exact original timestamp if the displayed minute has not changed.
    const unchanged = user.subscriptionExpiresAt && localDateTime(new Date(user.subscriptionExpiresAt)) === expiry;
    const expiresAt = plan === 'free' || unlimited ? null : unchanged ? user.subscriptionExpiresAt! : date.toISOString();
    setSaving(true); setError('');
    try {
      await adminRepository.setUserPlan(user.id, plan, expiresAt);
      toast.success('Тариф и срок действия обновлены'); onSaved();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось сохранить тариф'); }
    finally { setSaving(false); }
  };
  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent hideClose={saving}>
        <DialogHeader>
          <DialogTitle>Тариф и срок действия</DialogTitle>
          <DialogDescription className="break-words">{user.displayName} · {user.email}</DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => void save(event)} className="space-y-4">
          <p data-admin-plan-current className="text-sm">{currentPlanLabel(user)}</p>
          <fieldset disabled={saving} className="space-y-4">
            <SegmentedControl value={plan} onChange={setPlan} options={(['free', 'prime', 'vip'] as const).map((value) => ({ value, label: planNameRu(value) }))} />
            {plan === 'free' ? <p className="text-sm text-muted-foreground">Платная подписка будет отключена, срок действия сброшен.</p> : <>
              <div className="flex items-center gap-2">
                <Checkbox id="admin-plan-unlimited" checked={unlimited} onCheckedChange={(checked) => setUnlimited(checked === true)} />
                <Label htmlFor="admin-plan-unlimited">Бессрочно</Label>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="admin-plan-expiry">Дата и время окончания</Label>
                <Input id="admin-plan-expiry" type="datetime-local" required={!unlimited} disabled={unlimited}
                  value={expiry} onChange={(event) => setExpiry(event.target.value)} />
                <p className="text-xs text-muted-foreground">Время указано в часовом поясе вашего устройства. Прошедшая дата завершит подписку.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {EXTENSIONS.map(({ days, label }) => (
                  <Button key={days} type="button" variant="outline" size="sm" onClick={() => {
                    const field = new Date(expiry).getTime();
                    const base = !unlimited && Number.isFinite(field) && field > Date.now() ? field : Date.now();
                    setUnlimited(false); setExpiry(localDateTime(new Date(base + days * DAY_MS)));
                  }}>{label}</Button>
                ))}
                <Button type="button" variant="outline" size="sm" onClick={() => {
                  setUnlimited(false); setExpiry(localDateTime(new Date(Date.now() + 30 * DAY_MS)));
                }}>30 дней с сегодня</Button>
              </div>
            </>}
          </fieldset>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>Отмена</Button>
            <Button type="submit" disabled={saving}>{saving ? 'Сохраняем…' : 'Сохранить'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function blockerText(blocker: AdminUserDeletionBlocker): string {
  if (blocker.kind === 'self') return 'Это ваша учётная запись.';
  if (blocker.kind === 'admin') return 'Пользователь — администратор. Сначала снимите права администратора.';
  return `Пространство «${blocker.name}» (${blocker.members} ${pluralRu(blocker.members, 'участник', 'участника', 'участников')}): `
    + 'назначьте другого владельца в настройках пространства, например через «Войти как».';
}

function DeletionSummary({ preview }: { preview: AdminUserDeletionPreview }): React.ReactElement {
  const workspaces = preview.removedWorkspaces.map((w) => (w.kind === 'default' ? `«${w.name}» (личное)` : `«${w.name}»`));
  return (
    <div data-admin-delete-summary className="space-y-2 text-sm">
      <p className="font-medium">Будет удалено безвозвратно:</p>
      <ul className="list-disc space-y-1 ps-5 text-muted-foreground">
        {workspaces.length > 0 && <li className="break-words">
          {pluralRu(workspaces.length, 'Пространство', 'Пространства', 'Пространства')} {workspaces.join(', ')}
        </li>}
        <li>
          {preview.removedProjects} {pluralRu(preview.removedProjects, 'проект', 'проекта', 'проектов')} с «Входящими»
          {' '}и {preview.removedTasks} {pluralRu(preview.removedTasks, 'задача', 'задачи', 'задач')}
        </li>
        <li>Вход, сессии, токены агентов, GitHub, Telegram, подключения ИИ и уведомления</li>
      </ul>
      {(preview.reassignedTasks > 0 || preview.leftWorkspaces.length > 0) && <>
        <p className="font-medium">Останется у команды:</p>
        <ul className="list-disc space-y-1 ps-5 text-muted-foreground">
          {preview.reassignedTasks > 0 && <li>
            {preview.reassignedTasks} {pluralRu(preview.reassignedTasks, 'задача перейдёт', 'задачи перейдут', 'задач перейдут')} владельцам пространств
          </li>}
          {preview.leftWorkspaces.map((w) => (
            <li key={w.name} className="break-words">«{w.name}» — выход из участников{w.successorName ? `, задачи и проекты получит ${w.successorName}` : ''}</li>
          ))}
        </ul>
      </>}
      <p className="text-xs text-muted-foreground">Комментарии и история останутся с подписью «Удалённый пользователь».</p>
    </div>
  );
}

export function DeleteUserDialog({ user, onClose, onSaved }: Props): React.ReactElement {
  const { adminRepository } = useContainer();
  const [preview, setPreview] = useState<AdminUserDeletionPreview | null>(null);
  const [loadError, setLoadError] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    adminRepository.getUserDeletionPreview(user.id)
      .then((value) => { if (alive) setPreview(value); })
      .catch((reason: unknown) => { if (alive) setLoadError(reason instanceof Error ? reason.message : 'Не удалось подготовить удаление'); });
    return () => { alive = false; };
  }, [adminRepository, user.id]);
  const blocked = !preview || preview.blockers.length > 0;
  const confirmed = !blocked && confirmation.trim().toLowerCase() === user.email.toLowerCase();
  const remove = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (saving || !confirmed) return;
    setSaving(true); setError('');
    try {
      await adminRepository.deleteUser(user.id);
      toast.success('Пользователь удалён'); onSaved();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось удалить пользователя'); }
    finally { setSaving(false); }
  };
  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent hideClose={saving} className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Удалить пользователя?</DialogTitle>
          <DialogDescription className="break-words">{user.displayName} · {user.email}. Отменить удаление нельзя.</DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => void remove(event)} className="space-y-4">
          {!preview && !loadError && <p className="text-sm text-muted-foreground">Считаем, что будет удалено…</p>}
          {loadError && <p role="alert" className="text-sm text-destructive">{loadError}</p>}
          {preview && preview.blockers.length > 0 && (
            <div data-admin-delete-blockers className="space-y-1.5 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">
              <p className="font-medium text-destructive">Удалить пока нельзя</p>
              <ul className="list-disc space-y-1 ps-5">
                {preview.blockers.map((b) => <li key={b.kind === 'owned_workspace' ? b.workspaceId : b.kind} className="break-words">{blockerText(b)}</li>)}
              </ul>
            </div>
          )}
          {preview && preview.blockers.length === 0 && <>
            <DeletionSummary preview={preview} />
            <div className="space-y-1.5">
              <Label htmlFor="admin-delete-email" className="break-words">Для подтверждения введите {user.email}</Label>
              <Input id="admin-delete-email" type="email" autoComplete="off" required value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)} disabled={saving} />
            </div>
          </>}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>{preview && preview.blockers.length > 0 ? 'Понятно' : 'Отмена'}</Button>
            <Button type="submit" variant="destructive" disabled={saving || !confirmed}>{saving ? 'Удаляем…' : 'Удалить пользователя'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
