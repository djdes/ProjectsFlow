import { useState } from 'react';
import { FileText, FolderKanban, ListChecks, NotebookText } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Collapsible } from '@/components/ui/collapsible';
import type { AiKnowledgeSource, AiKnowledgeSourceKind } from '@/domain/ai-chat/AiKnowledgeSource';
import { knowledgeSourceSubtitle } from '@/domain/ai-chat/AiKnowledgeSource';

const PREVIEW_LIMIT = 6;

const KIND_ICONS: Record<AiKnowledgeSourceKind, typeof FileText> = {
  project: FolderKanban,
  task: ListChecks,
  kb_page: NotebookText,
  document: FileText,
};

/** «Что агент просматривал»: чип с числом результатов + список источников. */
export function AiKnowledgePanel({
  sources,
  loading,
}: {
  sources: readonly AiKnowledgeSource[];
  loading: boolean;
}): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? sources : sources.slice(0, PREVIEW_LIMIT);

  return (
    <Collapsible
      defaultOpen
      trigger={<span className="text-sm font-normal leading-5 text-muted-foreground">Знания</span>}
      triggerClassName="px-2 py-1.5 hover:bg-hover"
      contentClassName="px-2 pb-3 pt-1.5"
    >
      <span className="inline-flex h-6 items-center rounded-full bg-hover px-2.5 text-xs tabular-nums text-muted-foreground">
        {loading && sources.length === 0 ? '…' : `Результатов: ${sources.length}`}
      </span>
      {sources.length === 0 ? (
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          {loading ? 'Загружаю источники…' : 'Источники появятся, когда агент обратится к данным пространства.'}
        </p>
      ) : (
        <>
          <ul className="mt-2 flex flex-col">
            {visible.map((source) => <KnowledgeRow key={`${source.kind}:${source.id}`} source={source} />)}
          </ul>
          {sources.length > PREVIEW_LIMIT && (
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              className="mt-1 rounded-md px-1 py-1 text-xs text-muted-foreground hover:text-foreground"
            >
              {expanded ? 'Свернуть' : `Показать ещё ${sources.length - PREVIEW_LIMIT}`}
            </button>
          )}
        </>
      )}
    </Collapsible>
  );
}

function KnowledgeRow({ source }: { source: AiKnowledgeSource }): React.ReactElement {
  const Icon = KIND_ICONS[source.kind];
  const content = (
    <>
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0">
        <span className="block truncate text-xs font-medium">{source.title}</span>
        <span className="block truncate text-[11px] text-muted-foreground">{knowledgeSourceSubtitle(source)}</span>
      </span>
    </>
  );
  return (
    <li>
      {source.href ? (
        <Link to={source.href} className="flex min-h-[52px] items-start gap-2 rounded-lg px-1.5 py-2 hover:bg-hover">
          {content}
        </Link>
      ) : (
        <span className="flex min-h-[52px] items-start gap-2 px-1.5 py-2">{content}</span>
      )}
    </li>
  );
}
