import { useState, type FormEvent } from 'react';
import type { AdminUser, AdminUserPatch } from '@/application/admin/AdminRepository';
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

type Props = { user: AdminUser; onClose: () => void; onSaved: () => void };

export function EditUserDialog({ user, onClose, onSaved }: Omit<Props, 'onSaved'> & {
  onSaved: (patch: AdminUserPatch) => void;
}): React.ReactElement {
  const { adminRepository } = useContainer();
  const [displayName, setDisplayName] = useState(user.displayName);
  const [email, setEmail] = useState(user.email);
  const [removeAvatar, setRemoveAvatar] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const save = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (saving) return;
    const patch = { displayName: displayName.trim(), email: email.trim().toLowerCase(),
      ...(removeAvatar ? { avatarUrl: null } : {}) };
    if (!patch.displayName || patch.displayName.length > 80 || patch.email.length > 255
      || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(patch.email)) {
      setError('Укажите имя до 80 символов и корректную почту'); return;
    }
    setSaving(true); setError('');
    try {
      await adminRepository.updateUser(user.id, patch);
      toast.success('Пользователь обновлён'); onSaved(patch);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось сохранить пользователя'); }
    finally { setSaving(false); }
  };
  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent hideClose={saving}>
        <DialogHeader>
          <DialogTitle>Редактировать пользователя</DialogTitle>
          <DialogDescription>Имя, почта для входа и фотография профиля.</DialogDescription>
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
          <DialogDescription>{user.displayName} · {user.email}</DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => void save(event)} className="space-y-4">
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
              <Button type="button" variant="outline" size="sm" onClick={() => {
                setUnlimited(false); setExpiry(localDateTime(new Date(Date.now() + 30 * 86400000)));
              }}>30 дней с сегодняшнего дня</Button>
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

export function DeleteUserDialog({ user, onClose, onSaved }: Props): React.ReactElement {
  const { adminRepository } = useContainer();
  const [confirmation, setConfirmation] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const confirmed = confirmation.trim().toLowerCase() === user.email.toLowerCase();
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
      <DialogContent hideClose={saving}>
        <DialogHeader>
          <DialogTitle>Удалить пользователя?</DialogTitle>
          <DialogDescription>Доступ {user.displayName} будет закрыт, сессии и токены отозваны, профиль обезличен. Проекты и история сохранятся. Отменить удаление нельзя.</DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => void remove(event)} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="admin-delete-email">Для подтверждения введите {user.email}</Label>
            <Input id="admin-delete-email" type="email" autoComplete="off" required value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)} disabled={saving} />
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>Отмена</Button>
            <Button type="submit" variant="destructive" disabled={saving || !confirmed}>{saving ? 'Удаляем…' : 'Удалить пользователя'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
