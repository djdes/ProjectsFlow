import { FileWarning, Folder } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { KbDocumentSummary } from '@/domain/kb/KbDocument';

type Props = {
  documents: KbDocumentSummary[];
  activePath: string | null;
  onPick: (path: string) => void;
};

const FOLDER_ORDER = ['credentials', 'decisions', 'services', 'schemas', 'runbooks', 'notes'];

function folderOf(path: string): string {
  const idx = path.indexOf('/');
  return idx === -1 ? 'notes' : path.slice(0, idx);
}

export function KbFileTree({ documents, activePath, onPick }: Props): React.ReactElement {
  const byFolder = new Map<string, KbDocumentSummary[]>();
  for (const d of documents) {
    const f = folderOf(d.path);
    if (!byFolder.has(f)) byFolder.set(f, []);
    byFolder.get(f)!.push(d);
  }

  const folders = [...FOLDER_ORDER];
  for (const f of byFolder.keys()) if (!folders.includes(f)) folders.push(f);

  return (
    <div className="space-y-3">
      {folders.map((folder) => {
        const items = byFolder.get(folder) ?? [];
        return (
          <div key={folder}>
            <div className="flex items-center gap-1.5 px-2 py-1 text-[11px] uppercase tracking-widest text-muted-foreground">
              <Folder className="size-3" />
              {folder}
            </div>
            <ul className="space-y-0.5">
              {items.length === 0 && (
                <li className="px-2 py-1 text-xs text-muted-foreground/60">пусто</li>
              )}
              {items.map((d) => {
                const fileName = d.path.split('/').pop() ?? d.path;
                const title = (d.frontmatter.title as string) ?? fileName;
                return (
                  <li key={d.path}>
                    <button
                      type="button"
                      onClick={() => onPick(d.path)}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted',
                        activePath === d.path && 'bg-accent text-accent-foreground',
                      )}
                    >
                      <span className="flex-1 truncate">{title}</span>
                      {d.validationErrors.length > 0 && (
                        <FileWarning className="size-3.5 shrink-0 text-amber-500"
                          aria-label="invalid frontmatter" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
