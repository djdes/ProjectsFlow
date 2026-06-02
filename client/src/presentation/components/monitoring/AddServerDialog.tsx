import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { useContainer } from '@/infrastructure/di/container';
import { HttpError } from '@/lib/HttpError';
import type { MonitoringServer, ServerConfigInput, ServerKind } from '@/domain/monitoring/Server';

// Универсальный диалог: добавление (editServer не задан) или редактирование сервера.
export function AddServerDialog({
  projectId,
  open,
  onOpenChange,
  onSaved,
  editServer,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  editServer?: MonitoringServer;
}): React.ReactElement {
  const { monitoringRepository } = useContainer();
  const isEdit = Boolean(editServer);
  const [kind, setKind] = useState<ServerKind>('remote');
  const [name, setName] = useState('');
  const [host, setHost] = useState('');
  const [sshUser, setSshUser] = useState('');
  const [sshCredentialRef, setSshCredentialRef] = useState('');
  const [pm2Csv, setPm2Csv] = useState('');
  const [nginxAccess, setNginxAccess] = useState('');
  const [nginxError, setNginxError] = useState('');
  const [healthUrl, setHealthUrl] = useState('');
  const [intervalSec, setIntervalSec] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // (Пере)инициализация формы при открытии — из editServer либо пустые поля.
  useEffect(() => {
    if (!open) return;
    setError(null);
    if (editServer) {
      setKind(editServer.kind);
      setName(editServer.name);
      setHost(editServer.host ?? '');
      setSshUser(editServer.sshUser ?? '');
      setSshCredentialRef(editServer.sshCredentialRef ?? '');
      setPm2Csv((editServer.pm2ProcessNames ?? []).join(', '));
      setNginxAccess(editServer.nginxAccessLogPath ?? '');
      setNginxError(editServer.nginxErrorLogPath ?? '');
      setHealthUrl(editServer.healthUrl ?? '');
      setIntervalSec(String(editServer.collectIntervalSeconds));
    } else {
      setKind('remote');
      setName('');
      setHost('');
      setSshUser('');
      setSshCredentialRef('');
      setPm2Csv('');
      setNginxAccess('');
      setNginxError('');
      setHealthUrl('');
      setIntervalSec('');
    }
    // Зависим от id, а не от ссылки editServer: poll каждые 15с отдаёт новый объект,
    // и реакция на саму ссылку затирала бы ввод пользователя прямо во время набора.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editServer?.id]);

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const pm2 = pm2Csv
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const input: ServerConfigInput = {
      name: name.trim(),
      kind,
      host: kind === 'remote' ? host.trim() || null : null,
      sshUser: kind === 'remote' ? sshUser.trim() || null : null,
      sshCredentialRef: kind === 'remote' ? sshCredentialRef.trim() || null : null,
      pm2ProcessNames: pm2.length > 0 ? pm2 : null,
      nginxAccessLogPath: nginxAccess.trim() || null,
      nginxErrorLogPath: nginxError.trim() || null,
      healthUrl: healthUrl.trim() || null,
      collectIntervalSeconds: intervalSec ? Number(intervalSec) : undefined,
    };
    try {
      if (editServer) {
        await monitoringRepository.updateServer(projectId, editServer.id, input);
      } else {
        await monitoringRepository.createServer(projectId, input);
      }
      onSaved();
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof HttpError ? e.body.message ?? e.body.error : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Изменить сервер' : 'Добавить сервер'}</DialogTitle>
          <DialogDescription>
            Local — хост, где работает сам ProjectsFlow (читается напрямую). Remote — удалённый
            сервер, метрики которого собирает агент-сборщик по SSH.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* Тип сервера неизменяем после создания — в режиме правки тоггл заблокирован. */}
          <div className="flex gap-1">
            {(['remote', 'local'] as ServerKind[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => !isEdit && setKind(k)}
                disabled={isEdit}
                aria-pressed={kind === k}
                className={cn(
                  'flex-1 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors',
                  kind === k ? 'border-foreground bg-foreground text-background' : 'border-border text-muted-foreground',
                  isEdit && 'cursor-not-allowed opacity-60',
                )}
              >
                {k === 'remote' ? 'Remote (агент)' : 'Local (этот VPS)'}
              </button>
            ))}
          </div>

          <div className="space-y-1">
            <Label htmlFor="srv-name">Название</Label>
            <Input id="srv-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="prod-web-1" />
          </div>

          {kind === 'remote' && (
            <>
              <div className="space-y-1">
                <Label htmlFor="srv-host">Хост</Label>
                <Input id="srv-host" value={host} onChange={(e) => setHost(e.target.value)} placeholder="example.com" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="srv-user">SSH-пользователь</Label>
                <Input id="srv-user" value={sshUser} onChange={(e) => setSshUser(e.target.value)} placeholder="deploy" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="srv-cred">Ссылка на креды (локально у сборщика)</Label>
                <Input
                  id="srv-cred"
                  value={sshCredentialRef}
                  onChange={(e) => setSshCredentialRef(e.target.value)}
                  placeholder="ssh-config-host или метка ключа"
                />
              </div>
            </>
          )}

          <div className="space-y-1">
            <Label htmlFor="srv-pm2">pm2-процессы (через запятую, пусто = все)</Label>
            <Input id="srv-pm2" value={pm2Csv} onChange={(e) => setPm2Csv(e.target.value)} placeholder="projectsflow" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="srv-health">URL для uptime/SSL-проверки (опц.)</Label>
            <Input
              id="srv-health"
              value={healthUrl}
              onChange={(e) => setHealthUrl(e.target.value)}
              placeholder="https://example.com/api/health"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="srv-nacc">nginx access log</Label>
            <Input
              id="srv-nacc"
              value={nginxAccess}
              onChange={(e) => setNginxAccess(e.target.value)}
              placeholder="/var/log/nginx/access.log"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="srv-nerr">nginx error log</Label>
            <Input
              id="srv-nerr"
              value={nginxError}
              onChange={(e) => setNginxError(e.target.value)}
              placeholder="/var/log/nginx/error.log"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="srv-int">Интервал сбора, сек (пусто = 300)</Label>
            <Input
              id="srv-int"
              type="number"
              min={30}
              step={30}
              value={intervalSec}
              onChange={(e) => setIntervalSec(e.target.value)}
              placeholder="300"
            />
          </div>

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Отмена
          </Button>
          <Button onClick={() => void submit()} disabled={busy || name.trim().length === 0}>
            {isEdit ? 'Сохранить' : 'Добавить'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
