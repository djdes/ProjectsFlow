import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Activity, Monitor, Moon, Sun, User } from 'lucide-react';
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
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from '@/components/ui/sonner';
import { useCurrentUser } from '@/presentation/hooks/useCurrentUser';
import { useUpdateProfile } from '@/presentation/hooks/useUpdateProfile';
import { useContainer } from '@/infrastructure/di/container';
import { useAuth } from '@/presentation/auth/AuthProvider';
import { ViewableAvatar } from '@/presentation/components/user/ViewableAvatar';
import { AvatarCropDialog } from '@/presentation/components/user/AvatarCropDialog';
import { useTheme } from '@/presentation/components/theme/ThemeProvider';
import { useMotion } from '@/presentation/components/motion/MotionProvider';
import { GithubAccountSection } from '@/presentation/components/github/GithubAccountSection';
import { AgentAccessCard } from '@/presentation/components/agent/AgentAccessCard';
import { EmployeesCard } from '@/presentation/components/finance/EmployeesCard';
import { TelegramSection } from '@/presentation/components/profile/TelegramSection';
import { ProjectsShareCard } from '@/presentation/components/profile/ProjectsShareCard';
import { NotificationDefaultsCard } from '@/presentation/components/profile/NotificationDefaultsCard';
import { KanbanColorsCard } from '@/presentation/components/profile/KanbanColorsCard';
import { PlanAndUsageCard } from '@/presentation/components/profile/PlanAndUsageCard';
import { InstallAppPrompt } from '@/presentation/components/pwa/InstallAppPrompt';
import { CompletedStatsCard } from '@/presentation/components/profile/CompletedStatsCard';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SectionPage } from '@/presentation/pages/SectionPage';

function PersonalDataCard(): React.ReactElement {
  const { user, loading } = useCurrentUser();
  const { submit, saving } = useUpdateProfile();
  const { uploadAvatar } = useContainer();
  const { applyUserUpdate } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  // Выбранный файл открывает диалог кадрирования; реальная загрузка — после «Сохранить».
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  // Подтверждение смены email — это логин-идентификатор (UP4).
  const [emailConfirmOpen, setEmailConfirmOpen] = useState(false);

  const handleAvatarFile = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    e.target.value = ''; // позволяем выбрать тот же файл повторно
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Можно загрузить только изображение');
      return;
    }
    setCropFile(file);
  };

  // Кадрированный квадрат (webp) — грузим на сервер. Бросаем ошибку наружу, чтобы диалог
  // остался открытым и показал её тостом; на успех — диалог проиграет галочку.
  const handleCropped = async (blob: Blob): Promise<void> => {
    const cropped = new File([blob], 'avatar.webp', { type: blob.type || 'image/webp' });
    try {
      const updated = await uploadAvatar.execute(cropped);
      applyUserUpdate(updated); // обновляем юзера в AuthContext → аватар везде сразу
    } catch (err) {
      toast.error((err as Error).message ?? 'Не удалось загрузить аватар');
      throw err;
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
          <Skeleton className="h-24" />
        </CardContent>
      </Card>
    );
  }

  const emailChanged = email.trim() !== user.email;
  const dirty = displayName.trim() !== user.displayName || emailChanged;

  const doSave = async (): Promise<void> => {
    try {
      await submit({ displayName, email });
      toast.success('Профиль обновлён');
    } catch {
      toast.error('Не удалось сохранить профиль');
    }
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    // Смена email = смена логина: подтверждаем явно (опечатка → потеря доступа).
    if (emailChanged) {
      setEmailConfirmOpen(true);
      return;
    }
    void doSave();
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
            <ViewableAvatar
              displayName={user.displayName}
              avatarUrl={user.avatarUrl}
              className="size-12 text-base"
            />
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleAvatarFile}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileRef.current?.click()}
            >
              Загрузить аватар
            </Button>
          </div>

          {cropFile && (
            <AvatarCropDialog
              file={cropFile}
              onConfirm={handleCropped}
              onClose={() => setCropFile(null)}
            />
          )}

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
            <Button type="submit" disabled={saving || !dirty}>
              {saving ? 'Сохраняем…' : 'Сохранить'}
            </Button>
          </div>
        </form>
      </CardContent>

      <Dialog open={emailConfirmOpen} onOpenChange={setEmailConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Сменить email для входа?</DialogTitle>
            <DialogDescription>
              Вы меняете email входа с{' '}
              <span className="font-medium text-foreground">{user.email}</span> на{' '}
              <span className="font-medium text-foreground">{email.trim()}</span>. Убедитесь, что
              адрес верный — по нему выполняется вход.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEmailConfirmOpen(false)} disabled={saving}>
              Отмена
            </Button>
            <Button
              onClick={() => {
                setEmailConfirmOpen(false);
                void doSave();
              }}
              disabled={saving}
            >
              Сменить email
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function SecurityCard(): React.ReactElement {
  // Честная заглушка (U2): реального backend смены пароля пока нет. Раньше здесь была
  // рабочая на вид форма с autocomplete="new-password" — менеджеры паролей предлагали
  // сохранить «новый пароль», который никуда не записывался (потеря доступа). Никаких
  // полей ввода пароля до появления reset/change-flow.
  return (
    <Card>
      <CardHeader>
        <CardTitle>Безопасность</CardTitle>
        <CardDescription>Смена пароля прямо в интерфейсе — скоро.</CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          Самостоятельная смена пароля пока недоступна. Если нужно сменить пароль или вы
          потеряли доступ — напишите в поддержку, поможем восстановить.
        </p>
      </CardContent>
    </Card>
  );
}

