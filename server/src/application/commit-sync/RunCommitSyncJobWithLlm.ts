import type { CommitSyncJob, CommitSyncMatch } from '../../domain/commit-sync/CommitSyncJob.js';
import type { GenerateLlmText, GenerateLlmTextResult } from '../llm/LlmTextGenerator.js';
import type { CompleteCommitSyncJob, CompleteCommitSyncJobInput } from './CompleteCommitSyncJob.js';
import { COMMIT_SYNC_TEMPLATE } from './prompts/commitSyncPrompt.js';
import { RUN_PROMPT_INSTRUCTIONS } from '../llm/promptTemplate.js';

// Серверное исполнение ежедневной сверки коммитов (очередь commit_sync) через подписку
// ChatGPT — замена commit-sync-worker.ps1 на машине диспетчера. Промпт и разбор ответа
// (Parse-Matches) перенесены из воркера один к одному. Применяет совпадения прежний
// CompleteCommitSyncJob — тот же путь, что у agent-роута /complete: перемещения или
// предложения закрыть, сводка батча, метеринг.

// Watchdog воркера по умолчанию (commitSyncJobs.watchdogSeconds = 180). Очистка снимает
// батч после 12 минут без активности, одиночную «Сверить сейчас» — через 15 минут.
const TIMEOUT_MS = 180_000;
// Лимит reason у agent-роута /complete (zod max 2000): длиннее роут бы не принял.
const MAX_REASON_CHARS = 2_000;

type Deps = {
  readonly complete: Pick<CompleteCommitSyncJob, 'execute'>;
  readonly llm: GenerateLlmText;
};

type Usage = Pick<CompleteCommitSyncJobInput, 'costUsd' | 'tokensIn' | 'tokensOut' | 'model'>;
type Outcome = Usage &
  (
    | { readonly ok: true; readonly matches: CommitSyncMatch[] }
    | { readonly ok: false; readonly error: string }
  );

export class RunCommitSyncJobWithLlm {
  constructor(private readonly deps: Deps) {}

  // job уже забран (status=running). Завершает его так же, как воркер через /complete.
  // Сбой самого завершения не маскируется ok=false (воркер тоже не повторял) — его
  // залогирует раннер, а висящий job снимет очистка.
  async execute(job: CommitSyncJob): Promise<void> {
    let llm: GenerateLlmTextResult;
    try {
      llm = await this.deps.llm.generate({
        // Плательщик — как у гейта claim'а и метеринга в CompleteCommitSyncJob.
        billedUserId: job.createdBy ?? job.dispatcherUserId,
        // Сопоставление по смыслу — классификация, хватает быстрой модели; но ложное
        // совпадение закроет задачу, поэтому рассуждение не урезаем до low.
        tier: 'fast',
        instructions: RUN_PROMPT_INSTRUCTIONS,
        input: buildCommitSyncPrompt(job.context),
        reasoningEffort: 'medium',
        timeoutMs: TIMEOUT_MS,
      });
    } catch (e) {
      await this.finish(job, { ok: false, error: `llm_failed: ${e instanceof Error ? e.message : String(e)}` });
      return;
    }
    // Токены потрачены и при неразборчивом ответе — метерим их в обоих исходах.
    const usage: Usage = {
      costUsd: llm.costUsd,
      tokensIn: llm.usage?.inputTokens ?? null,
      tokensOut: llm.usage?.outputTokens ?? null,
      model: llm.model,
    };
    const text = llm.text.trim();
    if (!text) {
      await this.finish(job, { ok: false, error: 'llm_failed: empty_output', ...usage });
      return;
    }
    const parsed = parseCommitSyncMatches(text);
    if (!parsed.ok) {
      await this.finish(job, { ok: false, error: `parse_failed:${parsed.reason}`, ...usage });
      return;
    }
    await this.finish(job, { ok: true, matches: parsed.matches, ...usage });
  }

  private finish(job: CommitSyncJob, outcome: Outcome): Promise<void> {
    return this.deps.complete.execute({
      // Сервер действует от имени диспетчера job'а — как раньше Ralph с его токеном.
      userId: job.dispatcherUserId,
      jobId: job.id,
      ok: outcome.ok,
      matches: outcome.ok ? outcome.matches : null,
      error: outcome.ok ? null : outcome.error,
      costUsd: outcome.costUsd ?? null,
      tokensIn: outcome.tokensIn ?? null,
      tokensOut: outcome.tokensOut ?? null,
      model: outcome.model ?? null,
    });
  }
}

