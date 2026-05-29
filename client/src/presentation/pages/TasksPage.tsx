import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { BookOpen, ChevronRight, Settings, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useProject } from '@/presentation/hooks/useProject';
import { useContainer } from '@/infrastructure/di/container';
import { KanbanBoard } from '@/presentation/components/tasks/KanbanBoard';

export function TasksPage(): React.ReactElement {
  const { projectId } = useParams<{ projectId: string }>();
  const { data, loading, notFound } = useProject(projectId ?? '');
  const { projectFinanceRepository } = useContainer();
  // Гейт видимости кнопки «Финансы»: дёргаем summary только чтобы проверить доступ.
  // Сумму больше не показываем (раньше был чип в шапке), сам блок Доход/Расход/Прибыль
  // живёт на странице /finance.
  const [financeVisible, setFinanceVisible] = useState(false);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    projectFinanceRepository
      .getSummary(projectId)
      .then(() => { if (!cancelled) setFinanceVisible(true); })
      .catch(() => { /* нет доступа — кнопку не показываем */ });
    return () => { cancelled = true; };
  }, [projectId, projectFinanceRepository]);

  if (loading) {
    return (
      <div className="space-y-4 p-6">
        <div className="h-3 w-48 animate-pulse rounded bg-muted" />
        <div className="h-8 w-64 animate-pulse rounded bg-muted" />
      </div>
    );
  }

  if (notFound || !data) {
    return (
      <div className="grid h-full place-items-center p-6">
        <div className="max-w-md space-y-4 text-center">
          <h1 className="text-2xl font-semibold">Проект не&nbsp;найден</h1>
          <Button asChild variant="outline">
            <Link to="/">На&nbsp;главную</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4 p-4 sm:gap-6 sm:p-6">
      <nav className="flex items-center gap-1 text-sm text-muted-foreground" aria-label="Хлебные крошки">
        <Link to="/" className="hover:text-foreground">
          Проекты
        </Link>
        <ChevronRight className="size-4" />
        <span className="text-foreground">{data.name}</span>
      </nav>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">Задачи</h1>
        <div className="flex flex-wrap items-center gap-2">
          {financeVisible && (
            <Button asChild variant="outline" size="sm">
              <Link to={`/projects/${data.id}/finance`}>
                <Wallet className="size-4" />
                Финансы
              </Link>
            </Button>
          )}
          <Button asChild variant="outline" size="sm">
            <Link to={`/projects/${data.id}/kb`}>
              <BookOpen className="size-4" />
              База знаний
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to={`/projects/${data.id}/overview`}>
              <Settings className="size-4" />
              Настройки
            </Link>
          </Button>
        </div>
      </div>

      <KanbanBoard projectId={data.id} projectName={data.name} memberCount={data.memberCount} />
    </div>
  );
}