const THEME_OPTIONS = [
  { value: 'light', label: 'Светлая', icon: <Sun className="size-4" /> },
  { value: 'dark', label: 'Тёмная', icon: <Moon className="size-4" /> },
  { value: 'system', label: 'Система', icon: <Monitor className="size-4" /> },
] as const;

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
          {/* Общий переключатель вида (SegmentedControl) — тот же, что в остальных местах;
              сетка из трёх равных колонок, чтобы сегменты были одного размера. */}
          <SegmentedControl
            className="grid w-full grid-cols-3 sm:max-w-md"
            value={theme}
            onChange={setTheme}
            options={THEME_OPTIONS}
          />
        </div>

        <div className="flex items-start justify-between gap-4 sm:max-w-md">
          <div className="space-y-1">
            <div className="text-sm font-medium leading-none">Плавные анимации</div>
            <p className="text-sm text-muted-foreground">
              Переходы, вкладки и отклик на действия. Включены по умолчанию.
              Учитываем настройку уменьшения движения на вашем устройстве.
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
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') === 'stats' ? 'stats' : 'settings';
  const handleTabChange = (next: string): void => {
    // replace: переключение вкладок не должно засорять историю браузера.
    setSearchParams(next === 'stats' ? { tab: 'stats' } : {}, { replace: true });
  };

  return (
    <SectionPage icon={User} label="Профиль" back={{ to: '/', label: 'Назад к\u00a0проектам' }} narrow>
      {/* Вкладка запоминается в адресе (?tab=stats): по ссылке на статистику попадаешь
          сразу в неё, а «назад» в браузере возвращает на настройки, а не на другую страницу. */}
      <Tabs value={tab} onValueChange={handleTabChange}>
        <TabsList>
          <TabsTrigger value="settings">Настройки</TabsTrigger>
          <TabsTrigger value="stats">Статистика</TabsTrigger>
        </TabsList>

        <TabsContent value="stats" className="mbs-5 space-y-5">
          <CompletedStatsCard />
        </TabsContent>

        <TabsContent value="settings" className="mbs-5 space-y-5">
          <PersonalDataCard />
          <PlanAndUsageCard />
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
        </TabsContent>
      </Tabs>
    </SectionPage>
  );
}
