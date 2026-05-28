import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { toast } from '@/components/ui/sonner';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useCurrentUser } from '@/presentation/hooks/useCurrentUser';
import { useUpdateProfile } from '@/presentation/hooks/useUpdateProfile';
import { useTheme, type Theme } from '@/presentation/components/theme/ThemeProvider';
import { GithubAccountSection } from '@/presentation/components/github/GithubAccountSection';
import { AgentAccessCard } from '@/presentation/components/agent/AgentAccessCard';
import { EmployeesCard } from '@/presentation/components/finance/EmployeesCard';
import { TelegramSection } from '@/presentation/components/profile/TelegramSection';
import { ProjectsShareCard } from '@/presentation/components/profile/ProjectsShareCard';
import { getInitials } from '@/presentation/layout/projectIcons';

function PersonalDataCard(): React.ReactElement {
  const { user, loading } = useCurrentUser();
  const { submit, saving } = useUpdateProfile();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');

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
            <Avatar className="size-12">
              <AvatarFallback>{getInitials(user.displayName)}</AvatarFallback>
            </Avatar>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span tabIndex={0}>
                    <Button type="button" variant="outline" size="sm" disabled>
                      Загрузить аватар
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  Появится в&nbsp;Spec #3 (auth)
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
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
  return (
    <Card>
      <CardHeader>
        <CardTitle>Преференсы</CardTitle>
        <CardDescription>Выбор сохраняется локально в&nbsp;этом браузере.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          <Label>Тема</Label>
          <RadioGroup
            value={theme}
            onValueChange={(v) => setTheme(v as Theme)}
            className="grid grid-cols-3 gap-2 sm:max-w-md"
          >
            {(['light', 'dark', 'system'] as const).map((value) => (
              <Label
                key={value}
                htmlFor={`theme-${value}`}
                className="flex cursor-pointer items-center gap-2 rounded-md border bg-card p-3 text-sm transition-colors has-[:checked]:border-primary has-[:checked]:bg-accent"
              >
                <RadioGroupItem id={`theme-${value}`} value={value} />
                <span className="font-normal">
                  {value === 'light' ? 'Светлая' : value === 'dark' ? 'Тёмная' : 'Система'}
                </span>
              </Label>
            ))}
          </RadioGroup>
        </div>
      </CardContent>
    </Card>
  );
}

export function ProfilePage(): React.ReactElement {
  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <Button asChild variant="ghost" size="sm" className="-ml-3 gap-1">
        <Link to="/">
          <ArrowLeft />
          Назад к&nbsp;проектам
        </Link>
      </Button>

      <h1 className="text-3xl font-semibold tracking-tight">Профиль</h1>

      <PersonalDataCard />
      <ProjectsShareCard />
      <EmployeesCard />
      <TelegramSection />
      <GithubAccountSection />
      <AgentAccessCard />
      <SecurityCard />
      <PreferencesCard />
    </div>
  );
}