// Пустой контекст воркер подменял пометкой — модель не должна гадать по пустым данным.
function buildCommitSyncPrompt(context: string | null): string {
  const block = context && context.trim() ? context : '(контекст пуст)';
  return COMMIT_SYNC_TEMPLATE.split('{{CONTEXT}}').join(block);
}

export type ParsedCommitSyncMatches =
  | { readonly ok: true; readonly matches: CommitSyncMatch[] }
  | { readonly ok: false; readonly reason: 'empty' | 'no_json' | 'bad_json' };

// Порт Parse-Matches из воркера: терпим к ```json-обёрткам и тексту вокруг JSON. Повторяет
// семантику PowerShell 5.1 там, где ответ — валидный JSON: ключи регистронезависимы, ключи,
// отличающиеся лишь регистром, и пустой ключ — ошибка разбора (bad_json), одиночный объект
// в matches считается списком из одного элемента, пропущенный matches — «совпадений нет».
export function parseCommitSyncMatches(text: string): ParsedCommitSyncMatches {
  if (!text.trim()) return { ok: false, reason: 'empty' };
  // Срезаем markdown-забор: всё до первого ``` (с необязательным json) и всё от следующего
  // ``` до конца. -replace в PowerShell регистронезависим — отсюда флаг i.
  let t = text.replace(/^[\s\S]*?```(?:json)?/i, '').replace(/```[\s\S]*$/, '');
  if (!t.trim()) t = text;
  // Берём блок от первой { до последней }.
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start < 0 || end < start) return { ok: false, reason: 'no_json' };
  let obj: unknown;
  try {
    obj = JSON.parse(normalizePsJsonStrings(t.slice(start, end + 1)), rejectPsAmbiguousKeys);
  } catch {
    return { ok: false, reason: 'bad_json' };
  }
  const raw = psProperty(obj, 'matches');
  const matches: CommitSyncMatch[] = [];
  for (const m of Array.isArray(raw) ? raw : [raw]) {
    const taskId = psTruthyString(psProperty(m, 'taskId'));
    const commitSha = psTruthyString(psProperty(m, 'commitSha'));
    if (taskId === null || commitSha === null) continue;
    const reason = psTruthyString(psProperty(m, 'reason'));
    matches.push({ taskId, commitSha, reason: reason === null ? null : reason.slice(0, MAX_REASON_CHARS) });
  }
  return { ok: true, matches };
}

// ConvertFrom-Json в PowerShell 5.1 терпит внутри строк сырые управляющие символы (перевод
// строки, таб) и \' — JSON.parse их отвергает. Приводим такие строки к строгому JSON.
function normalizePsJsonStrings(json: string): string {
  let out = '';
  let inString = false;
  for (let i = 0; i < json.length; i++) {
    const ch = json[i]!;
    if (!inString) {
      if (ch === '"') inString = true;
      out += ch;
    } else if (ch === '\\') {
      const next = json[i + 1] ?? '';
      out += next === "'" ? "'" : ch + next;
      i++;
    } else if (ch < ' ') {
      out += `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`;
    } else {
      if (ch === '"') inString = false;
      out += ch;
    }
  }
  return out;
}

// ConvertFrom-Json в PowerShell 5.1 не превращает в объект JSON с ключами, совпадающими
// без учёта регистра, и с пустым ключом — воркер отвечал на такое bad_json.
function rejectPsAmbiguousKeys(_key: string, value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const seen = new Set<string>();
    for (const k of Object.keys(value)) {
      const lower = k.toLowerCase();
      if (lower === '' || seen.has(lower)) throw new Error('ambiguous_json_keys');
      seen.add(lower);
    }
  }
  return value;
}

// $obj.name: поле объекта без учёта регистра; у не-объектов полей нет ($null).
function psProperty(obj: unknown, name: string): unknown {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(obj)) if (k.toLowerCase() === lower) return v;
  return null;
}

// `if ($x) { [string]$x }` для скаляров JSON: пустая строка, 0 и false ложны, true → 'True'.
// Массивы и объекты PowerShell склеил бы в строку ('a b', '@{k=v}'), но такой id ни с одной
// задачей или коммитом не совпадёт — отбрасываем.
function psTruthyString(value: unknown): string | null {
  if (typeof value === 'string') return value.length > 0 ? value : null;
  if (typeof value === 'number') return value !== 0 ? String(value) : null;
  if (value === true) return 'True';
  return null;
}
