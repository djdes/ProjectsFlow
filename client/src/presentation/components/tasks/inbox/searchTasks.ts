import { markdownToPlain } from '@/lib/markdownToPlain';

function normalize(value: string): string {
  return value.toLocaleLowerCase('ru').replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
}

export function matchesInboxQuery(
  task: { readonly description: string | null; readonly projectName: string },
  query: string,
): boolean {
  const needle = normalize(query);
  if (!needle) return true;
  return normalize(task.projectName).includes(needle)
    || normalize(markdownToPlain(task.description)).includes(needle);
}
