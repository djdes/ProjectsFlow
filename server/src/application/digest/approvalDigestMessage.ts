import type { Task } from '../../domain/task/Task.js';
import type { TelegramLink } from '../../domain/telegram/TelegramLink.js';
import { escapeHtml, pluralTasksRu, splitDescription } from '../../domain/task/digestFormat.js';
import { telegramDigestTaskTitle } from '../task/digest/buildTaskDigest.js';
import { telegramPersonMention } from '../telegram/telegramMention.js';

export type ApprovalDigestPerson = {
  readonly displayName: string;
  readonly telegramLink: TelegramLink | null;
};

export type ApprovalDigestGroup = {
  readonly project: { readonly id: string; readonly name: string };
  // Поручения из личных «Входящих»: ссылки ведут на /inbox, а не на страницу проекта.
  readonly isInbox?: boolean;
  readonly tasks: readonly Task[];
};

export type ApprovalDigestInput = {
  // Кто утверждает: руководители пространства (без них — владельцы).
  readonly approvers: readonly ApprovalDigestPerson[];
  // Кто наблюдает: владельцы, когда утверждают руководители.
  readonly observers: readonly ApprovalDigestPerson[];
  readonly groups: readonly ApprovalDigestGroup[];
  readonly appUrl: string;
};

const MAX_MESSAGE_LENGTH = 3800;

// Группа «🤝 Поручения» — задачи без проекта из личных «Входящих» исполнителя.
export const APPROVAL_DELEGATED_GROUP_NAME = 'Поручения';

function taskUrl(base: string, group: ApprovalDigestGroup, task: Task): string {
  return group.isInbox
    ? `${base}/inbox?task=${task.id}`
    : `${base}/projects/${group.project.id}?task=${task.id}`;
}

function groupHeading(group: ApprovalDigestGroup): string {
  return `${group.isInbox ? '🤝' : '📁'} ${group.project.name}`;
}

function peopleLine(label: string, people: readonly ApprovalDigestPerson[]): string | null {
  if (people.length === 0) return null;
  return `${label}: ${people.map((p) => telegramPersonMention(p.displayName, p.telegramLink)).join(', ')}`;
}

function total(input: ApprovalDigestInput): number {
  return input.groups.reduce((sum, group) => sum + group.tasks.length, 0);
}

// Отдельное сообщение рабочему чату после сводок по людям: какие задачи сданы и ждут
// приёмки. Утверждающие (руководители) упомянуты — им придёт уведомление; владельцы
// отмечены наблюдателями. Без кнопки «✓»: ссылка-действие в общем чате сработала бы от
// имени утверждающего для любого, кто её нажмёт, поэтому принимают работу на сайте (↗).
export function buildApprovalDigestRich(input: ApprovalDigestInput): string {
  const base = input.appUrl.replace(/\/+$/, '');
  const count = total(input);
  const html: string[] = [`<h2>✅ На утверждении: ${escapeHtml(pluralTasksRu(count))}</h2>`];
  for (const line of [peopleLine('Утверждают', input.approvers), peopleLine('Наблюдают', input.observers)]) {
    if (line) html.push(`<p>${line}</p>`);
  }
  for (const group of input.groups) {
    html.push(`<h3>${escapeHtml(groupHeading(group))}</h3>`);
    html.push('<table bordered striped>');
    html.push('<tr><th>Задача</th><th>Кто сдал</th></tr>');
    for (const task of group.tasks) {
      const title = telegramDigestTaskTitle(splitDescription(task.description).name);
      html.push(
        `<tr><td><b>${escapeHtml(title)}</b><br><a href="${escapeHtml(taskUrl(base, group, task))}">↗</a></td>` +
          `<td>${escapeHtml(task.assignee.displayName ?? 'Участник')}</td></tr>`,
      );
    }
    html.push('</table>');
  }
  return html.join('');
}

// Fallback обычным HTML (тот же состав, что у rich-версии) с отсечкой по длине сообщения.
export function buildApprovalDigestFallback(input: ApprovalDigestInput): string {
  const base = input.appUrl.replace(/\/+$/, '');
  const count = total(input);
  const header = [
    `<b>✅ На утверждении: ${escapeHtml(pluralTasksRu(count))}</b>`,
    peopleLine('Утверждают', input.approvers),
    peopleLine('Наблюдают', input.observers),
  ]
    .filter((line): line is string => line !== null)
    .join('\n');

  const lines: string[] = [];
  let included = 0;
  outer: for (const group of input.groups) {
    const groupLines = [`<b>${escapeHtml(groupHeading(group))}</b>`];
    for (const task of group.tasks) {
      const title = telegramDigestTaskTitle(splitDescription(task.description).name);
      const line =
        `• <a href="${escapeHtml(taskUrl(base, group, task))}"><b>${escapeHtml(title)}</b></a>` +
        ` — ${escapeHtml(task.assignee.displayName ?? 'Участник')}`;
      const tail = `\n\n<i>Ещё ${count - included - 1} — откройте сайт.</i>`;
      if (header.length + [...lines, ...groupLines, line].join('\n').length + tail.length > MAX_MESSAGE_LENGTH) {
        // Уже вошедшие задачи текущей группы не теряем — иначе «Ещё N» не сойдётся.
        if (groupLines.length > 1) lines.push(...groupLines, '');
        break outer;
      }
      groupLines.push(line);
      included += 1;
    }
    lines.push(...groupLines, '');
  }
  const hidden = count - included;
  const tail = hidden > 0 ? `\n\n<i>Ещё ${hidden} — откройте сайт.</i>` : '';
  return `${header}\n\n${lines.join('\n').trim()}${tail}`;
}
