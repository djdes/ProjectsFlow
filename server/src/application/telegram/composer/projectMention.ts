// Colloquial brand references are resolved only among projects the sender can access.
// Multiple matches remain unresolved so the composer can ask rather than guess.
export function matchProjectMention<P extends { id: string; name: string }>(text: string, projects: readonly P[]): P | null {
  const colloquial = /(^|[^\p{L}\p{N}_])(?:в|для)\s+проджект(?:е|а)?(?=$|[^\p{L}\p{N}_])/iu.test(text);
  const matches = projects.filter((project) => {
    if (/(^|[^\p{L}\p{N}_])(?:проджект[\s_-]*флоу|projects?[\s_-]*flow)(?=$|[^\p{L}\p{N}_])/iu.test(text)
      && /^projects?[\s_-]*flow$/i.test(project.name.trim())) return true;
    if (colloquial && /^projects?[\s_-]*flow$/i.test(project.name.trim())) return true;
    const name = project.name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return name.length > 0 && new RegExp(`(^|[^\\p{L}\\p{N}_])(?:в|для)\\s+${name}(?=$|[^\\p{L}\\p{N}_])`, 'iu').test(text);
  });
  return matches.length === 1 ? matches[0]! : null;
}
