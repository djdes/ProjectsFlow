import type { EmailMessage } from '../EmailSender.js';
import { escapeHtml } from './layout.js';

export type TaskAssigneeEmailInput = {
  readonly to: string;
  readonly actorDisplayName: string;
  readonly taskExcerpt: string;
  readonly taskUrl: string;
};

export function renderTaskAssigneeEmail(input: TaskAssigneeEmailInput): EmailMessage {
  const subject = `Вы назначены ответственным за задачу в ProjectsFlow`;
  const actor = escapeHtml(input.actorDisplayName);
  const task = escapeHtml(input.taskExcerpt);
  const taskUrl = escapeHtml(input.taskUrl);
  const text = [
    `${input.actorDisplayName} назначил(а) вас ответственным за задачу:`,
    '',
    `«${input.taskExcerpt}»`,
    '',
    `Открыть: ${input.taskUrl}`,
  ].join('\n');
  const html = `<!DOCTYPE html>
<html lang="ru"><body style="margin:0;padding:32px;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
<div style="max-width:480px;margin:0 auto;padding:28px 32px;background:#fff;border:1px solid #e2e8f0;border-radius:12px;">
  <div style="font-size:13px;font-weight:700;letter-spacing:.5px;color:#2563eb;">PROJECTSFLOW</div>
  <h1 style="margin:14px 0 12px;font-size:20px;color:#0f172a;">Вы — ответственный</h1>
  <p style="font-size:15px;line-height:1.5;color:#334155;"><strong>${actor}</strong> назначил(а) вас ответственным за задачу:</p>
  <blockquote style="margin:12px 0 20px;padding:12px 14px;border-left:3px solid #2563eb;background:#f8fafc;color:#0f172a;">${task}</blockquote>
  <a href="${taskUrl}" style="display:inline-block;padding:13px 24px;border-radius:8px;background:#2563eb;color:#fff;text-decoration:none;font-weight:600;">Открыть задачу</a>
</div></body></html>`;
  return { to: input.to, subject, text, html };
}
