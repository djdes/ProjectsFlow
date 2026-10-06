import type { AiConversationMessage } from '../../domain/ai-conversation/AiMessage.js';
import type { AiConversationRun } from '../../domain/ai-conversation/AiRun.js';

// Что получает исполнитель ответа в чате: воркер диспетчера (GET /agent/ai-conversation-runs/pending)
// или сам сервер (aiConversationServerQueue). Одна функция на обоих — иначе текст запроса и
// история разъехались бы между исполнителями.

/**
 * Текст сообщения для модели. Протокол действий — это ВЫДАЧА ПРАВ: с ним модель может
 * предложить создание и удаление проектов и задач. Режим «Размышление» (mode 'chat') на то
 * и режим, чтобы ничего не делать, поэтому права там не выдаются вовсе — модель просто
 * рассуждает. Без этого «размышление» было бы только надписью на кнопке.
 */
export function aiConversationWorkerInputText(
  run: Pick<AiConversationRun, 'mode' | 'projectId'>,
  inputText: string,
): string {
  return run.mode === 'studio_plan'
    ? `${inputText}\n\n${aiConversationActionProtocol(run.projectId)}`
    : inputText;
}

export type AiConversationWorkerHistoryEntry = {
  readonly id: string;
  readonly seq: string;
  readonly role: AiConversationMessage['role'];
  readonly status: AiConversationMessage['status'];
  readonly body: string;
  readonly model: string | null;
  readonly createdAt: string;
};

/**
 * The worker receives a bounded, already-authorized transcript only. It has
 * no conversation API, filesystem or MCP access, so follow-up answers still
 * keep context without broadening the worker capability.
 *
 * Правки элементов (mode studio_edit) остаются в истории намеренно: «поменяли
 * заголовок каталога» — тот же контекст диалога, что и обычный вопрос. А вот
 * metadata здесь не сериализуется вообще, поэтому CSS-селекторы зоны планировщику
 * не достаются; сами studio_edit-run'ы в эту очередь не попадают (их закрывает job).
 */
export function aiConversationWorkerHistory(
  history: readonly AiConversationMessage[],
): AiConversationWorkerHistoryEntry[] {
  return history.map((message) => ({
    id: message.id,
    seq: String(message.seq),
    role: message.role,
    status: message.status,
    body: message.body,
    model: message.model,
    createdAt: message.createdAt.toISOString(),
  }));
}

export function aiConversationActionProtocol(projectId: string | null): string {
  return [
    'SYSTEM CAPABILITY: You are planning changes in ProjectsFlow. Never claim that a mutation has already happened.',
    'When the user asks to create, change, or delete ProjectsFlow projects/tasks, explain the plan briefly and append exactly one fenced block named projectsflow-actions.',
    'The block must be strict JSON: {"title":"...","summary":"...","actions":[...]}. It is hidden by the UI and only executes after explicit user confirmation.',
    'Supported actions: {"id":"stable-ref","type":"create_project","name":"..."}; {"id":"...","type":"create_task","projectId":"..." OR "projectRef":"id-of-create_project","description":"...","status":"backlog|todo|in_progress|awaiting_clarification|done|manual","deadline":"YYYY-MM-DD|null","priority":1|2|3|4|null}; {"id":"...","type":"update_task","projectId":"...","taskId":"...", optional description/status/deadline/priority}; {"id":"...","type":"delete_task","projectId":"...","taskId":"..."}; {"id":"...","type":"delete_all_tasks","projectId":"..."}.',
    `Current project id: ${projectId ?? 'none (ask for a project or create one first)'}. For actions in the current Studio, use this project id. For 100 tasks, output 100 explicit create_task actions so progress and per-item results are visible.`,
    'Attachments appear in the user text as PF_ATTACHMENT HTML comments containing base64 JSON. Read text attachments directly and use image data as visual context when supported; do not repeat the encoded payload in the answer.',
    'For ordinary questions that require no mutation, do not emit a projectsflow-actions block.',
    'PROGRESS REPORTING (optional, sent on the /complete call, NOT inside the answer body): "steps":[{"kind":"thought|query|read|write|review","detail":"one short sentence","durationMs":1200}] — at most 50. Do not send a label: the server writes the human-readable Russian one from "kind".',
    'CONTEXT REPORTING (optional, same call): "knowledge":[{"kind":"project|task|kb_page|document","id":"<entity id>","title":"...","subtitle":"...","href":"/projects/..."}] — the objects you actually looked at, at most 50. "href" must be a site-relative path.',
    'FOLLOW-UP SUGGESTIONS (optional, same call): "suggestions":[{"title":"Добавить галерею","prompt":"Добавь галерею проектов под шапкой"}] — 3 to 5 next steps the user may plausibly want. The UI shows "title" on a chip and puts "prompt" into the composer without sending it, so write the prompt as the user would phrase it, in Russian. Omit the field when nothing useful follows.',
  ].join('\n');
}
