import { useMemo } from 'react';
import { cn } from '@/lib/utils';

// Кастомный diff-рендер БЕЗ внешних либ (jsdiff/word-diff — опц. v2).
// Заточен под тёмную «Cursor/VS Code»-палитру LIVE-вкладки (рендерится внутри .dark-скоупа).
//
//  mode='hunks'   — две колонки «было | стало» (CSS-grid), monospace, нумерация строк.
//                   Для real-time Edit/MultiEdit-хунков (old_string → new_string).
//  mode='unified' — единая колонка с +/- раскраской и двойной нумерацией (old|new),
//                   как в GitHub/Cursor. Для финального git unified-диффа файла.
//
// Контент всегда рендерится как plaintext (текстовые ноды) — НИКОГДА не инжектим HTML,
// диффы могут содержать произвольный код пользователя.
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

// === hunks: две колонки «было | стало», каждая с нумерацией строк ===
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
        'grid grid-cols-2 gap-px overflow-hidden rounded-md border border-white/10 bg-white/10 font-mono text-[11px] leading-[1.55]',
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
    <div className={cn('overflow-x-auto', isDel ? 'bg-[#2d1618]' : 'bg-[#0f231a]')}>
      <div
        className={cn(
          'sticky left-0 top-0 z-[1] border-b border-white/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider backdrop-blur',
          isDel ? 'bg-[#2d1618]/90 text-[#f48771]' : 'bg-[#0f231a]/90 text-[#7ee787]',
        )}
      >
        {title}
      </div>
      {isEmpty ? (
        <div className="px-2 py-1 text-[10px] italic text-[#8b949e]">(пусто)</div>
      ) : (
        <div className="min-w-full py-0.5">
          {lines.map((ln, i) => (
          <div key={i} className="flex">
            <span className="w-8 shrink-0 select-none px-1 text-right text-[#5a6169]">{i + 1}</span>
            <pre
              className={cn(
                'm-0 flex-1 whitespace-pre px-2',
                isDel ? 'text-[#e5b3b3]' : 'text-[#a6e3b8]',
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

// === unified: единая колонка, двойная нумерация (old|new), +/- раскраска ===
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
    // контекст (' ' или пустая строка)
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
        'overflow-x-auto rounded-md border border-white/10 bg-[#181818] font-mono text-[11px] leading-[1.55]',
        className,
      )}
    >
      <div className="min-w-full py-0.5">
        {lines.map((l, i) => {
          const rowBg =
            l.type === 'add'
              ? 'bg-[#0f231a]'
              : l.type === 'del'
                ? 'bg-[#2d1618]'
                : l.type === 'hunk'
                  ? 'bg-[#15243a]'
                  : '';
          const textCls =
            l.type === 'add'
              ? 'text-[#7ee787]'
              : l.type === 'del'
                ? 'text-[#f48771]'
                : l.type === 'hunk'
                  ? 'text-[#58a6ff]'
                  : l.type === 'meta'
                    ? 'text-[#5a6169]'
                    : 'text-[#c9d1d9]';
          return (
            <div key={i} className={cn('flex', rowBg)}>
              <span className="w-9 shrink-0 select-none border-r border-white/5 px-1 text-right text-[10px] text-[#5a6169]">
                {l.oldNo ?? ''}
              </span>
              <span className="w-9 shrink-0 select-none border-r border-white/5 px-1 text-right text-[10px] text-[#5a6169]">
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
