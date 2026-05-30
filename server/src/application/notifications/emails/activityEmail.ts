import type { EmailMessage } from '../EmailSender.js';
import type { NotifEventType } from '../../../domain/notifications/NotificationPrefs.js';
import { escapeHtml, renderEmailLayout } from './layout.js';

export type ActivityEmailInput = {
  readonly to: string;
  readonly type: NotifEventType;
  readonly projectName: string;
  readonly actorDisplayName: string;
  // Контекст события (любой текст; обрезается и экранируется внутри). Опционален.
  readonly taskExcerpt?: string;
  readonly commentExcerpt?: string;
  readonly detail?: string;
  // Куда ведёт CTA-кнопка (обычно на задачу).
  readonly ctaUrl: string;
  readonly ctaLabel?: string;
};

function clip(s: string, max = 140): string {
  const t = s.trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

// Письмо об активности в проекте. Всё user-содержимое экранируется (layout экранирует
// heading/ctaLabel; excerpt'ы экранируем здесь, т.к. кладём в bodyHtml как HTML).
export function renderActivityEmail(input: ActivityEmailInput): EmailMessage {
  const project = escapeHtml(input.projectName);
  const actor = escapeHtml(input.actorDisplayName);
  const task = input.taskExcerpt ? escapeHtml(clip(input.taskExcerpt)) : '';
  const comment = input.commentExcerpt ? escapeHtml(clip(input.commentExcerpt)) : '';
  const detail = input.detail ? escapeHtml(clip(input.detail)) : '';

  let heading: string;
  let subject: string;
  let bodyHtml: string;
  let text: string;

  switch (input.type) {
    case 'task_created':
      heading = 'Новая задача';
      subject = `Новая задача в «${input.projectName}»`;
      bodyHtml = `<strong>${actor}</strong> создал задачу в проекте <strong>«${project}»</strong>:<br/><span style="color:#0f172a;">${task}</span>`;
      text = `${input.actorDisplayName} создал задачу в «${input.projectName}»: ${clip(input.taskExcerpt ?? '')}`;
      break;
    case 'task_done':
      heading = 'Задача выполнена';
      subject = `Задача выполнена в «${input.projectName}»`;
      bodyHtml = `<strong>${actor}</strong> перенёс задачу в «Готово» в проекте <strong>«${project}»</strong>:<br/><span style="color:#0f172a;">${task}</span>`;
      text = `${input.actorDisplayName} завершил задачу в «${input.projectName}»: ${clip(input.taskExcerpt ?? '')}`;
      break;
    case 'comment_created':
      heading = 'Новый комментарий';
      subject = `Новый комментарий в «${input.projectName}»`;
      bodyHtml = `<strong>${actor}</strong> прокомментировал задачу <span style="color:#0f172a;">${task}</span> в проекте <strong>«${project}»</strong>:<br/><span style="color:#0f172a;">${comment}</span>`;
      text = `${input.actorDisplayName} прокомментировал задачу в «${input.projectName}»: ${clip(input.commentExcerpt ?? '')}`;
      break;
    case 'member_changed':
      heading = 'Изменение в команде';
      subject = `Изменение в команде «${input.projectName}»`;
      bodyHtml = `<strong>${actor}</strong>: ${detail} в проекте <strong>«${project}»</strong>.`;
      text = `${input.actorDisplayName}: ${clip(input.detail ?? '')} в «${input.projectName}»`;
      break;
    case 'commit_linked':
      heading = 'Привязан коммит';
      subject = `Привязан коммит в «${input.projectName}»`;
      bodyHtml = `<strong>${actor}</strong> привязал коммит к задаче <span style="color:#0f172a;">${task}</span> в проекте <strong>«${project}»</strong>.`;
      text = `${input.actorDisplayName} привязал коммит к задаче в «${input.projectName}»`;
      break;
    case 'status_changed':
      heading = 'Статус задачи изменён';
      subject = `Статус задачи изменён в «${input.projectName}»`;
      bodyHtml = `<strong>${actor}</strong> изменил статус задачи${detail ? ` (${detail})` : ''} в проекте <strong>«${project}»</strong>:<br/><span style="color:#0f172a;">${task}</span>`;
      text = `${input.actorDisplayName} изменил статус задачи${input.detail ? ` (${input.detail})` : ''} в «${input.projectName}»: ${clip(input.taskExcerpt ?? '')}`;
      break;
    case 'kb_updated':
      heading = 'Обновление базы знаний';
      subject = `Обновление базы знаний «${input.projectName}»`;
      bodyHtml = `<strong>${actor}</strong> обновил базу знаний проекта <strong>«${project}»</strong>${detail ? `: <span style="color:#0f172a;">${detail}</span>` : ''}.`;
      text = `${input.actorDisplayName} обновил базу знаний «${input.projectName}»`;
      break;
  }

  return renderEmailLayout({
    to: input.to,
    subject,
    heading,
    bodyHtml,
    text: `${text}\n\n${input.ctaLabel ?? 'Открыть'}: ${input.ctaUrl}`,
    ctaUrl: input.ctaUrl,
    ctaLabel: input.ctaLabel ?? 'Открыть задачу',
  });
}
