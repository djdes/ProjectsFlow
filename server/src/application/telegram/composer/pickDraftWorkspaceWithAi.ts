import type { GenerateLlmText } from '../../llm/LlmTextGenerator.js';
import type { LlmJsonSchema } from '../../llm/LlmTransport.js';
import { RUN_PROMPT_INSTRUCTIONS, fillPromptTemplate } from '../../llm/promptTemplate.js';
import type { WorkspaceOption } from './resolveDraftWorkspace.js';

const PICK_WORKSPACE_TIMEOUT_MS = 25_000;

export const PICK_WORKSPACE_SCHEMA: LlmJsonSchema = {
  name: 'pick_draft_workspace',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['workspaceId', 'reason'],
    properties: {
      workspaceId: { type: 'string' },
      reason: { type: 'string' },
    },
  },
};

const PICK_WORKSPACE_TEMPLATE = `Пользователь поставил задачу в Telegram-боте ProjectsFlow без явного проекта, и время ожидания ручного выбора пространства истекло. Проанализируй текст задачи и контекст и выбери ОДНО наиболее подходящее пространство из списка кандидатов, куда положить задачу во «Входящие».

Правила выбора:
1. Сопоставь смысл задачи, упомянутые бренды, сайты, боты, сервисы, домены и термины с названиями пространств и проектами внутри каждого пространства.
2. Если в этом же сообщении соседние задачи уже привязаны к проектам конкретного пространства и текущая задача продолжает ту же рабочую тему — выбери то же пространство.
3. Если задача поставлена автором самому себе (без поручения коллеге) и носит личный/бытовой характер (покупки, дом, здоровье, личная заметка без связи с рабочими проектами/командой), а среди кандидатов есть личное пространство (тип: личное) — выбери личное пространство.
4. Если задача рабочая или поручена коллеге — выбери наиболее подходящее рабочее/командное пространство (с учётом проектов в нём, активного пространства исполнителя, привязки чата и прошлого выбора в чате).
5. Верни СТРОГО JSON {"workspaceId":"<id из списка кандидатов>","reason":"<коротко почему>"}. Никогда не выдумывай id вне списка кандидатов.

=== ДОСТУПНЫЕ ПРОСТРАНСТВА-КАНДИДАТЫ ===
{{CANDIDATES_BLOCK}}

=== КОНТЕКСТ ===
{{CONTEXT_BLOCK}}

=== ТЕКСТ ЗАДАЧИ ===
{{TASK_TEXT}}`;

export type PickDraftWorkspaceInput = {
  readonly billedUserId: string;
  readonly options: readonly WorkspaceOption[];
  readonly isGroupChat: boolean;
  readonly linkedWorkspaceIds?: readonly string[];
  readonly lastChosenWorkspaceId?: string | null;
  readonly delegatedPreferredWorkspaceIds?: readonly string[];
  readonly siblingProjectWorkspaceIds?: readonly string[];
  readonly projectsByWorkspaceId?: ReadonlyMap<string, readonly string[]>;
  readonly delegateNames?: readonly string[];
  readonly tasksText: string;
  readonly siblingTasksText?: string | null;
};

export type PickDraftWorkspaceResult = {
  readonly workspaceId: string;
  readonly source: 'single' | 'ai' | 'fallback';
  readonly reason: string;
};

