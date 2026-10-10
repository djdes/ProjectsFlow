import { useMemo } from 'react';
import { cn } from '@/lib/utils';

// Кастомный diff-рендер БЕЗ внешних либ. Тема-адаптивный на токенах дизайна C4: строки
// «удалено/добавлено» — полупрозрачный тинт статусных цветов (destructive/done) поверх
// карточки, сам код — основным цветом, как в Cursor/GitHub. Контент всегда plaintext
// (текстовые ноды) — НИКОГДА не инжектим HTML, диффы содержат произвольный код.
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
        'grid grid-cols-2 overflow-clip rounded-md border border-border bg-card font-mono text-2xs leading-[1.55]',
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
    <div className={cn('overflow-x-auto', isDel ? 'bg-destructive/10' : 'border-s border-border bg-done/10')}>
      <div
        className={cn(
          'sticky start-0 inset-bs-0 z-[1] border-be border-border bg-card/90 px-2 py-1 text-2xs font-semibold uppercase tracking-wider backdrop-blur',
          isDel ? 'text-destructive' : 'text-done',
        )}
      >
        {title}
      </div>
      {isEmpty ? (
        <div className="px-2 py-1 text-2xs italic text-muted-foreground">(пусто)</div>
      ) : (
        <div className="min-w-full py-0.5">
          {lines.map((ln, i) => (
            <div key={i} className="flex">
              <span className="w-8 shrink-0 select-none px-1 text-end text-muted-foreground/70">
                {i + 1}
              </span>
              <pre className="m-0 flex-1 whitespace-pre px-2 text-foreground">
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
        'overflow-x-auto rounded-md border border-border bg-card font-mono text-2xs leading-[1.55]',
        className,
      )}
    >
      <div className="min-w-full py-0.5">
        {lines.map((l, i) => {
          const rowBg =
            l.type === 'add'
              ? 'bg-done/10'
              : l.type === 'del'
                ? 'bg-destructive/10'
                : l.type === 'hunk'
                  ? 'bg-primary/10'
                  : '';
          const textCls =
            l.type === 'hunk'
              ? 'text-primary-ink'
              : l.type === 'meta'
                ? 'text-muted-foreground'
                : 'text-foreground';
          return (
            <div key={i} className={cn('flex', rowBg)}>
              <span className="w-9 shrink-0 select-none border-e border-border/60 px-1 text-end text-muted-foreground/70">
                {l.oldNo ?? ''}
              </span>
              <span className="w-9 shrink-0 select-none border-e border-border/60 px-1 text-end text-muted-foreground/70">
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
