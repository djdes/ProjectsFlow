import { useState } from 'react';
import { CircleCheck, Github } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from '@/components/ui/sonner';
import { useGithubConnection } from '@/presentation/hooks/GithubConnectionProvider';
import { useContainer } from '@/infrastructure/di/container';
import { ConnectGithubDialog } from './ConnectGithubDialog';

/**
 * Полностью самодостаточная секция «GitHub аккаунт» для ProfilePage.
 * Управляет state «подключён / не подключён», открывает device-flow диалог
 * и отвязку.
 */
export function GithubAccountSection(): React.ReactElement {
  const { connection, loading, applyClear } = useGithubConnection();
  const { githubRepository } = useContainer();
  const [connectOpen, setConnectOpen] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const handleDisconnect = async (): Promise<void> => {
    setDisconnecting(true);
    try {
      await githubRepository.disconnect();
      applyClear();
      toast.success('GitHub-аккаунт отвязан');
    } catch {
      toast.error('Не удалось отвязать GitHub');
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Github className="size-4 text-muted-foreground" />
            GitHub
          </CardTitle>
          <CardDescription>
            Подключи свой GitHub, чтобы выбирать репозитории из своего аккаунта и&nbsp;видеть последние коммиты по&nbsp;каждому проекту.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="h-9 w-48 animate-pulse rounded bg-muted" />
          ) : connection ? (
            <div className="flex flex-wrap items-center gap-3 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2">
              <CircleCheck className="size-5 shrink-0 text-emerald-500" />
              <div className="flex-1">
                <p className="text-sm">
                  Подключён как{' '}
                  <a
                    href={`https://github.com/${connection.githubLogin}`}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="font-medium underline-offset-4 hover:underline"
                  >
                    @{connection.githubLogin}
                  </a>
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleDisconnect}
                disabled={disconnecting}
                className="text-muted-foreground hover:text-destructive"
              >
                Отвязать
              </Button>
            </div>
          ) : (
            <Button onClick={() => setConnectOpen(true)} className="gap-2">
              <Github />
              Подключить GitHub
            </Button>
          )}
        </CardContent>
      </Card>

      <ConnectGithubDialog open={connectOpen} onOpenChange={setConnectOpen} />
    </>
  );
}
