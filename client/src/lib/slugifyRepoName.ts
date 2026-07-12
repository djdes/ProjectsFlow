// Транслит кириллицы → латиница + slugify для автоподстановки имени GitHub-репо.
// Копия server/src/application/project/slugifyRepoName.ts (клиент и сервер не шарят код).
const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f',
  х: 'h', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};

export function slugifyRepoName(name: string): string {
  const translit = name
    .toLowerCase()
    .split('')
    .map((ch) => (ch in TRANSLIT ? TRANSLIT[ch] : ch))
    .join('');
  return (
    translit
      .trim()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'project'
  );
}
