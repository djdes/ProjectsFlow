import { useState } from 'react';
import { FolderKanban, ListChecks } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { Collapsible } from '@/components/ui/collapsible';
import type { AiActionArtifact } from '@/domain/ai-action/AiActionArtifact';
import { artifactActionLabel, artifactHref } from '@/domain/ai-action/AiActionArtifact';

const PREVIEW_LIMIT = 6;

/**
 * «Что агент создал или изменил» за диалог. Список накопительный: удаление объекта
 * карточку не убирает, потому что это журнал действий, а не состояние воркспейса.
 */
export function AiArtifactsPanel({
  artifacts,
  loading,
}: {
  artifacts: readonly AiActionArtifact[];
  loading: boolean;
}): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? artifacts : artifacts.slice(0, PREVIEW_LIMIT);

  return (
    <Collapsible
      defaultOpen
      trigger={<span className="text-sm font-normal leading-5 text-muted-foreground">Результаты</span>}
      triggerClassName="px-2 py-1.5 hover:bg-hover"
      contentClassName="px-2 pb-3 pt-1.5"
    >
      <span className="inline-flex h-6 items-center rounded-full bg-hover px-2.5 text-xs tabular-nums text-muted-foreground">
        {loading && artifacts.length === 0 ? '…' : `Объектов: ${artifacts.length}`}
      </span>
      {artifacts.length === 0 ? (
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          {loading ? 'Загружаю результаты…' : 'Здесь появятся проекты и задачи, которые создаст или изменит агент.'}
        </p>
      ) : (
        <>
          <ul className="mt-2 flex flex-col gap-1.5">
            {visible.map((artifact) => <ArtifactCard key={artifact.id} artifact={artifact} />)}
          </ul>
          {artifacts.length > PREVIEW_LIMIT && (
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              className="mt-1 rounded-md px-1 py-1 text-xs text-muted-foreground hover:text-foreground"
            >
              {expanded ? 'Свернуть' : `Показать ещё ${artifacts.length - PREVIEW_LIMIT}`}
            </button>
          )}
        </>
      )}
    </Collapsible>
  );
}

function ArtifactCard({ artifact }: { artifact: AiActionArtifact }): React.ReactElement {
  const Icon = artifact.entityKind === 'project' ? FolderKanban : ListChecks;
  const href = artifactHref(artifact);
  const content = (
    <>
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0">
        <span className={cn('block truncate text-xs font-medium', artifact.undone && 'line-through opacity-70')}>
          {artifact.title}
        </span>
        <span className="block text-[11px] text-muted-foreground">
          {artifactActionLabel(artifact)} · ProjectsFlow
        </span>
      </span>
    </>
  );
  return (
    <li>
      {href ? (
        <Link to={href} className="flex items-start gap-2 rounded-lg border bg-card px-2.5 py-2 hover:bg-hover">
          {content}
        </Link>
      ) : (
        <span className="flex items-start gap-2 rounded-lg border bg-card px-2.5 py-2">{content}</span>
      )}
    </li>
  );
}
