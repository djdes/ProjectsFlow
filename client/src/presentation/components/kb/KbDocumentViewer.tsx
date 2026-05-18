import React, { useEffect, useMemo, useState } from 'react';
import { Copy, Edit, ExternalLink, Loader2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from '@/components/ui/sonner';
import { useContainer } from '@/infrastructure/di/container';
import type { KbDocument } from '@/domain/kb/KbDocument';

type Props = {
  document: KbDocument;
  kbRepoFullName: string;
  onEdit: () => void;
};

// Поля, которые относятся к метаданным документа и не отображаются в "Значениях".
const META_KEYS = new Set(['type', 'title', 'kind']);

type FieldEntry =
  | { readonly key: string; readonly isSecret: false; readonly value: string }
  | { readonly key: string; readonly isSecret: true; readonly vaultKey: string };

function extractEntries(fm: KbDocument['frontmatter']): FieldEntry[] {
  const out: FieldEntry[] = [];
  for (const [k, v] of Object.entries(fm)) {
    if (META_KEYS.has(k)) continue;
    if (k.endsWith('_ref') && typeof v === 'string' && v.startsWith('vault://')) {
      out.push({ key: k.slice(0, -'_ref'.length), isSecret: true, vaultKey: v.slice('vault://'.length) });
    } else {
      out.push({ key: k, isSecret: false, value: String(v) });
    }
  }
  return out;
}

type SecretState = { state: 'loading' } | { state: 'ok'; value: string } | { state: 'err'; err: string };

function CredentialFieldsCard({ fm }: { fm: KbDocument['frontmatter'] }): React.ReactElement {
  const { secretsRepository } = useContainer();
  const entries = useMemo(() => extractEntries(fm), [fm]);
  const [secrets, setSecrets] = useState<Record<string, SecretState>>({});

  useEffect(() => {
    let cancelled = false;
    const initial: Record<string, SecretState> = {};
    for (const e of entries) if (e.isSecret) initial[e.key] = { state: 'loading' };
    setSecrets(initial);

    for (const e of entries) {
      if (!e.isSecret) continue;
      secretsRepository.get(e.vaultKey).then(
        (v) => {
          if (!cancelled) setSecrets((prev) => ({ ...prev, [e.key]: { state: 'ok', value: v } }));
        },
        (err: unknown) => {
          if (!cancelled) {
            const msg = err instanceof Error ? err.message : 'fetch failed';
            setSecrets((prev) => ({ ...prev, [e.key]: { state: 'err', err: msg } }));
          }
        },
      );
    }
    return () => {
      cancelled = true;
    };
  }, [entries, secretsRepository]);

  const copyValue = async (key: string, value: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`Скопировано: ${key}`);
    } catch {
      toast.error('Не удалось скопировать');
    }
  };

  const copyAllEnv = async (): Promise<void> => {
    const lines: string[] = [];
    for (const e of entries) {
      let v: string;
      if (e.isSecret) {
        const s = secrets[e.key];
        if (!s || s.state !== 'ok') {
          toast.error('Секреты ещё загружаются — попробуй через секунду');
          return;
        }
        v = s.value;
      } else {
        v = e.value;
      }
      lines.push(`${e.key.toUpperCase()}=${v}`);
    }
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      toast.success('Скопировано как .env-блок');
    } catch {
      toast.error('Не удалось скопировать');
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Значения</CardTitle>
        <Button variant="outline" size="sm" onClick={copyAllEnv}>
          <Copy className="size-4" />
          Скопировать как .env
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        <ul className="divide-y">
          {entries.map((e) => {
            const s = e.isSecret ? secrets[e.key] : null;
            const resolvedValue = e.isSecret
              ? s?.state === 'ok'
                ? s.value
                : null
              : e.value;
            return (
              <li key={e.key} className="flex items-center gap-3 px-4 py-2">
                <span className="w-40 shrink-0 font-mono text-xs text-muted-foreground">
                  {e.key}
                </span>
                <span className="flex-1 break-all font-mono text-xs">
                  {e.isSecret ? (
                    s?.state === 'ok' ? (
                      s.value
                    ) : s?.state === 'err' ? (
                      <span className="text-destructive">не удалось загрузить ({s.err})</span>
                    ) : (
                      <Loader2 className="size-3 animate-spin text-muted-foreground" />
                    )
                  ) : (
                    e.value
                  )}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7"
                  disabled={resolvedValue === null}
                  onClick={() => {
                    if (resolvedValue !== null) void copyValue(e.key, resolvedValue);
                  }}
                >
                  <Copy className="size-3.5" />
                </Button>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

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

      {document.frontmatter.type === 'credential' ? (
        <CredentialFieldsCard fm={document.frontmatter} />
      ) : (
        <FrontmatterTable fm={document.frontmatter} />
      )}

      <Card>
        <CardContent className="prose prose-sm dark:prose-invert max-w-none py-6">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{document.body}</ReactMarkdown>
        </CardContent>
      </Card>
    </div>
  );
}
