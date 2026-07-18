export function normalizePreviewPath(raw: string): string | null {
  let value = raw.trim();
  if (!value) return '/';
  if (!value.startsWith('/')) value = `/${value}`;
  if (value.startsWith('//') || value.includes('\\') || [...value].some((character) => character.charCodeAt(0) < 32)) return null;
  try {
    const parsed = new URL(value, 'https://preview.projectsflow.invalid');
    if (parsed.origin !== 'https://preview.projectsflow.invalid') return null;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

export function joinPreviewUrl(baseUrl: string, path: string): string {
  const base = new URL(baseUrl);
  const normalized = normalizePreviewPath(path) ?? '/';
  return new URL(normalized, `${base.origin}/`).toString();
}
