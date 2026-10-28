// The name must end the word: «в TasksFlow.» or «в TasksFlow,» is a project, but
// «в tasksflow.ru» or «в tasksflow/app» is a site address. In production «задачи будут
// в tasksflow.ru» pinned a whole message about another workspace to the TasksFlow project.
const END = String.raw`(?![\p{L}\p{N}_]|[./@:-][\p{L}\p{N}])`;

// Colloquial brand references are resolved only among projects the sender can access.
// Multiple matches remain unresolved so the composer can ask rather than guess.
export function matchProjectMention<P extends { id: string; name: string }>(text: string, projects: readonly P[]): P | null {
  const colloquial = new RegExp(String.raw`(^|[^\p{L}\p{N}_])(?:в|для)\s+проджект(?:е|а)?` + END, 'iu').test(text);
  const brand = new RegExp(String.raw`(^|[^\p{L}\p{N}_])(?:проджект[\s_-]*флоу|projects?[\s_-]*flow)` + END, 'iu').test(text);
  const matches = projects.filter((project) => {
    if (brand && /^projects?[\s_-]*flow$/i.test(project.name.trim())) return true;
    if (colloquial && /^projects?[\s_-]*flow$/i.test(project.name.trim())) return true;
    const name = project.name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return name.length > 0 && new RegExp(String.raw`(^|[^\p{L}\p{N}_])(?:в|для)\s+` + name + END, 'iu').test(text);
  });
  return matches.length === 1 ? matches[0]! : null;
}
