import { useMemo } from 'react';
import { cn } from '@/lib/utils';

// Кастомный diff-рендер БЕЗ внешних либ. Тема-адаптивный: светлая (мягкая «Cursor light»,
// не белая) и тёмная («Cursor dark»). Контент всегда plaintext (текстовые ноды) —
// НИКОГДА не инжектим HTML, диффы содержат произвольный код.
//
//  mode='hunks'   — две колонки «было | стало» (CSS-grid), нумерация строк.
//  mode='unified' — единая колонка с +/- раскраской и двойной нумерацией (old|new).
type HunksProps = {
  mode: 'hunks';
  before: string;
  after: string;
  className?: string;
};

type UnifiedProps = {
  mode: 'unified';
  unifiedDiff: string;
  className?: string;
};

type Props = HunksProps | UnifiedProps;

export function DiffView(props: Props): React.ReactElement {
  if (props.mode === 'unified') {
    return <UnifiedDiff unifiedDiff={props.unifiedDiff} className={props.className} />;
  }
  return <HunkDiff before={props.before} after={props.after} className={props.className} />;
}

function HunkDiff({
  before,
  after,
  className,
}: {
  before: string;
  after: string;
  className?: string;
}): React.ReactElement {
  const beforeLines = useMemo(() => before.split('\n'), [before]);
  const afterLines = useMemo(() => after.split('\n'), [after]);

  return (
    <div
      className={cn(
        'grid grid-cols-2 gap-px overflow-clip rounded-md border border-zinc-200 bg-zinc-200 font-mono text-2xs leading-[1.55] dark:border-white/10 dark:bg-white/10',
        className,
      )}
    >
      <DiffColumn title="− было" lines={beforeLines} tone="del" />
      <DiffColumn title="+ стало" lines={afterLines} tone="add" />
    </div>
  );
}

