import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Activity, ArrowLeft, Monitor, Moon, Sun } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/sonner';
import { useCurrentUser } from '@/presentation/hooks/useCurrentUser';
import { useUpdateProfile } from '@/presentation/hooks/useUpdateProfile';
import { useContainer } from '@/infrastructure/di/container';
import { useAuth } from '@/presentation/auth/AuthProvider';
import { UserAvatar } from '@/presentation/components/user/UserAvatar';
import { useTheme } from '@/presentation/components/theme/ThemeProvider';
import { useMotion } from '@/presentation/components/motion/MotionProvider';
import { GithubAccountSection } from '@/presentation/components/github/GithubAccountSection';
import { AgentAccessCard } from '@/presentation/components/agent/AgentAccessCard';
import { EmployeesCard } from '@/presentation/components/finance/EmployeesCard';
import { TelegramSection } from '@/presentation/components/profile/TelegramSection';
import { ProjectsShareCard } from '@/presentation/components/profile/ProjectsShareCard';
import { NotificationDefaultsCard } from '@/presentation/components/profile/NotificationDefaultsCard';
import { KanbanColorsCard } from '@/presentation/components/profile/KanbanColorsCard';
import { InstallAppPrompt } from '@/presentation/components/pwa/InstallAppPrompt';

function PersonalDataCard(): React.ReactElement {
  const { user, loading } = useCurrentUser();
  const { submit, saving } = useUpdateProfile();
  const { uploadAvatar } = useContainer();
  const { applyUserUpdate } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');

  const handleAvatarFile = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    e.target.value = ''; // позволяем выбрать тот же файл повторно
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Можно загрузить только изображение');
      return;
    }
    setUploadingAvatar(true);
    try {
      const updated = await uploadAvatar.execute(file);
      applyUserUpdate(updated); // обновляем юзера в AuthContext → аватар везде сразу
      toast.success('Аватар обновлён');
    } catch (err) {
      toast.error((err as Error).message ?? 'Не&nbsp;удалось загрузить аватар');
    } finally {
      setUploadingAvatar(false);
    }
  };

  useEffect(() => {
    if (user) {
      setDisplayName(user.displayName);
      setEmail(user.email);
    }
  }, [user]);

  if (loading || !user) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Личные данные</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-24 animate-pulse rounded bg-muted" />
        </CardContent>
      </Card>
    );
  }

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    try {
      await submit({ displayName, email });
      toast.success('Профиль обновлён');
    } catch {
      toast.error('Не&nbsp;удалось сохранить профиль');
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Личные данные</CardTitle>
        <CardDescription>
          Имя видно в&nbsp;сайдбаре. Email пока используется только как идентификатор.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex items-center gap-4">
            <UserAvatar
              displayName={user.displayName}
              avatarUrl={user.avatarUrl}
              className="size-12 text-base"
            />
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => void handleAvatarFile(e)}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={uploadingAvatar}
              onClick={() => fileRef.current?.click()}
            >
              {uploadingAvatar ? 'Загрузка…' : 'Загрузить аватар'}
            </Button>
          </div>

          <div className="space-y-2">
            <Label htmlFor="displayName">Имя</Label>
            <Input
              id="displayName"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              autoComplete="name"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </div>

          <div className="flex justify-end">
            <Button type="submit" disabled={saving}>
              {saving ? 'Сохраняем…' : 'Сохранить'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function SecurityCard(): React.ReactElement {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    toast('Backend для смены пароля будет добавлен в&nbsp;auth-спеке (Spec #3).');
    setCurrent('');
    setNext('');
    setConfirm('');
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Безопасность</CardTitle>
        <CardDescription>
          В&nbsp;этой спеке пароль не&nbsp;сохраняется — кнопка покажет toast.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="currentPassword">Текущий пароль</Label>
            <Input
              id="currentPassword"
              type="password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              autoComplete="current-password"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="newPassword">Новый пароль</Label>
            <Input
              id="newPassword"
              type="password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              autoComplete="new-password"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Подтверждение</Label>
            <Input
              id="confirmPassword"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
            />
          </div>
          <div className="flex justify-end">
            <Button type="submit" variant="outline">
              Сменить пароль
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function PreferencesCard(): React.ReactElement {
  const { theme, setTheme } = useTheme();
  const { animations, setAnimations } = useMotion();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Преференсы</CardTitle>
        <CardDescription>Выбор сохраняется локально в&nbsp;этом браузере.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-3">
          <Label>Тема</Label>
          {/* Сегмент-контрол вместо card-radio: одинаковые по размеру кнопки, единый
              визуальный язык с остальными переключателями. */}
          <div className="inline-flex w-full rounded-lg bg-muted p-0.5 sm:max-w-md">
            {(['light', 'dark', 'system'] as const).map((value) => {
              const Icon = value === 'light' ? Sun : value === 'dark' ? Moon : Monitor;
              const active = theme === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setTheme(value)}
                  aria-pressed={active}
                  className={cn(
                    'flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                    active
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <Icon className="size-4" />
                  {value === 'light' ? 'Светлая' : value === 'dark' ? 'Тёмная' : 'Система'}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-start justify-between gap-4 sm:max-w-md">
          <div className="space-y-1">
            <div className="text-sm font-medium leading-none">Анимация</div>
            <p className="text-sm text-muted-foreground">
              Выключите, если интерфейс подтормаживает — например, при работе через RDP
              или удалённый рабочий стол.
            </p>
          </div>
          <Switch
            checked={animations}
            onCheckedChange={setAnimations}
            aria-label="Анимация интерфейса"
          />
        </div>
      </CardContent>
    </Card>
  );
}

function MonitoringCard(): React.ReactElement {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Мониторинг</CardTitle>
        <CardDescription>Состояние серверов и здоровье инфраструктуры.</CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild variant="outline" className="gap-2">
          <Link to="/monitoring">
            <Activity className="size-4" />
            Открыть мониторинг
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

export function ProfilePage(): React.ReactElement {
  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 px-4 pb-12 pt-3.5 sm:px-6">
      <Button asChild variant="ghost" size="sm" className="-ml-3 gap-1">
        <Link to="/">
          <ArrowLeft />
          Назад к&nbsp;проектам
        </Link>
      </Button>

      <h1 className="text-xl font-semibold tracking-tight">Настройки</h1>

      <PersonalDataCard />
      <ProjectsShareCard />
      <EmployeesCard />
      <NotificationDefaultsCard />
      <KanbanColorsCard />
      <TelegramSection />
      <GithubAccountSection />
      <AgentAccessCard />
      <SecurityCard />
      <PreferencesCard />
      <MonitoringCard />
      <InstallAppPrompt variant="card" />
    </div>
  );
}
