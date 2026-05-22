// Нормализация git-URL для сравнения «тот же репозиторий». Приводим scheme/ssh/.git/
// trailing-slash к канону, чтобы https://github.com/a/b.git, git@github.com:a/b и
// https://github.com/a/b/ считались одним репо.
export function normalizeGitUrl(url: string): string {
  return url
    .trim()
    .toLowerCase()
    .replace(/^git@github\.com:/, 'https://github.com/')
    .replace(/^http:\/\//, 'https://')
    .replace(/\.git$/, '')
    .replace(/\/+$/, '');
}