function DiffColumn({
  title,
  lines,
  tone,
}: {
  title: string;
  lines: string[];
  tone: 'add' | 'del';
}): React.ReactElement {
  const isDel = tone === 'del';
  const isEmpty = lines.length === 0 || (lines.length === 1 && lines[0]!.length === 0);
  return (
    <div className={cn('overflow-x-auto', isDel ? 'bg-rose-50 dark:bg-[oklch(23.34%_0.037_14.8)]' : 'bg-emerald-50 dark:bg-[oklch(23.59%_0.032_163.25)]')}>
      <div
        className={cn(
          'sticky start-0 inset-bs-0 z-[1] border-be px-2 py-1 text-2xs font-semibold uppercase tracking-wider backdrop-blur',
          isDel
            ? 'border-rose-200 bg-rose-50/90 text-rose-600 dark:border-white/10 dark:bg-[oklch(23.34%_0.037_14.8/0.9)] dark:text-[oklch(73.77%_0.138_32.5)]'
            : 'border-emerald-200 bg-emerald-50/90 text-emerald-700 dark:border-white/10 dark:bg-[oklch(23.59%_0.032_163.25/0.9)] dark:text-[oklch(84.16%_0.164_145.75)]',
        )}
      >
        {title}
      </div>
      {isEmpty ? (
        <div className="px-2 py-1 text-2xs italic text-zinc-400 dark:text-[oklch(66.25%_0.018_250.92)]">(пусто)</div>
      ) : (
        <div className="min-w-full py-0.5">
          {lines.map((ln, i) => (
            <div key={i} className="flex">
              <span className="w-8 shrink-0 select-none px-1 text-end text-zinc-500 dark:text-[oklch(48.93%_0.016_251.69)]">
                {i + 1}
              </span>
              <pre
                className={cn(
                  'm-0 flex-1 whitespace-pre px-2',
                  isDel ? 'text-rose-700 dark:text-[oklch(81.18%_0.058_18.43)]' : 'text-emerald-800 dark:text-[oklch(86.28%_0.086_153.61)]',
                )}
              >
                {ln.length > 0 ? ln : ' '}
              </pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

type ULine = {
  text: string;
  type: 'add' | 'del' | 'ctx' | 'hunk' | 'meta';
  oldNo: number | null;
  newNo: number | null;
};

function parseUnified(diff: string): ULine[] {
  const out: ULine[] = [];
  let oldNo = 0;
  let newNo = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('@@')) {
      const m = /@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      if (m) {
        oldNo = Number(m[1]);
        newNo = Number(m[2]);
      }
      out.push({ text: line, type: 'hunk', oldNo: null, newNo: null });
      continue;
    }
    if (
      line.startsWith('+++') ||
      line.startsWith('---') ||
      line.startsWith('diff ') ||
      line.startsWith('index ') ||
      line.startsWith('new file') ||
      line.startsWith('deleted file') ||
      line.startsWith('similarity ') ||
      line.startsWith('rename ') ||
      line.startsWith('\\')
    ) {
      out.push({ text: line, type: 'meta', oldNo: null, newNo: null });
      continue;
    }
    if (line.startsWith('+')) {
      out.push({ text: line, type: 'add', oldNo: null, newNo });
      newNo += 1;
      continue;
    }
    if (line.startsWith('-')) {
      out.push({ text: line, type: 'del', oldNo, newNo: null });
      oldNo += 1;
      continue;
    }
    out.push({ text: line, type: 'ctx', oldNo, newNo });
    oldNo += 1;
    newNo += 1;
  }
  return out;
}

function UnifiedDiff({
  unifiedDiff,
  className,
}: {
  unifiedDiff: string;
  className?: string;
}): React.ReactElement {
  const lines = useMemo(() => parseUnified(unifiedDiff), [unifiedDiff]);

  return (
    <div
      className={cn(
        'overflow-x-auto rounded-md border border-zinc-200 bg-white font-mono text-2xs leading-[1.55] dark:border-white/10 dark:bg-[oklch(20.9%_0_none)]',
        className,
      )}
    >
      <div className="min-w-full py-0.5">
        {lines.map((l, i) => {
          const rowBg =
            l.type === 'add'
              ? 'bg-emerald-50 dark:bg-[oklch(23.59%_0.032_163.25)]'
              : l.type === 'del'
                ? 'bg-rose-50 dark:bg-[oklch(23.34%_0.037_14.8)]'
                : l.type === 'hunk'
                  ? 'bg-sky-50 dark:bg-[oklch(25.88%_0.047_257.85)]'
                  : '';
          const textCls =
            l.type === 'add'
              ? 'text-emerald-700 dark:text-[oklch(84.16%_0.164_145.75)]'
              : l.type === 'del'
                ? 'text-rose-700 dark:text-[oklch(73.77%_0.138_32.5)]'
                : l.type === 'hunk'
                  ? 'text-sky-600 dark:text-[oklch(71.53%_0.152_253.31)]'
                  : l.type === 'meta'
                    ? 'text-zinc-500 dark:text-[oklch(48.93%_0.016_251.69)]'
                    : 'text-zinc-700 dark:text-[oklch(85.69%_0.014_247.99)]';
          return (
            <div key={i} className={cn('flex', rowBg)}>
              <span className="w-9 shrink-0 select-none border-e border-zinc-200 px-1 text-end text-[10px] text-zinc-400 dark:border-white/5 dark:text-[oklch(48.93%_0.016_251.69)]">
                {l.oldNo ?? ''}
              </span>
              <span className="w-9 shrink-0 select-none border-e border-zinc-200 px-1 text-end text-[10px] text-zinc-400 dark:border-white/5 dark:text-[oklch(48.93%_0.016_251.69)]">
                {l.newNo ?? ''}
              </span>
              <pre className={cn('m-0 flex-1 whitespace-pre px-2', textCls)}>
                {l.text.length > 0 ? l.text : ' '}
              </pre>
            </div>
          );
        })}
      </div>
    </div>
  );
}
