import type { GenerateLlmText } from '../../llm/LlmTextGenerator.js';
import type { LlmJsonSchema } from '../../llm/LlmTransport.js';
import { RUN_PROMPT_INSTRUCTIONS } from '../../llm/promptTemplate.js';
import { projectHintLine } from '../../ai-prompt/prepareComposeContext.js';

const PICK_PROJECT_TIMEOUT_MS = 20_000;

const PICK_PROJECT_SCHEMA: LlmJsonSchema = {
  name: 'pick_group_project',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['projectId', 'reason'],
    properties: {
      projectId: { type: 'string' },
      reason: { type: 'string' },
    },
  },
};

export type GroupProjectCandidate = {
  readonly id: string;
  readonly name: string;
  readonly aliases?: readonly string[];
  readonly shortDescription?: string | null;
};

// Смешанная группа (db/193): сообщение без исполнителя, проект по названию/привычному названию
// не нашёлся — просим ИИ выбрать ОДИН проект группы. Пустой projectId — не уверен (тогда бот
// спрашивает кнопками). Best-effort: любой сбой → null.
export async function pickGroupProjectWithAi(
  llm: GenerateLlmText | undefined,
  billedUserId: string,
  text: string,
  projects: readonly GroupProjectCandidate[],
): Promise<string | null> {
  if (!llm || projects.length < 2) return null;
  const list = projects
    .map((p) => {
      const hints = projectHintLine(p).trim().replace(/\n/g, '; ');
      return `- id=${p.id} · «${p.name}»${hints ? ` · ${hints}` : ''}`;
    })
    .join('\n');
  const input =
    'Сообщение из рабочей Telegram-группы — задача воркеру. Названия часто пишут транслитом или на слух. ' +
    'Выбери ОДИН проект из списка, к которому ' +
    'оно относится (по названию, привычным названиям, описанию, упомянутым программам/сайтам). ' +
    'Если по тексту нельзя уверенно понять проект — верни пустой projectId. Никогда не выдумывай id. ' +
    'Ответ строго JSON {"projectId":"<id или пусто>","reason":"<коротко>"}.\n\n' +
    `=== ПРОЕКТЫ ===\n${list}\n\n=== СООБЩЕНИЕ ===\n${text.slice(0, 4000)}`;
  try {
    const res = await llm.generate({
      billedUserId,
      tier: 'fast',
      instructions: RUN_PROMPT_INSTRUCTIONS,
      input,
      reasoningEffort: 'low',
      timeoutMs: PICK_PROJECT_TIMEOUT_MS,
      jsonSchema: PICK_PROJECT_SCHEMA,
    });
    const parsed = JSON.parse(res.text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')) as { projectId?: unknown };
    const id = typeof parsed.projectId === 'string' ? parsed.projectId.trim() : '';
    return projects.some((p) => p.id === id) ? id : null;
  } catch (err) {
    console.warn('[tg-mixed] AI project pick failed:', err);
    return null;
  }
}
