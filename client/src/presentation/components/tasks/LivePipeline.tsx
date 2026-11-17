import { useState } from 'react';
import {
  Check, ChevronRight, CircleDashed, CornerDownRight, Minus, ShieldCheck, SquareTerminal, Workflow, X, Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { readableWorkerCommand } from '@/lib/readableWorkerCommand';
import type { LiveEvent } from '@/domain/live/LiveEvent';
import {
  summarizeToolJournal,
  type FindingSeverity,
  type LiveCheckResult,
  type LiveEventRole,
  type LiveHandoff,
  type LiveReviewVerdict,
  type LiveStagePayload,
  type PipelineProgress,
  type PipelineStage,
  type StepState,
} from '@/domain/live/LivePipeline';
import { CommentBody } from './CommentBody';

// Visual language of the Ralph pipeline roles in the LIVE feed. Each role keeps one calm
// Notion tone (readable in both themes); status colours (done / warning / destructive) are
// used only where something passed or failed.

type RoleLook = { label: string; tone: string; Icon: typeof Workflow };

export function roleLook(role: Pick<LiveEventRole, 'actor' | 'escalated'>): RoleLook {
  if (role.actor === 'orchestrator') return { label: 'Оркестратор', tone: 'pf-tone-gray', Icon: Workflow };
  if (role.actor === 'reviewer') return { label: 'Ревьюер', tone: 'pf-tone-blue', Icon: ShieldCheck };
  if (role.escalated) return { label: 'Исполнитель · усиленный', tone: 'pf-tone-orange', Icon: Zap };
  return { label: 'Исполнитель', tone: 'pf-tone-purple', Icon: SquareTerminal };
}

export function RoleAvatar({ role, className }: { role: Pick<LiveEventRole, 'actor' | 'escalated'>; className?: string }): React.ReactElement {
  const { tone, Icon } = roleLook(role);
  return (
    <span aria-hidden className={cn(tone, 'grid size-6 shrink-0 place-items-center rounded-full bg-tone-bg text-tone', className)}>
      <Icon className="size-3.5" />
    </span>
  );
}

export function RoleHeader({ role }: { role: LiveEventRole }): React.ReactElement {
  const { label } = roleLook(role);
  return (
    <div className="flex min-w-0 items-center gap-2 pbs-1" data-live-role-header={role.actor}>
      <RoleAvatar role={role} />
      <span className="truncate text-xs font-semibold text-foreground">{label}</span>
      {role.round !== null && <span className="shrink-0 text-2xs text-muted-foreground">раунд {role.round}</span>}
    </div>
  );
}

// A role turn: header once, then the role's rows under one indented accent rail.
export function RoleTurn({ role, header, children }: { role: LiveEventRole; header: boolean; children: React.ReactNode }): React.ReactElement {
  const { tone } = roleLook(role);
  return (
    <div data-live-actor={role.actor} data-live-escalated={role.escalated || undefined} className={cn(tone, 'min-w-0')}>
      {header && <RoleHeader role={role} />}
      <div className={cn('ms-3 min-w-0 border-s-2 border-[color-mix(in_oklch,var(--tone)_32%,transparent)] ps-[1.0625rem]', header && 'mbs-1.5')}>
        {children}
      </div>
    </div>
  );
}

// ---- stepper ----

export const STAGE_LABEL: Record<PipelineStage | 'done' | 'blocked', string> = {
  prepare: 'Подготовка',
  execute: 'Исполнение',
  checks: 'Проверки',
  review: 'Ревью',
  publish: 'Публикация',
  deliver: 'Доставка',
  health: 'Проверка версии',
  done: 'Готово',
  blocked: 'Остановлено',
};

const STEP_STATE_LABEL: Record<StepState, string> = {
  pending: 'впереди',
  active: 'идёт',
  passed: 'пройдено',
  failed: 'не пройдено',
  skipped: 'пропущено',
};

function StepIcon({ state }: { state: StepState }): React.ReactElement {
  if (state === 'passed') return <span className="grid size-4 place-items-center rounded-full bg-done text-white dark:text-background"><Check className="size-2.5" strokeWidth={3} /></span>;
  if (state === 'failed') return <span className="grid size-4 place-items-center rounded-full bg-destructive text-white"><X className="size-2.5" strokeWidth={3} /></span>;
  if (state === 'skipped') return <span className="grid size-4 place-items-center rounded-full bg-muted text-muted-foreground"><Minus className="size-2.5" strokeWidth={3} /></span>;
  if (state === 'active') return (
    <span className="relative grid size-4 place-items-center">
      <span className="absolute inset-0 rounded-full bg-primary/25 motion-safe:animate-ping" />
      <span className="relative size-2.5 rounded-full bg-primary ring-2 ring-primary/30" />
    </span>
  );
  return <span className="grid size-4 place-items-center"><span className="size-2 rounded-full border-[1.5px] border-muted-foreground/50" /></span>;
}

export function PipelineStepper({ progress }: { progress: PipelineProgress }): React.ReactElement {
  const current = progress.steps.find(step => step.state === 'active')
    ?? [...progress.steps].reverse().find(step => step.state === 'failed');
  const caption = progress.outcome === 'done' ? 'Конвейер завершён'
    : progress.outcome === 'blocked' ? 'Конвейер остановлен'
      : progress.outcome === 'stopped' ? 'Конвейер прерван'
        : current ? `${STAGE_LABEL[current.stage]} · ${STEP_STATE_LABEL[current.state]}` : 'Конвейер';
  return (
    <nav aria-label="Этапы конвейера" data-pf-pipeline-stepper="" className="shrink-0 border-be border-border bg-card px-3 py-2">
      <div className="mbe-1.5 flex min-w-0 items-center gap-2 text-2xs">
        <span className={cn('min-w-0 truncate font-medium', progress.outcome === 'blocked' || progress.outcome === 'stopped' || current?.state === 'failed' ? 'text-destructive' : progress.outcome === 'done' ? 'text-done-ink' : 'text-foreground')}>{caption}</span>
        {progress.round !== null && <span className="shrink-0 text-muted-foreground">раунд {progress.round}</span>}
        {progress.escalated && <span className="pf-tone-orange inline-flex shrink-0 items-center gap-0.5 rounded-sm bg-tone-bg px-1 text-tone-fg"><Zap className="size-3" aria-hidden />усиленный исполнитель</span>}
      </div>
      <ol className="flex min-w-0 items-start">
        {progress.steps.map((step, index) => (
          <li key={step.stage} data-stage={step.stage} data-state={step.state}
            aria-current={step.state === 'active' ? 'step' : undefined}
            className="flex min-w-0 flex-1 flex-col items-center gap-1 text-center">
            <div className="flex w-full items-center">
              <span className={cn('h-px flex-1', index === 0 ? 'opacity-0' : step.state === 'pending' ? 'bg-border' : 'bg-done/60')} />
              <StepIcon state={step.state} />
              <span className={cn('h-px flex-1', index === progress.steps.length - 1 ? 'opacity-0' : progress.steps[index + 1].state === 'pending' ? 'bg-border' : 'bg-done/60')} />
            </div>
            <span className={cn('max-w-full px-0.5 text-[0.625rem] leading-tight sm:text-2xs',
              step.state === 'active' ? 'font-semibold text-foreground' : step.state === 'failed' ? 'font-medium text-destructive' : step.state === 'pending' ? 'text-muted-foreground/80' : 'text-muted-foreground',
              // Phones keep every step as a dot; the caption above names the current one.
              'max-sm:sr-only')}>
              {STAGE_LABEL[step.stage]}
              <span className="sr-only">: {STEP_STATE_LABEL[step.state]}</span>
            </span>
          </li>
        ))}
      </ol>
    </nav>
  );
}

// ---- in-feed orchestrator rows ----

export function StageLine({ stage }: { stage: LiveStagePayload }): React.ReactElement {
  const label = stage.title ?? STAGE_LABEL[stage.stage];
  const failed = stage.status === 'failed' || stage.stage === 'blocked';
  const done = stage.stage === 'done' || stage.status === 'passed';
  return (
    <div data-live-stage={stage.stage} data-live-stage-status={stage.status}
      className={cn('flex min-w-0 items-baseline gap-1.5 py-0.5 text-xs', failed ? 'text-destructive' : 'text-muted-foreground')}>
      <span aria-hidden className={cn('shrink-0 font-mono', done && !failed && 'text-done')}>
        {failed ? '✗' : stage.status === 'skipped' ? '–' : done ? '✓' : '›'}
      </span>
      <span className="min-w-0 [overflow-wrap:anywhere]">
        <span className={cn('font-medium', !failed && 'text-foreground')}>
          {stage.status === 'skipped' ? `${STAGE_LABEL[stage.stage]}: пропущено` : failed && stage.stage !== 'blocked' ? `${label}: не пройдено` : label}
        </span>
        {stage.detail && <span> — {stage.detail}</span>}
      </span>
    </div>
  );
}

const DURATION_FMT = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });

