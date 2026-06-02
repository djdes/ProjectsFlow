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
        'grid grid-cols-2 gap-px overflow-hidden rounded-md border border-zinc-200 bg-zinc-200 font-mono text-[11px] leading-[1.55] dark:border-white/10 dark:bg-white/10',
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
    <div className={cn('overflow-x-auto', isDel ? 'bg-rose-50 dark:bg-[#2d1618]' : 'bg-emerald-50 dark:bg-[#0f231a]')}>
      <div
        className={cn(
          'sticky left-0 top-0 z-[1] border-b px-2 py-1 text-[10px] font-semibold uppercase tracking-wider backdrop-blur',
          isDel
            ? 'border-rose-200 bg-rose-50/90 text-rose-600 dark:border-white/10 dark:bg-[#2d1618]/90 dark:text-[#f48771]'
            : 'border-emerald-200 bg-emerald-50/90 text-emerald-700 dark:border-white/10 dark:bg-[#0f231a]/90 dark:text-[#7ee787]',
        )}
      >
        {title}
      </div>
      {isEmpty ? (
        <div className="px-2 py-1 text-[10px] italic text-zinc-400 dark:text-[#8b949e]">(пусто)</div>
      ) : (
        <div className="min-w-full py-0.5">
          {lines.map((ln, i) => (
            <div key={i} className="flex">
              <span className="w-8 shrink-0 select-none px-1 text-right text-zinc-500 dark:text-[#5a6169]">
                {i + 1}
              </span>
              <pre
                className={cn(
                  'm-0 flex-1 whitespace-pre px-2',
                  isDel ? 'text-rose-700 dark:text-[#e5b3b3]' : 'text-emerald-800 dark:text-[#a6e3b8]',
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
        'overflow-x-auto rounded-md border border-zinc-200 bg-white font-mono text-[11px] leading-[1.55] dark:border-white/10 dark:bg-[#181818]',
        className,
      )}
    >
      <div className="min-w-full py-0.5">
        {lines.map((l, i) => {
          const rowBg =
            l.type === 'add'
              ? 'bg-emerald-50 dark:bg-[#0f231a]'
              : l.type === 'del'
                ? 'bg-rose-50 dark:bg-[#2d1618]'
                : l.type === 'hunk'
                  ? 'bg-sky-50 dark:bg-[#15243a]'
                  : '';
          const textCls =
            l.type === 'add'
              ? 'text-emerald-700 dark:text-[#7ee787]'
              : l.type === 'del'
                ? 'text-rose-700 dark:text-[#f48771]'
                : l.type === 'hunk'
                  ? 'text-sky-600 dark:text-[#58a6ff]'
                  : l.type === 'meta'
                    ? 'text-zinc-500 dark:text-[#5a6169]'
                    : 'text-zinc-700 dark:text-[#c9d1d9]';
          return (
            <div key={i} className={cn('flex', rowBg)}>
              <span className="w-9 shrink-0 select-none border-r border-zinc-200 px-1 text-right text-[10px] text-zinc-400 dark:border-white/5 dark:text-[#5a6169]">
                {l.oldNo ?? ''}
              </span>
              <span className="w-9 shrink-0 select-none border-r border-zinc-200 px-1 text-right text-[10px] text-zinc-400 dark:border-white/5 dark:text-[#5a6169]">
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