export async function pickDraftWorkspaceWithAi(
  deps: { readonly llm?: GenerateLlmText },
  input: PickDraftWorkspaceInput,
): Promise<PickDraftWorkspaceResult | null> {
  if (input.options.length === 0) return null;
  if (input.options.length === 1) {
    return { workspaceId: input.options[0]!.id, source: 'single', reason: 'only_option' };
  }

  if (deps.llm) {
    try {
      const prompt = buildPickWorkspacePrompt(input);
      const llmRes = await deps.llm.generate({
        billedUserId: input.billedUserId,
        tier: 'fast',
        instructions: RUN_PROMPT_INSTRUCTIONS,
        input: prompt,
        reasoningEffort: 'low',
        timeoutMs: PICK_WORKSPACE_TIMEOUT_MS,
        jsonSchema: PICK_WORKSPACE_SCHEMA,
      });
      const parsed = parsePickedWorkspaceJson(llmRes.text);
      if (parsed) {
        const matched = input.options.find((w) => w.id === parsed.workspaceId);
        if (matched) {
          return {
            workspaceId: matched.id,
            source: 'ai',
            reason: parsed.reason || 'ai_choice',
          };
        }
      }
    } catch (err) {
      console.warn('[tg-composer] AI workspace pick failed, using fallback:', err);
    }
  }

  return pickWorkspaceFallback(input);
}

function buildPickWorkspacePrompt(input: PickDraftWorkspaceInput): string {
  const candidatesLines = input.options.map((w) => {
    const kindLabel = w.kind === 'default' ? 'личное' : 'командное';
    const projects = input.projectsByWorkspaceId?.get(w.id) ?? [];
    const projectsLabel =
      projects.length > 0 ? projects.slice(0, 25).join(', ') : '(нет отдельных проектов)';
    return `- [workspaceId=${w.id}] «${w.name}» (тип: ${kindLabel}) — проекты: ${projectsLabel}`;
  });

  const nameOf = (id: string): string => input.options.find((w) => w.id === id)?.name ?? id;
  const contextLines: string[] = [
    `Тип чата: ${input.isGroupChat ? 'групповой чат' : 'личный чат с ботом'}`,
  ];
  const delegates = input.delegateNames?.filter((s) => s.trim().length > 0) ?? [];
  contextLines.push(
    delegates.length > 0
      ? `Поручено исполнителям: ${delegates.join(', ')}`
      : 'Исполнитель: сам автор задачи',
  );
  const siblingIds = (input.siblingProjectWorkspaceIds ?? []).filter((id) =>
    input.options.some((w) => w.id === id),
  );
  if (siblingIds.length > 0) {
    const uniqueSiblings = [...new Set(siblingIds)].map((id) => `${nameOf(id)} [${id}]`);
    contextLines.push(`Соседние задачи из этого же сообщения отнесены к: ${uniqueSiblings.join(', ')}`);
  }
  if (input.siblingTasksText?.trim()) {
    contextLines.push(`Заголовки соседних задач: ${input.siblingTasksText.trim()}`);
  }
  const delegatePrefIds = (input.delegatedPreferredWorkspaceIds ?? []).filter((id) =>
    input.options.some((w) => w.id === id),
  );
  if (delegatePrefIds.length > 0) {
    const uniquePrefs = [...new Set(delegatePrefIds)].map((id) => `${nameOf(id)} [${id}]`);
    contextLines.push(`Активное рабочее пространство исполнителя: ${uniquePrefs.join(', ')}`);
  }
  const linked = (input.linkedWorkspaceIds ?? []).filter((id) =>
    input.options.some((w) => w.id === id),
  );
  if (linked.length > 0) {
    contextLines.push(
      `Пространства, привязанные к этой группе: ${linked.map((id) => `${nameOf(id)} [${id}]`).join(', ')}`,
    );
  }
  if (input.lastChosenWorkspaceId && input.options.some((w) => w.id === input.lastChosenWorkspaceId)) {
    contextLines.push(
      `Прошлый ручной выбор автора в этом чате: ${nameOf(input.lastChosenWorkspaceId)} [${input.lastChosenWorkspaceId}]`,
    );
  }

  return fillPromptTemplate(PICK_WORKSPACE_TEMPLATE, {
    CANDIDATES_BLOCK: candidatesLines.join('\n'),
    CONTEXT_BLOCK: contextLines.join('\n'),
    TASK_TEXT: input.tasksText.trim() || '(без текста)',
  });
}