export function formatDuration(ms: number): string {
  if (ms < 60_000) return `${DURATION_FMT.format(ms < 10_000 ? Math.round(ms / 100) / 10 : Math.round(ms / 1000))} с`;
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)} мин ${total % 60} с`;
}

const PHASE_LABEL: Record<LiveCheckResult['phase'], string | null> = { checks: null, delivery: 'доставка', health: 'проверка версии' };

export function CheckResultRow({ check }: { check: LiveCheckResult }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const expandable = check.command.length > 0 || !!check.outputTail;
  const phase = PHASE_LABEL[check.phase];
  const head = (
    <>
      {check.exitCode === null ? <CircleDashed className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        : check.passed ? <Check className="size-3.5 shrink-0 text-done" strokeWidth={3} aria-hidden />
          : <X className="size-3.5 shrink-0 text-destructive" strokeWidth={3} aria-hidden />}
      <span className="min-w-0 truncate font-mono font-medium text-foreground">{check.name}</span>
      <span className="sr-only">{check.exitCode === null ? 'без кода выхода' : check.passed ? 'пройдено' : 'не пройдено'}</span>
      {phase && <span className="shrink-0 rounded-sm bg-muted px-1 text-2xs text-muted-foreground">{phase}</span>}
      {!check.passed && check.exitCode !== null && <span className="shrink-0 text-2xs text-destructive">код {check.exitCode}</span>}
      <span className="ms-auto shrink-0 ps-2 font-mono text-2xs tabular-nums text-muted-foreground">{check.durationMs !== null ? formatDuration(check.durationMs) : ''}</span>
      {expandable && <ChevronRight className={cn('size-3.5 shrink-0 text-muted-foreground motion-safe:transition-transform', open && 'rotate-90')} aria-hidden />}
    </>
  );
  return (
    <div data-live-check={check.name} data-live-check-passed={check.passed}
      className={cn('min-w-0 overflow-hidden rounded-md border bg-card text-xs', check.passed || check.exitCode === null ? 'border-border' : 'border-destructive/40')}>
      {expandable ? (
        <button type="button" onClick={() => setOpen(value => !value)} aria-expanded={open}
          className="flex w-full min-w-0 items-center gap-2 px-2.5 py-1.5 text-start hover:bg-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
          {head}
        </button>
      ) : <div className="flex min-w-0 items-center gap-2 px-2.5 py-1.5">{head}</div>}
      {open && (
        <div className="border-bs border-border bg-muted/40 px-2.5 py-2">
          {check.command.length > 0 && (
            <p className="m-0 font-mono text-2xs text-foreground [overflow-wrap:anywhere]">
              <span className="select-none text-muted-foreground">$ </span>{readableWorkerCommand(check.command.join(' '))}
            </p>
          )}
          {check.outputTail ? (
            <pre className={cn('m-0 max-h-64 overflow-auto whitespace-pre-wrap font-mono text-2xs leading-relaxed text-foreground [overflow-wrap:anywhere]', check.command.length > 0 && 'mbs-1.5')}>{check.outputTail}</pre>
          ) : <p className="m-0 mbs-1 text-2xs text-muted-foreground">Вывод не сохранён.</p>}
        </div>
      )}
    </div>
  );
}

// ---- reviewer ----

const SEVERITY: Record<FindingSeverity, { label: string; className: string }> = {
  blocker: { label: 'блокер', className: 'bg-destructive-soft text-destructive' },
  major: { label: 'важное', className: 'bg-warning-soft text-warning-ink' },
  minor: { label: 'мелочь', className: 'bg-muted text-muted-foreground' },
};

function plural(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10, mod100 = count % 100;
  const word = mod10 === 1 && mod100 !== 11 ? one : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? few : many;
  return `${count} ${word}`;
}

export function ReviewVerdictCard({ verdict }: { verdict: LiveReviewVerdict }): React.ReactElement {
  return (
    <section data-live-verdict={verdict.approved ? 'approved' : 'changes'}
      aria-label={verdict.approved ? 'Ревью: одобрено' : 'Ревью: нужны правки'}
      className={cn('min-w-0 overflow-hidden rounded-lg border bg-card shadow-card', verdict.approved ? 'border-done/40' : 'border-warning/50')}>
      <header className={cn('flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2', verdict.approved ? 'bg-done-soft text-done-ink' : 'bg-warning-soft text-warning-ink')}>
        {verdict.approved ? <Check className="size-4 shrink-0" strokeWidth={2.5} aria-hidden /> : <CornerDownRight className="size-4 shrink-0" aria-hidden />}
        <span className="text-sm font-semibold">{verdict.approved ? 'Одобрено' : 'Нужны правки'}</span>
        {verdict.findings.length > 0 && <span className="text-xs">{plural(verdict.findings.length, 'замечание', 'замечания', 'замечаний')}</span>}
        {verdict.round !== null && <span className="ms-auto text-2xs opacity-80">раунд {verdict.round}</span>}
      </header>
      {verdict.summary && <CommentBody body={verdict.summary} className="px-3 pbs-2 pbe-1 text-sm leading-relaxed [overflow-wrap:anywhere]" />}
      {verdict.findings.length > 0 && (
        <ul className="m-0 list-none space-y-2 px-3 pbe-3 pbs-1">
          {verdict.findings.map((finding, index) => (
            <li key={index} data-severity={finding.severity} className="min-w-0 rounded-md border border-border bg-background/60 px-2.5 py-2">
              <div className="mbe-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className={cn('shrink-0 rounded-sm px-1.5 py-px text-2xs font-semibold', SEVERITY[finding.severity].className)}>{SEVERITY[finding.severity].label}</span>
                {finding.file && (
                  <code className="min-w-0 font-mono text-2xs text-muted-foreground [overflow-wrap:anywhere]" title={finding.file}>
                    {finding.file}{finding.line !== null ? `:${finding.line}` : ''}
                  </code>
                )}
              </div>
              <CommentBody body={finding.text} className="text-[0.8125rem] leading-snug [overflow-wrap:anywhere] [&_p]:m-0" />
            </li>
          ))}
        </ul>
      )}
      {verdict.approved && verdict.findings.length === 0 && !verdict.summary && <p className="m-0 px-3 py-2 text-xs text-muted-foreground">Замечаний нет.</p>}
    </section>
  );
}

// ---- handoff ----

const ACTOR_DATIVE: Record<string, string> = { executor: 'исполнителю', reviewer: 'ревьюеру', orchestrator: 'оркестратору' };

export function handoffLabel(handoff: LiveHandoff): string {
  const round = handoff.round !== null ? ` · раунд ${handoff.round}` : '';
  if (handoff.escalated) return `Эскалация: усиленный исполнитель${round}`;
  if (handoff.to === 'executor') return `Замечания переданы исполнителю${round}`;
  if (handoff.to) return `Передано ${ACTOR_DATIVE[handoff.to]}${round}`;
  return `Передача работы${round}`;
}

export function HandoffDivider({ handoff }: { handoff: LiveHandoff }): React.ReactElement {
  return (
    <div role="separator" aria-label={handoffLabel(handoff)} data-live-handoff={handoff.escalated ? 'escalated' : handoff.to ?? 'unknown'}
      className={cn('py-1.5', handoff.escalated ? 'pf-tone-orange' : 'pf-tone-gray')}>
      <div className="flex min-w-0 items-center gap-2">
        <span className="h-px flex-1 bg-[color-mix(in_oklch,var(--tone)_45%,transparent)]" />
        <span className={cn('inline-flex min-w-0 max-w-[85%] shrink items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-medium',
          handoff.escalated ? 'bg-tone-bg text-tone-fg' : 'text-muted-foreground')}>
          {handoff.escalated ? <Zap className="size-3 shrink-0 text-tone" aria-hidden /> : <CornerDownRight className="size-3 shrink-0" aria-hidden />}
          <span className="truncate">{handoffLabel(handoff)}</span>
        </span>
        <span className="h-px flex-1 bg-[color-mix(in_oklch,var(--tone)_45%,transparent)]" />
      </div>
      {handoff.reason && <p className="m-0 mx-auto mbs-1 line-clamp-2 max-w-prose px-2 text-center text-2xs text-muted-foreground" title={handoff.reason}>{handoff.reason}</p>}
    </div>
  );
}

// ---- executor journal ----

function lastActionPreview(event: LiveEvent | undefined): string | null {
  if (!event) return null;
  const payload = (typeof event.payload === 'object' && event.payload !== null ? event.payload : {}) as Record<string, unknown>;
  if (event.kind === 'bash' && typeof payload.command === 'string') return `$ ${readableWorkerCommand(payload.command)}`;
  if (typeof payload.path === 'string') return payload.path;
  if (event.kind === 'tool_use') return [payload.name, payload.brief].filter(part => typeof part === 'string').join(' ');
  return event.text?.split('\n')[0] ?? null;
}

export function journalTitle(round: number | null, events: readonly LiveEvent[]): { title: string; errors: number } {
  const summary = summarizeToolJournal(events);
  const parts = [`правки: ${plural(summary.files, 'файл', 'файла', 'файлов')}`, `команд: ${summary.commands}`];
  if (summary.files === 0 && summary.commands === 0) parts.splice(0, 2, `действий: ${summary.tools}`);
  return { title: `${round !== null ? `Раунд ${round}` : 'Журнал исполнителя'} · ${parts.join(', ')}`, errors: summary.errors };
}

export function ToolJournal({ round, events, live, children }: {
  round: number | null;
  events: readonly LiveEvent[];
  live: boolean;
  children: (event: LiveEvent) => React.ReactNode;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const { title, errors } = journalTitle(round, events);
  const preview = live && !open ? lastActionPreview(events.at(-1)) : null;
  return (
    <div data-live-journal={round ?? 0} className="min-w-0 overflow-hidden rounded-md border border-border bg-card">
      <button type="button" onClick={() => setOpen(value => !value)} aria-expanded={open}
        className="flex w-full min-w-0 items-center gap-2 px-2.5 py-1.5 text-start text-xs hover:bg-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
        <ChevronRight className={cn('size-3.5 shrink-0 text-muted-foreground motion-safe:transition-transform', open && 'rotate-90')} aria-hidden />
        <span className="min-w-0 truncate font-medium text-foreground">{title}</span>
        {errors > 0 && <span className="shrink-0 rounded-sm bg-destructive-soft px-1 text-2xs font-medium text-destructive">{plural(errors, 'ошибка', 'ошибки', 'ошибок')}</span>}
        <span className="ms-auto shrink-0 text-2xs text-muted-foreground">{open ? 'свернуть' : 'журнал'}</span>
      </button>
      {preview && <p className="m-0 truncate border-bs border-border px-2.5 py-1 font-mono text-2xs text-muted-foreground" title={preview}>{preview}</p>}
      {open && <div className="space-y-2 border-bs border-border bg-panel/60 p-2">{events.map(event => <div key={event.seq} className="min-w-0">{children(event)}</div>)}</div>}
    </div>
  );
}
