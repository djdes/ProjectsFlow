import type { EmailMessage } from '../notifications/EmailSender.js';
import { renderInviteEmail } from '../notifications/emails/inviteEmail.js';
import { renderActivityEmail } from '../notifications/emails/activityEmail.js';
import { renderDelegationEmail } from '../notifications/emails/delegationEmail.js';
import { renderDelegationDeclinedEmail } from '../notifications/emails/delegationDeclinedEmail.js';
import { renderProjectDeletedEmail } from '../notifications/emails/projectDeletedEmail.js';
import { renderJoinRequestEmail } from '../notifications/emails/joinRequestEmail.js';
import { renderTaskAssignedToProjectEmail } from '../notifications/emails/taskAssignedToProjectEmail.js';

// Все шаблоны email-ов, зарегистрированные в системе. Используется admin-страницей
// для предпросмотра и тестовой отправки.
export type EmailTemplateKey =
  | 'invite'
  | 'activity_task_created'
  | 'activity_task_done'
  | 'activity_comment_created'
  | 'activity_member_changed'
  | 'activity_commit_linked'
  | 'activity_kb_updated'
  | 'delegation'
  | 'delegation_declined'
  | 'project_deleted'
  | 'join_request'
  | 'task_assigned_to_project';

export type EmailTemplateMeta = {
  readonly key: EmailTemplateKey;
  readonly label: string;
  readonly description: string;
};

const SAMPLE_URL = 'https://projectsflow.ru/projects/demo-123';

export const EMAIL_TEMPLATES: readonly EmailTemplateMeta[] = [
  { key: 'invite', label: 'Приглашение в проект', description: 'Письмо с приглашением в проект как редактор/наблюдатель' },
  { key: 'activity_task_created', label: 'Новая задача', description: 'Уведомление о создании задачи в проекте' },
  { key: 'activity_task_done', label: 'Задача выполнена', description: 'Уведомление о переносе задачи в «Готово»' },
  { key: 'activity_comment_created', label: 'Новый комментарий', description: 'Уведомление о новом комментарии к задаче' },
  { key: 'activity_member_changed', label: 'Изменение в команде', description: 'Уведомление об изменениях в составе команды' },
  { key: 'activity_commit_linked', label: 'Привязан коммит', description: 'Уведомление о привязке коммита к задаче' },
  { key: 'activity_kb_updated', label: 'Обновление базы знаний', description: 'Уведомление об обновлении KB проекта' },
  { key: 'delegation', label: 'Делегирование задачи', description: 'Письмо о делегировании задачи другому пользователю' },
  { key: 'delegation_declined', label: 'Делегирование отклонено', description: 'Письмо об отклонении делегированной задачи' },
  { key: 'project_deleted', label: 'Проект удалён', description: 'Уведомление об удалении проекта' },
  { key: 'join_request', label: 'Запрос доступа', description: 'Письмо владельцу о запросе доступа к проекту' },
  { key: 'task_assigned_to_project', label: 'Задача перенесена в проект', description: 'Письмо делегату о переносе задачи в проект' },
];

// Рендерит email-шаблон с демо-данными для предпросмотра.
export function renderSampleEmail(key: EmailTemplateKey, to: string): EmailMessage {
  switch (key) {
    case 'invite':
      return renderInviteEmail({
        to,
        projectName: 'Мой Проект',
        actorDisplayName: 'Иван Петров',
        role: 'editor',
        acceptUrl: SAMPLE_URL,
      });
    case 'activity_task_created':
      return renderActivityEmail({
        to,
        type: 'task_created',
        projectName: 'Мой Проект',
        actorDisplayName: 'Иван Петров',
        taskExcerpt: 'Реализовать авторизацию через OAuth 2.0',
        ctaUrl: SAMPLE_URL,
      });
    case 'activity_task_done':
      return renderActivityEmail({
        to,
        type: 'task_done',
        projectName: 'Мой Проект',
        actorDisplayName: 'Анна Смирнова',
        taskExcerpt: 'Настроить CI/CD пайплайн для деплоя',
        ctaUrl: SAMPLE_URL,
      });
    case 'activity_comment_created':
      return renderActivityEmail({
        to,
        type: 'comment_created',
        projectName: 'Мой Проект',
        actorDisplayName: 'Дмитрий Козлов',
        taskExcerpt: 'Добавить тёмную тему',
        commentExcerpt: 'Сделал прототип, посмотрите скриншоты в аттаче. Нужна обратная связь по цветовой палитре.',
        ctaUrl: SAMPLE_URL,
      });
    case 'activity_member_changed':
      return renderActivityEmail({
        to,
        type: 'member_changed',
        projectName: 'Мой Проект',
        actorDisplayName: 'Иван Петров',
        detail: 'добавил Анну Смирнову как редактора',
        ctaUrl: SAMPLE_URL,
      });
    case 'activity_commit_linked':
      return renderActivityEmail({
        to,
        type: 'commit_linked',
        projectName: 'Мой Проект',
        actorDisplayName: 'Дмитрий Козлов',
        taskExcerpt: 'Исправить баг с пагинацией списка задач',
        ctaUrl: SAMPLE_URL,
      });
    case 'activity_kb_updated':
      return renderActivityEmail({
        to,
        type: 'kb_updated',
        projectName: 'Мой Проект',
        actorDisplayName: 'Анна Смирнова',
        detail: 'обновила документ «Архитектура API»',
        ctaUrl: SAMPLE_URL,
      });
    case 'delegation':
      return renderDelegationEmail({
        to,
        actorDisplayName: 'Иван Петров',
        taskExcerpt: 'Подготовить макеты для нового дашборда аналитики',
        inboxUrl: SAMPLE_URL,
      });
    case 'delegation_declined':
      return renderDelegationDeclinedEmail({
        to,
        delegateDisplayName: 'Анна Смирнова',
        taskExcerpt: 'Подготовить макеты для нового дашборда аналитики',
        inboxUrl: SAMPLE_URL,
      });
    case 'project_deleted':
      return renderProjectDeletedEmail({
        to,
        projectName: 'Архивный Проект',
        actorDisplayName: 'Иван Петров',
        appUrl: 'https://projectsflow.ru',
      });
    case 'join_request':
      return renderJoinRequestEmail({
        to,
        projectName: 'Мой Проект',
        requesterDisplayName: 'Новый Коллега',
        projectUrl: SAMPLE_URL,
      });
    case 'task_assigned_to_project':
      return renderTaskAssignedToProjectEmail({
        to,
        actorDisplayName: 'Иван Петров',
        taskExcerpt: 'Подготовить макеты для нового дашборда аналитики',
        projectName: 'Мой Проект',
        projectUrl: SAMPLE_URL,
      });
  }
}
