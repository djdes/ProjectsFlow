import type { EmailMessage } from '../EmailSender.js';
import { escapeHtml } from './layout.js';

export type TaskApprovalEmailInput = {
  readonly to: string;
  readonly actorDisplayName: string;
  readonly projectName: string;
  readonly taskExcerpt: string;
  readonly taskUrl: string;
};

// Письмо принимающему работу (руководитель/владелец пространства): исполнитель отметил
// задачу выполненной, и она ждёт приёмки. Без него очередь приёмки замечают только
// случайно — ровно та слепая зона, из-за которой приёмку и вводили.
export function renderTaskApprovalEmail(input: TaskApprovalEmailInput): EmailMessage {
  const subject = `Задача ждёт утверждения — ${input.projectName}`;
  const actor = escapeHtml(input.actorDisplayName);
  const project = escapeHtml(input.projectName);
  const task = escapeHtml(input.taskExcerpt);
  const taskUrl = escapeHtml(input.taskUrl);
  const text = [
    `${input.actorDisplayName} отметил(а) задачу выполненной — она ждёт вашего утверждения.`,
    '',
    `Проект: ${input.projectName}`,
    `«${input.taskExcerpt}»`,
    '',
    `Открыть: ${input.taskUrl}`,
  ].join('\n');
  const html = `<!DOCTYPE html>
<html lang="ru"><body style="margin:0;padding:32px;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
<div style="max-width:480px;margin:0 auto;padding:28px 32px;background:#fff;border:1px solid #e2e8f0;border-radius:12px;">
  <div style="font-size:13px;font-weight:700;letter-spacing:.5px;color:#7c3aed;">PROJECTSFLOW</div>
  <h1 style="margin:14px 0 12px;font-size:20px;color:#0f172a;">Задача ждёт утверждения</h1>
  <p style="font-size:15px;line-height:1.5;color:#334155;"><strong>${actor}</strong> отметил(а) задачу выполненной в проекте <strong>${project}</strong>. Работа не закрыта, пока вы её не примете.</p>
  <blockquote style="margin:12px 0 20px;padding:12px 14px;border-left:3px solid #7c3aed;background:#f8fafc;color:#0f172a;">${task}</blockquote>
  <a href="${taskUrl}" style="display:inline-block;padding:13px 24px;border-radius:8px;background:#7c3aed;color:#fff;text-decoration:none;font-weight:600;">Проверить работу</a>
</div></body></html>`;
  return { to: input.to, subject, text, html };
}