export function pickWorkspaceFallback(input: PickDraftWorkspaceInput): PickDraftWorkspaceResult {
  const allowedIds = new Set(input.options.map((w) => w.id));

  // 1. Большинство соседних сегментов этого же черновика с уже определённым проектом.
  const siblingCounts = new Map<string, number>();
  for (const wsId of input.siblingProjectWorkspaceIds ?? []) {
    if (allowedIds.has(wsId)) siblingCounts.set(wsId, (siblingCounts.get(wsId) ?? 0) + 1);
  }
  if (siblingCounts.size > 0) {
    const bestSibling = [...siblingCounts.entries()].sort((a, b) => b[1] - a[1])[0]![0];
    return { workspaceId: bestSibling, source: 'fallback', reason: 'sibling_project_workspace' };
  }

  // 2. Явное упоминание имени пространства или его проекта в тексте задачи (ровно одно пространство).
  const byMention = matchWorkspaceByText(input.tasksText, input.options, input.projectsByWorkspaceId);
  if (byMention) {
    return { workspaceId: byMention, source: 'fallback', reason: 'text_mention' };
  }

  // 3. Для собственной задачи без поручения коллеге — личное пространство (приватно и безопасно).
  const hasDelegates = (input.delegateNames?.length ?? 0) > 0 || (input.delegatedPreferredWorkspaceIds?.length ?? 0) > 0;
  if (!hasDelegates) {
    const personal = input.options.find((w) => w.kind === 'default');
    if (personal) {
      return { workspaceId: personal.id, source: 'fallback', reason: 'personal_default' };
    }
  }

  // 4. Активное пространство исполнителя, если оно среди общих кандидатов.
  for (const wsId of input.delegatedPreferredWorkspaceIds ?? []) {
    if (allowedIds.has(wsId)) {
      return { workspaceId: wsId, source: 'fallback', reason: 'delegate_active_workspace' };
    }
  }

  // 5. Привязка группы или прошлый выбор автора в этом чате.
  for (const wsId of input.linkedWorkspaceIds ?? []) {
    if (allowedIds.has(wsId)) {
      return { workspaceId: wsId, source: 'fallback', reason: 'group_linked_workspace' };
    }
  }
  if (input.lastChosenWorkspaceId && allowedIds.has(input.lastChosenWorkspaceId)) {
    return { workspaceId: input.lastChosenWorkspaceId, source: 'fallback', reason: 'last_chat_choice' };
  }

  // 6. Первый допустимый вариант.
  return { workspaceId: input.options[0]!.id, source: 'fallback', reason: 'first_available' };
}

function matchWorkspaceByText(
  rawText: string,
  options: readonly WorkspaceOption[],
  projectsByWorkspaceId?: ReadonlyMap<string, readonly string[]>,
): string | null {
  const hay = rawText.toLocaleLowerCase('ru');
  if (hay.trim().length < 2) return null;
  const matched = new Set<string>();
  for (const w of options) {
    const tokens = [w.name, ...(projectsByWorkspaceId?.get(w.id) ?? [])]
      .map((s) => s.trim().toLocaleLowerCase('ru'))
      .filter((s) => s.length >= 3);
    if (tokens.some((token) => hay.includes(token))) {
      matched.add(w.id);
    }
  }
  return matched.size === 1 ? [...matched][0]! : null;
}

export function parsePickedWorkspaceJson(
  rawText: string,
): { workspaceId: string; reason: string } | null {
  let s = rawText.trim();
  if (!s) return null;
  if (s.startsWith('```')) {
    s = s
      .replace(/^```[a-zA-Z]*\s*/, '')
      .replace(/\s*```\s*$/, '')
      .trim();
  }
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end < start) return null;
  try {
    const parsed = JSON.parse(s.slice(start, end + 1)) as Record<string, unknown>;
    const workspaceId = typeof parsed['workspaceId'] === 'string' ? parsed['workspaceId'].trim() : '';
    const reason = typeof parsed['reason'] === 'string' ? parsed['reason'].trim() : '';
    if (!workspaceId) return null;
    return { workspaceId, reason };
  } catch {
    return null;
  }
}
