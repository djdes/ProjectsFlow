import { FileWarning, Folder, KeyRound, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { KbDocumentSummary } from '@/domain/kb/KbDocument';

type Props = {
  documents: KbDocumentSummary[];
  activePath: string | null;
  onPick: (path: string) => void;
  /** Called when the user clicks "+" on a folder — passes the folder name */
  onNewFile?: (folder: string) => void;
  /** Quick bulk-create button — currently only credentials folder uses it. */
  onBulkCreate?: (folder: string) => void;
};

const FOLDER_ORDER = ['credentials', 'decisions', 'services', 'schemas', 'runbooks', 'notes', 'agents'];

export const FOLDER_TO_TYPE: Record<string, string> = {
  credentials: 'credential',
  decisions: 'decision',
  services: 'service',
  schemas: 'schema',
  runbooks: 'runbook',
  notes: 'note',
  agents: 'agent',
};

function folderOf(path: string): string {
  const idx = path.indexOf('/');
  return idx === -1 ? 'notes' : path.slice(0, idx);
}

export function KbFileTree({
  documents,
  activePath,
  onPick,
  onNewFile,
  onBulkCreate,
}: Props): React.ReactElement {
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
            <div className="group flex items-center gap-1.5 px-2 py-1 text-[11px] uppercase tracking-widest text-muted-foreground">
              <Folder className="size-3 shrink-0" />
              <span className="flex-1">{folder}</span>
              {onBulkCreate && folder === 'credentials' && (
                <button
                  type="button"
                  aria-label="Быстрое создание credential"
                  title="Быстрое создание credential (paste KEY:VALUE)"
                  onClick={() => onBulkCreate(folder)}
                  className="invisible rounded p-0.5 transition-colors hover:bg-muted hover:text-foreground group-hover:visible"
                >
                  <KeyRound className="size-3" />
                </button>
              )}
              {onNewFile && (
                <button
                  type="button"
                  aria-label={`Создать заметку в ${folder}`}
                  onClick={() => onNewFile(folder)}
                  className="invisible rounded p-0.5 transition-colors hover:bg-muted hover:text-foreground group-hover:visible"
                >
                  <Plus className="size-3" />
                </button>
              )}
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
                        <FileWarning
                          className="size-3.5 shrink-0 text-amber-500"
                          aria-label="invalid frontmatter"
                        />
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
