import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useProject } from '@/presentation/hooks/useProject';
import { useKbTree } from '@/presentation/hooks/useKbTree';
import { useKbDocument } from '@/presentation/hooks/useKbDocument';
import { KbFileTree } from '@/presentation/components/kb/KbFileTree';
import { KbDocumentViewer } from '@/presentation/components/kb/KbDocumentViewer';
import { KbDocumentEditor } from '@/presentation/components/kb/KbDocumentEditor';

export function KbPage(): React.ReactElement {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: project, loading: projectLoading } = useProject(projectId ?? '');
  const { documents, loading: treeLoading, error: treeError, reload: reloadTree } = useKbTree(projectId ?? '');
  const [activePath, setActivePath] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const { document, loading: docLoading, reload } = useKbDocument(projectId ?? '', activePath);

  if (projectLoading) return <div className="p-6">Загрузка…</div>;
  if (!project) return <div className="p-6">Проект не найден</div>;
  if (!project.kbRepoFullName) {
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

  return (
    <div className="grid h-full grid-cols-[280px_1fr] gap-0">
      <aside className="border-r p-3 overflow-y-auto">
        <Button asChild variant="ghost" size="sm" className="mb-3 -ml-2 gap-1">
          <Link to={`/projects/${project.id}`}>
            <ArrowLeft className="size-3.5" />
            К проекту
          </Link>
        </Button>
        <p className="px-2 pb-2 text-xs font-medium uppercase tracking-widest text-muted-foreground">
          {project.name} / KB
        </p>
        {treeLoading && <p className="px-2 text-sm text-muted-foreground">Загрузка дерева…</p>}
        {treeError && <p className="px-2 text-sm text-destructive">Не удалось загрузить дерево.</p>}
        {documents && (
          <KbFileTree documents={documents} activePath={activePath} onPick={(path) => { setActivePath(path); setEditing(false); }} />
        )}
      </aside>
      <main className="overflow-y-auto p-6">
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
            document={document}
            kbRepoFullName={project.kbRepoFullName!}
            onEdit={() => setEditing(true)}
          />
        ))}
        {!activePath && <p className="text-sm text-muted-foreground">Выбери файл слева.</p>}
      </main>
    </div>
  );
}
