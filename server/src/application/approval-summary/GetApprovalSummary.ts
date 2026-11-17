import { createHash } from 'node:crypto';
import {
  normalizeApprovalSummary,
  type ApprovalSummaryResult,
} from '../../domain/approval-summary/ApprovalSummary.js';
import type { LiveSession } from '../../domain/live/LiveSession.js';
import type { Task } from '../../domain/task/Task.js';
import type { LiveRepository } from '../live/LiveRepository.js';
import { isSubscriptionUnavailable } from '../llm/FallbackLlmTextGenerator.js';
import type { GenerateLlmText } from '../llm/LlmTextGenerator.js';
import { RUN_PROMPT_INSTRUCTIONS, fillPromptTemplate } from '../llm/promptTemplate.js';
import { requireTaskReadAccess, type TaskAccessDeps } from '../task/taskAuthorization.js';
import type { TaskCommentRepository } from '../task/TaskCommentRepository.js';
import type { TaskCommitRepository } from '../task/TaskCommitRepository.js';
import type { ApprovalSummaryRepository } from './ApprovalSummaryRepository.js';
import { collectApprovalEvidence } from './collectApprovalEvidence.js';
import { APPROVAL_SUMMARY_PROMPT_VERSION, APPROVAL_SUMMARY_TEMPLATE } from './prompts/approvalSummaryPrompt.js';

// Сколько последних событий запуска читать: итоговые сообщения, проверки и diff_summary
// пишутся в конце, а длинная лента вызовов инструментов в начале сводке не нужна.
const SESSION_TAIL_EVENTS = 400;
// Клиент ждёт GET до 45 с; короткий ответ быстрой модели укладывается с запасом.
const LLM_TIMEOUT_MS = 30_000;

const EMPTY: ApprovalSummaryResult = { summary: null, generatedAt: null };

type Deps = TaskAccessDeps & {
  readonly live: Pick<LiveRepository, 'listSessions' | 'listEvents'>;
  readonly taskCommits: Pick<TaskCommitRepository, 'listByTask'>;
  readonly comments: Pick<TaskCommentRepository, 'listByTask'>;
  readonly summaries: ApprovalSummaryRepository;
  // Подписка ChatGPT платформы (LlmTextGenerator), без запасной модели: недоступна
  // подписка — сводки нет, карточка просто без неё.
  readonly llm: GenerateLlmText | null;
  readonly now?: () => Date;
  readonly log?: (message: string) => void;
};

// ИИ-сводка «что сделано» для карточки полки «На утверждении» (db/186). Доступ — как к
// самой задаче. Сводка кэшируется по хэшу входа и пересобирается, только когда вход
// изменился (новый запуск воркера, коммит, комментарий исполнителя, правка текста задачи).
export class GetApprovalSummary {
  // Один запрос к модели на задачу и вход: соседние карточки, повторный рендер и окно
  // «Принять все» спрашивают одно и то же одновременно.
  private readonly inFlight = new Map<string, Promise<ApprovalSummaryResult>>();

  constructor(private readonly deps: Deps) {}

  async execute(projectId: string, userId: string, taskId: string): Promise<ApprovalSummaryResult> {
    await requireTaskReadAccess(this.deps, projectId, taskId, userId);
    const task = await this.deps.tasks.getById(taskId);
    if (!task || task.projectId !== projectId || task.status !== 'pending_approval') return EMPTY;

    const evidence = await this.collect(task);
    if (!evidence.hasEvidence) return EMPTY;
    const input = fillPromptTemplate(APPROVAL_SUMMARY_TEMPLATE, {
      TASK: evidence.taskText,
      EVIDENCE: evidence.evidence,
    });
    const inputHash = createHash('sha256').update(`${APPROVAL_SUMMARY_PROMPT_VERSION}\n${input}`).digest('hex');

    // Проверка и запись в inFlight — без await между ними, поэтому второй запрос с тем же
    // входом гарантированно получит уже начатое обещание. Кэш читается внутри него: так
    // запрос, пришедший сразу после завершения первого, найдёт сводку в БД.
    const key = `${taskId}:${inputHash}`;
    const running = this.inFlight.get(key);
    if (running) return running;
    const pending = this.resolve(taskId, userId, input, inputHash).finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, pending);
    return pending;
  }

  private async collect(task: Task) {
    const sessions = await this.deps.live.listSessions(task.id);
    const session = latestSession(sessions);
    const [events, commits, comments] = await Promise.all([
      session
        ? this.deps.live.listEvents(session.id, Math.max(0, session.lastSeq - SESSION_TAIL_EVENTS), SESSION_TAIL_EVENTS)
        : Promise.resolve([]),
      this.deps.taskCommits.listByTask(task.id),
      this.deps.comments.listByTask(task.id),
    ]);
    return collectApprovalEvidence({ task, session, events, commits, comments });
  }

  private async resolve(
    taskId: string,
    userId: string,
    input: string,
    inputHash: string,
  ): Promise<ApprovalSummaryResult> {
    const cached = await this.deps.summaries.find(taskId);
    if (cached && cached.inputHash === inputHash) {
      return { summary: cached.summary, generatedAt: cached.generatedAt };
    }
    if (!this.deps.llm) return EMPTY;

    let text: string;
    try {
      const result = await this.deps.llm.generate({
        billedUserId: userId,
        tier: 'fast',
        instructions: RUN_PROMPT_INSTRUCTIONS,
        input,
        reasoningEffort: 'low',
        timeoutMs: LLM_TIMEOUT_MS,
      });
      text = result.text;
    } catch (error) {
      // Подписка не подключена, в лимите или ждёт повторного входа — штатная ситуация, не
      // ошибка запроса. Прочие сбои модели тоже не роняют «Входящие»: сводки просто нет.
      if (!isSubscriptionUnavailable(error)) {
        this.deps.log?.(
          `[approval-summary] сводка для задачи ${taskId} не собрана: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return EMPTY;
    }

    const summary = normalizeApprovalSummary(text);
    if (!summary) return EMPTY;
    const generatedAt = this.deps.now ? this.deps.now() : new Date();
    try {
      await this.deps.summaries.save({ taskId, inputHash, summary, generatedAt });
    } catch (error) {
      // Не записали в кэш — сводку всё равно отдаём, в следующий раз соберём заново.
      this.deps.log?.(
        `[approval-summary] не удалось сохранить сводку задачи ${taskId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return { summary, generatedAt };
  }
}

// Последний запуск, в котором что-то записано: пустой отменённый перезапуск не должен
// заслонять запуск, который и сделал работу.
function latestSession(sessions: readonly LiveSession[]): LiveSession | null {
  const sorted = [...sessions].sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
  return sorted.find((s) => s.eventCount > 0) ?? null;
}
