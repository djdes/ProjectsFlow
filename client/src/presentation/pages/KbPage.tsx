import { PageSkeleton, DocumentSkeleton, ListSkeleton } from '@/presentation/components/loading/LoadingLayouts';
import { PageLoadError } from '@/presentation/components/loading/PageLoadError';
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
import { ProjectBreadcrumbs } from '@/presentation/layout/ProjectBreadcrumbs';
import { PageTopBar } from '@/presentation/layout/PageChrome';
import { PageMessage } from '@/presentation/pages/PageScaffold';

export function KbPage(): React.ReactElement {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: project, loading: projectLoading, error: projectError } = useProject(projectId ?? '');
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

  if (projectLoading) return <PageSkeleton layout="document" />;
  if (projectError) return <PageLoadError />;
  if (!project) return <PageMessage title="Проект не найден" />;

  // Шапка C4 — та же строка 44px с крошками проекта, что у финансов и мониторинга.
  const breadcrumbs = (
    <ProjectBreadcrumbs
      projectId={project.id}
      projectName={project.name}
      projectIcon={project.icon}
      view="kb"
    />
  );

  if (project.kbKind === 'none') {
    return (
      <div className="flex min-h-full flex-col">
        <PageTopBar>{breadcrumbs}</PageTopBar>
        <PageMessage
          className="min-h-0 flex-1"
          title="KB не подключён"
          description="Подключи KB-репо на странице проекта."
        >
          <Button asChild variant="outline">
            <Link to={`/projects/${project.id}`}>К проекту</Link>
          </Button>
        </PageMessage>
      </div>
    );
  }

  const sidebarContent = (
    <aside className="flex h-full flex-col overflow-y-auto p-3">
      {/* Плавающий бургер свёрнутой панели теперь стоит в строке крошек над деревом, поэтому
          отступ под него (pf-burger-gap) кнопке больше не нужен. */}
      <div className="mbe-3 flex">
        <Button asChild variant="ghost" size="sm" className="-ms-2 gap-1">
          <Link to={`/projects/${project.id}`}>
            <ArrowLeft className="size-3.5" />
            К проекту
          </Link>
        </Button>
      </div>
      <p className="px-2 pbe-2 text-xs font-medium uppercase tracking-widest text-muted-foreground">
        {project.name} / KB
      </p>
      <KbSearchBar value={searchQuery} onChange={setSearchQuery} />
      {treeLoading && <ListSkeleton rows={5} />}
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
    <div className="min-h-0 overflow-y-auto px-4 pbe-12 pbs-4 sm:px-6 sm:pbs-5">
      {activePath && docLoading && <DocumentSkeleton />}
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
    </div>
  );

  return (
    <>
      {isDesktop ? (
        <div className="flex h-full flex-col">
          <PageTopBar>{breadcrumbs}</PageTopBar>
          <div className="grid min-h-0 flex-1 grid-cols-[280px_1fr] gap-0">
            <div className="min-h-0 border-e">{sidebarContent}</div>
            {mainContent}
          </div>
        </div>
      ) : (
        <div className="flex h-full flex-col">
          {/* На мобиле дерево файлов — в выезжающей панели; кнопка открывает её слева, рядом
              с крошками («Проекты › проект › База знаний» заменили подпись «проект / KB»). */}
          <PageTopBar>
            <Button variant="ghost" size="icon" className="-ms-1.5 shrink-0" onClick={() => setDrawerOpen(true)} aria-label="Открыть дерево файлов">
              <PanelLeft className="size-4" />
            </Button>
            {breadcrumbs}
          </PageTopBar>
          {mainContent}
          <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
            <SheetContent side="left" mobileSheet={false} className="w-72 p-0">
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
