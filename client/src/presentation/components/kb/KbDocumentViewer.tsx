import React from 'react';
import { Edit, ExternalLink } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { KbDocument } from '@/domain/kb/KbDocument';

type Props = {
  document: KbDocument;
  kbRepoFullName: string;
  onEdit: () => void;
};

function FrontmatterTable({ fm }: { fm: KbDocument['frontmatter'] }): React.ReactElement {
  const entries = Object.entries(fm);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Frontmatter</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-[140px_1fr] gap-y-1.5 text-sm">
          {entries.map(([k, v]) => (
            <React.Fragment key={k}>
              <dt className="font-mono text-xs text-muted-foreground">{k}</dt>
              <dd className="font-mono text-xs break-all">{JSON.stringify(v)}</dd>
            </React.Fragment>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}

export function KbDocumentViewer({ document, kbRepoFullName, onEdit }: Props): React.ReactElement {
  const githubUrl = `https://github.com/${kbRepoFullName}/blob/main/${document.path}`;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="flex-1 truncate text-2xl font-semibold tracking-tight">
          {(document.frontmatter.title as string) ?? document.path}
        </h1>
        <Button size="sm" onClick={onEdit}>
          <Edit className="size-4" />
          Редактировать
        </Button>
        <Button asChild variant="outline" size="sm">
          <a href={githubUrl} target="_blank" rel="noreferrer noopener">
            <ExternalLink className="size-4" />
            На GitHub
          </a>
        </Button>
      </div>
      <p className="font-mono text-xs text-muted-foreground">{document.path}</p>

      {document.validationErrors.length > 0 && (
        <Card className="border-amber-500/40 bg-amber-500/10">
          <CardHeader>
            <CardTitle className="text-base text-amber-600 dark:text-amber-400">
              Frontmatter invalid
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="ml-4 list-disc text-sm">
              {document.validationErrors.map((e, i) => <li key={i}>{e.message}</li>)}
            </ul>
          </CardContent>
        </Card>
      )}

      <FrontmatterTable fm={document.frontmatter} />

      <Card>
        <CardContent className="prose prose-sm dark:prose-invert max-w-none py-6">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{document.body}</ReactMarkdown>
        </CardContent>
      </Card>
    </div>
  );
}
