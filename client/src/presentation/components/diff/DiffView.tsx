import { useMemo } from 'react';
import { cn } from '@/lib/utils';

// Кастомный diff-рендер БЕЗ внешних либ (jsdiff/word-diff — опц. v2).
//
//  mode='hunks'   — две колонки «было | стало» (CSS-grid), monospace, red/green фон.
//                   Для real-time Edit/MultiEdit-хунков (old_string → new_string).
//  mode='unified' — единая колонка с +/- раскраской строк. Для финального
//                   git unified-диффа файла.
//
// Контент всегда рендерится как plaintext (текстовые ноды) — НИКОГДА не инжектим HTML,
// диффы могут содержать произвольный код пользователя.
type HunksProps = {
  mode: 'hunks';
  // before/after — текст до и после правки (old_string / new_string одного Edit).
  before: string;
  after: string;
  className?: string;
};

type UnifiedProps = {
  mode: 'unified';
  // Готовый unified-diff (строки с префиксами ' '/'+'/'-'/'@'/'\').
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

// Две колонки «было | стало». Каждая колонка — свой набор строк, выровнены по верху.
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
        'grid grid-cols-2 gap-px overflow-hidden rounded-md border bg-border font-mono text-[11px] leading-relaxed',
        className,
      )}
    >
      <div className="overflow-x-auto bg-rose-500/5">
        <div className="border-b border-border/60 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-rose-600 dark:text-rose-400">
          было
        </div>
        <pre className="m-0 whitespace-pre px-2 py-1 text-rose-700 dark:text-rose-300">
          {beforeLines.length > 0 ? beforeLines.join('\n') : ' '}
        </pre>
      </div>
      <div className="overflow-x-auto bg-emerald-500/5">
        <div className="border-b border-border/60 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
          стало
        </div>
        <pre className="m-0 whitespace-pre px-2 py-1 text-emerald-700 dark:text-emerald-300">
          {afterLines.length > 0 ? afterLines.join('\n') : ' '}
        </pre>
      </div>
    </div>
  );
}

// Единая колонка с +/- раскраской по первому символу строки.
function UnifiedDiff({
  unifiedDiff,
  className,
}: {
  unifiedDiff: string;
  className?: string;
}): React.ReactElement {
  const lines = useMemo(() => unifiedDiff.split('\n'), [unifiedDiff]);

  return (
    <div
      className={cn(
        'overflow-x-auto rounded-md border bg-muted/30 font-mono text-[11px] leading-relaxed',
        className,
      )}
    >
      <pre className="m-0 whitespace-pre px-2 py-1">
        {lines.map((line, i) => {
          const first = line.charCodeAt(0);
          // '+' = 43, '-' = 45, '@' = 64. Хедеры (+++/---) трогаем как обычный контекст.
          const isAdd = first === 43 && !line.startsWith('+++');
          const isDel = first === 45 && !line.startsWith('---');
          const isHunk = first === 64; // '@@ ... @@'
          return (
            <span
              key={i}
              className={cn(
                'block',
                isAdd && 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
                isDel && 'bg-rose-500/10 text-rose-700 dark:text-rose-300',
                isHunk && 'text-sky-600 dark:text-sky-400',
              )}
            >
              {line.length > 0 ? line : ' '}
            </span>
          );
        })}
      </pre>
    </div>
  );
}
