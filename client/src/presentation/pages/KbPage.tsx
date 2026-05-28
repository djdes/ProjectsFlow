import { useState, useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, PanelLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { useProject } from '@/presentation/hooks/useProject';
import { useKbTree } from '@/presentation/hooks/useKbTree';
import { useKbDocument } from '@/presentation/hooks/useKbDocument';
import { useMediaQuery } from '@/presentation/hooks/useMediaQuery';
import { KbFileTree, FOLDER_TO_TYPE } from '@/presentation/components/kb/KbFileTree';
import { KbDocumentViewer } from '@/presentation/components/kb/KbDocumentViewer';
import { KbDocumentEditor } from '@/presentation/components/kb/KbDocumentEditor';
import { NewKbDocumentDialog } from '@/presentation/components/kb/NewKbDocumentDialog';
import { BulkCredentialDialog } from '@/presentation/components/kb/BulkCredentialDialog';
import { KbSearchBar } from '@/presentation/components/kb/KbSearchBar';

export function KbPage(): React.ReactElement {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: project, loading: projectLoading } = useProject(projectId ?? '');
  const { documents, loading: treeLoading, error: treeError, reload: reloadTree } = useKbTree(projectId ?? '');
  const [activePath, setActivePath] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const { document, loading: docLoading, reload } = useKbDocument(projectId ?? '', activePath);
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Feature A: new file dialog
  const [newFileFolder, setNewFileFolder] = useState<string | null>(null);

  // Bulk-create credentials
  const [bulkOpen, setBulkOpen] = useState(false);

  // Feature C: search
  const [searchQuery, setSearchQuery] = useState('');

  const filtered = useMemo(() => {
    if (!documents) return null;
    const q = searchQuery.trim().toLowerCase();
    if (!q) return documents;
    return documents.filter((d) => {
      const title = (typeof d.frontmatter.title === 'string' ? d.frontmatter.title : '').toLowerCase();
      return title.includes(q) || d.path.toLowerCase().includes(q);
    });
  }, [documents, searchQuery]);

  if (projectLoading) return <div className="p-6">Загрузка…</div>;
  if (!project) return <div className="p-6">Проект не найден</div>;
  if (project.kbKind === 'none') {
    return (
      <div className="grid h-full place-items-center p-6">
        <div className="max-w-md space-y-3 text-center">
          <h1 className="text-xl font-semibold">KB не подключён</h1>
          <p className="text-sm text-muted-foreground">Подключи KB-репо на странице проекта.</p>
          <Button asChild variant="outline">
            <Link to={`/projects/${project.id}`}>К проекту</Link>
          </Button>
        </div>
      </div>
    );
  }

  const sidebarContent = (
    <aside className="flex h-full flex-col overflow-y-auto p-3">
      <Button asChild variant="ghost" size="sm" className="mb-3 -ml-2 gap-1">
        <Link to={`/projects/${project.id}`}>
          <ArrowLeft className="size-3.5" />
          К проекту
        </Link>
      </Button>
      <p className="px-2 pb-2 text-xs font-medium uppercase tracking-widest text-muted-foreground">
        {project.name} / KB
      </p>
      <KbSearchBar value={searchQuery} onChange={setSearchQuery} />
      {treeLoading && <p className="px-2 text-sm text-muted-foreground">Загрузка дерева…</p>}
      {treeError && <p className="px-2 text-sm text-destructive">Не удалось загрузить дерево.</p>}
      {filtered !== null && (
        <KbFileTree
          documents={filtered}
          activePath={activePath}
          onPick={(path) => { setActivePath(path); setEditing(false); setDrawerOpen(false); }}
          onNewFile={(folder) => setNewFileFolder(folder)}
          onBulkCreate={() => setBulkOpen(true)}
        />
      )}
    </aside>
  );

  const mainContent = (
    <main className="overflow-y-auto p-4 md:p-6">
      {activePath && docLoading && <p className="text-sm text-muted-foreground">Загрузка…</p>}
      {activePath && document && (editing ? (
        <KbDocumentEditor
          projectId={projectId ?? ''}
          document={document}
          onCancel={() => setEditing(false)}
          onSaved={() => { setEditing(false); reload(); reloadTree(); }}
        />
      ) : (
        <KbDocumentViewer
          projectId={projectId ?? ''}
          document={document}
          kbRepoFullName={project.kbRepoFullName!}
          onEdit={() => setEditing(true)}
          onUpdated={() => { reload(); }}
        />
      ))}
      {!activePath && (
        <p className="text-sm text-muted-foreground">
          {isDesktop ? 'Выбери файл слева.' : 'Нажми кнопку слева, чтобы открыть дерево файлов.'}
        </p>
      )}
    </main>
  );

  return (
    <>
      {isDesktop ? (
        <div className="grid h-full grid-cols-[280px_1fr] gap-0">
          <div className="border-r">{sidebarContent}</div>
          {mainContent}
        </div>
      ) : (
        <div className="flex h-full flex-col">
          <div className="flex items-center gap-2 border-b px-2 py-1.5">
            <Button variant="ghost" size="icon" className="size-8" onClick={() => setDrawerOpen(true)} aria-label="Открыть дерево файлов">
              <PanelLeft className="size-4" />
            </Button>
            <p className="truncate text-xs font-medium text-muted-foreground">{project.name} / KB</p>
          </div>
          {mainContent}
          <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
            <SheetContent side="left" className="w-72 p-0">
              {sidebarContent}
            </SheetContent>
          </Sheet>
        </div>
      )}

      {newFileFolder !== null && (
        <NewKbDocumentDialog
          open={newFileFolder !== null}
          onOpenChange={(o) => { if (!o) setNewFileFolder(null); }}
          projectId={projectId ?? ''}
          folder={newFileFolder}
          typePreset={FOLDER_TO_TYPE[newFileFolder] ?? 'note'}
          onCreated={(path) => {
            setNewFileFolder(null);
            reloadTree();
            setActivePath(path);
            setEditing(false);
          }}
          onOpenBulk={() => {
            setNewFileFolder(null);
            setBulkOpen(true);
          }}
        />
      )}

      <BulkCredentialDialog
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        projectId={projectId ?? ''}
        onCreated={(path) => {
          reloadTree();
          setActivePath(path);
          setEditing(false);
        }}
      />
    </>
  );
}
