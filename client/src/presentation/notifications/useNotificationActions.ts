import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from '@/components/ui/sonner';
import { HttpError } from '@/lib/HttpError';
import type { Notification } from '@/domain/notifications/Notification';
import { useContainer } from '@/infrastructure/di/container';
import { useUnreadNotificationsCount } from '@/presentation/hooks/useUnreadNotificationsCount';
import { useProjectsContext } from '@/presentation/hooks/ProjectsProvider';
import { NOTIFICATIONS_CHANGED_EVENT } from '@/presentation/hooks/useNotificationStream';

export type DelegationUiState = 'busy' | 'accepted' | 'declined' | 'resolved';

export type NotificationActions = {
  readonly delegationUi: Record<string, DelegationUiState>;
  readonly markRead: (n: Notification) => Promise<void>;
  readonly handleClick: (n: Notification) => void;
  readonly handleAcceptInvite: (n: Notification) => void;
  readonly handleResolveJoin: (n: Notification, accept: boolean) => void;
  readonly handleAcceptDelegation: (n: Notification) => void;
  readonly handleDeclineDelegation: (n: Notification) => void;
};

// Действия над уведомлением (отметить прочитанным, принять/отклонить делегирование/инвайт/
// join-request, навигация по клику). Извлечено из NotificationsPage для переиспользования
// в ленте «Все»/«Требуется действие». opts.patchItem — оптимистичный апдейт строки в списке
// вызывающего; opts.onChanged — сигнал «список изменился» (для рефетча ленты).
export function useNotificationActions(opts?: {
  patchItem?: (id: string, patch: Partial<Notification>) => void;
  onChanged?: () => void;
}): NotificationActions {
  const { notificationRepository, inviteRepository, projectRepository, taskDelegationRepository } =
    useContainer();
  const navigate = useNavigate();
  const { refresh: refreshBadge } = useUnreadNotificationsCount();
  const { applyAppend, refresh: refreshProjects } = useProjectsContext();
  const [delegationUi, setDelegationUi] = useState<Record<string, DelegationUiState>>({});

  const markRead = async (n: Notification): Promise<void> => {
    if (n.readAt !== null) return;
    try {
      await notificationRepository.markRead(n.id);
      opts?.patchItem?.(n.id, { readAt: new Date() });
      window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED_EVENT));
      refreshBadge();
      opts?.onChanged?.();
    } catch (e) {
      toast.error(`Не удалось: ${(e as Error).message}`);
    }
  };

  const handleClick = (n: Notification): void => {
    void (async () => {
      await markRead(n);
      const p = n.payload;
      // Дип-линк к задаче + конкретному комментарию (KanbanBoard ловит ?task=, TaskDrawer — #comment-).
      if (p.type === 'comment_mention')
        navigate(`/projects/${p.projectId}?task=${p.taskId}#comment-${p.commentId}`);
      else if (p.type === 'join_request') navigate(`/projects/${p.projectId}`);
      else if (p.type === 'task_delegation' || p.type === 'task_delegation_resolved') navigate('/inbox');
      else if (p.type === 'task_assigned_to_project') navigate(`/projects/${p.projectId}`);
      else if (p.type === 'server_alert') navigate(`/projects/${p.projectId}/monitoring`);
      else if (p.type === 'daily_digest') navigate(`/projects/${p.projectId}`);
      else if (p.type === 'support_ticket') navigate('/admin?tab=support');
      // project_invite: переход — по кнопке «Принять».
    })();
  };

  const resolveDelegationError = (n: Notification, e: unknown, action: 'accept' | 'decline'): void => {
    if (e instanceof HttpError && e.status === 409) {
      setDelegationUi((s) => ({ ...s, [n.id]: action === 'accept' ? 'accepted' : 'resolved' }));
      void markRead(n);
      toast.success('Это делегирование уже обработано');
      return;
    }
    setDelegationUi((s) => {
      const next = { ...s };
      delete next[n.id];
      return next;
    });
    toast.error(`Не удалось: ${(e as Error).message}`);
  };

  const handleAcceptDelegation = (n: Notification): void => {
    if (n.payload.type !== 'task_delegation' || delegationUi[n.id]) return;
    const { delegationId } = n.payload;
    setDelegationUi((s) => ({ ...s, [n.id]: 'busy' }));
    void (async () => {
      try {
        await taskDelegationRepository.accept(delegationId);
        setDelegationUi((s) => ({ ...s, [n.id]: 'accepted' }));
        await markRead(n);
        refreshProjects();
        toast.success('Задача принята');
      } catch (e) {
        resolveDelegationError(n, e, 'accept');
      }
    })();
  };

  const handleDeclineDelegation = (n: Notification): void => {
    if (n.payload.type !== 'task_delegation' || delegationUi[n.id]) return;
    const { delegationId } = n.payload;
    setDelegationUi((s) => ({ ...s, [n.id]: 'busy' }));
    void (async () => {
      try {
        await taskDelegationRepository.decline(delegationId);
        setDelegationUi((s) => ({ ...s, [n.id]: 'declined' }));
        await markRead(n);
        toast.success('Задача отклонена');
      } catch (e) {
        resolveDelegationError(n, e, 'decline');
      }
    })();
  };

  const handleResolveJoin = (n: Notification, accept: boolean): void => {
    if (n.payload.type !== 'join_request' || delegationUi[n.id]) return;
    const { joinRequestId } = n.payload;
    setDelegationUi((s) => ({ ...s, [n.id]: 'busy' }));
    void (async () => {
      try {
        await projectRepository.resolveJoinRequest(joinRequestId, accept);
        setDelegationUi((s) => ({ ...s, [n.id]: accept ? 'accepted' : 'declined' }));
        await markRead(n);
        toast.success(accept ? 'Доступ предоставлен' : 'Запрос отклонён');
      } catch (e) {
        setDelegationUi((s) => {
          const next = { ...s };
          delete next[n.id];
          return next;
        });
        toast.error(`Не удалось: ${(e as Error).message}`);
      }
    })();
  };

  const handleAcceptInvite = (n: Notification): void => {
    if (n.payload.type !== 'project_invite' || delegationUi[n.id]) return;
    const { token, projectId, projectName } = n.payload;
    setDelegationUi((s) => ({ ...s, [n.id]: 'busy' }));
    void (async () => {
      try {
        await inviteRepository.accept(token);
        // Помечаем принятым сразу — кнопка «Принять» в строке сменяется на «✓ Принято»
        // (иначе уведомление оставалось «как действие» даже после принятия).
        setDelegationUi((s) => ({ ...s, [n.id]: 'accepted' }));
        await markRead(n);
        const project = await projectRepository.getById(projectId).catch(() => null);
        if (project) applyAppend(project);
        toast.success(`Вы присоединились к «${projectName}»`);
        navigate(`/projects/${projectId}`);
      } catch (e) {
        // Инвайт уже использован/недействителен (410 invite_used / 409) → принимать нечего:
        // гасим уведомление (mark read + «Уже обработано»), чтобы оно не висело неактивным
        // действием и не раздувало счётчик. Прочие ошибки (сеть и т.п.) — оставляем кнопку.
        if (e instanceof HttpError && (e.status === 410 || e.status === 409)) {
          setDelegationUi((s) => ({ ...s, [n.id]: 'resolved' }));
          await markRead(n);
          toast.success('Приглашение уже использовано — убрал из действий');
          return;
        }
        setDelegationUi((s) => {
          const next = { ...s };
          delete next[n.id];
          return next;
        });
        toast.error(`Не удалось принять приглашение: ${(e as Error).message}`);
      }
    })();
  };

  return {
    delegationUi,
    markRead,
    handleClick,
    handleAcceptInvite,
    handleResolveJoin,
    handleAcceptDelegation,
    handleDeclineDelegation,
  };
}
