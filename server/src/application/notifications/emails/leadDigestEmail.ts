import type { EmailMessage } from '../EmailSender.js';
import { escapeHtml } from './layout.js';
import type { LeadDigestModel } from '../../lead/buildLeadDigest.js';

export type LeadDigestEmailInput = {
  readonly to: string;
  readonly model: LeadDigestModel;
  readonly appUrl: string;
};

// Ежедневная сводка руководителя на почту. Тот же материал, что уходит ему в личный чат
// бота: загрузка по людям + просрочки. В общие рассылки это письмо не попадает —
// адресат ровно один.
export function renderLeadDigestEmail(input: LeadDigestEmailInput): EmailMessage {
  const { model } = input;
  const base = input.appUrl.replace(/\/$/u, '');
  const subject = `Сводка по команде «${model.workspaceName}» за ${model.dateMsk}`;

  const textLines = [
    `Сводка по команде «${model.workspaceName}» за ${model.dateMsk}`,
    `Активных задач: ${model.activeCount}`,
    '',
  ];
  for (const group of model.groups) {
    textLines.push(`${group.displayName} — ${group.tasks.length}`);
    for (const task of group.tasks) {
      const deadline = task.deadline ? ` (до ${task.deadline})` : '';
      textLines.push(`  • ${task.title} — ${task.projectName}${deadline}`);
    }
    textLines.push('');
  }
  if (model.overdue.length > 0) {
    textLines.push(`Просрочено: ${model.overdue.length}`);
    for (const task of model.overdue) {
      textLines.push(`  • ${task.title} — ${task.assigneeName}, срок ${task.deadline ?? ''}`);
    }
    textLines.push('');
  }
  textLines.push(`Открыть доску: ${base}`);

  const groupsHtml = model.groups
    .map((group) => {
      const items = group.tasks
        .map((task) => {
          const deadline = task.deadline
            ? `<span style="color:#64748b;"> · до ${escapeHtml(task.deadline)}</span>`
            : '';
          return `<li style="margin:4px 0;">${escapeHtml(task.title)} <span style="color:#64748b;">(${escapeHtml(task.projectName)})</span>${deadline}</li>`;
        })
        .join('');
      return `<div style="margin:18px 0 0;">
  <div style="font-weight:600;color:#0f172a;">${escapeHtml(group.displayName)} — ${group.tasks.length}</div>
  <ul style="margin:6px 0 0;padding-left:18px;color:#334155;font-size:14px;">${items}</ul>
</div>`;
    })
    .join('');

  const overdueHtml =
    model.overdue.length === 0
      ? ''
      : `<div style="margin:24px 0 0;padding:14px 16px;background:#fef2f2;border:1px solid #fecaca;border-radius:10px;">
  <div style="font-weight:600;color:#b91c1c;">Просрочено: ${model.overdue.length}</div>
  <ul style="margin:6px 0 0;padding-left:18px;color:#7f1d1d;font-size:14px;">${model.overdue
    .map(
      (task) =>
        `<li style="margin:4px 0;">${escapeHtml(task.title)} — ${escapeHtml(task.assigneeName)}, срок ${escapeHtml(task.deadline ?? '')}</li>`,
    )
    .join('')}</ul>
</div>`;

  const html = `<!DOCTYPE html>
<html lang="ru"><body style="margin:0;padding:32px;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
<div style="max-width:640px;margin:0 auto;padding:28px 32px;background:#fff;border:1px solid #e2e8f0;border-radius:12px;">
  <div style="font-size:13px;font-weight:700;letter-spacing:.5px;color:#2563eb;">PROJECTSFLOW</div>
  <h1 style="margin:14px 0 4px;font-size:20px;color:#0f172a;">Сводка по команде</h1>
  <div style="color:#64748b;font-size:14px;">${escapeHtml(model.workspaceName)} · ${escapeHtml(model.dateMsk)} · активных задач: ${model.activeCount}</div>
  ${groupsHtml}
  ${overdueHtml}
  <a href="${escapeHtml(base)}" style="display:inline-block;margin-top:24px;padding:13px 24px;border-radius:8px;background:#2563eb;color:#fff;text-decoration:none;font-weight:600;">Открыть ProjectsFlow</a>
</div></body></html>`;

  return { to: input.to, subject, text: textLines.join('\n'), html };
}
