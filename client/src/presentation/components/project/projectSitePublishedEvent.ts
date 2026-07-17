export const PROJECT_SITE_PUBLISHED_EVENT = 'pf:project-site-published';

export type ProjectSitePublishedDetail = {
  projectId: string;
  slug: string;
};

export function announceProjectSitePublished(detail: ProjectSitePublishedDetail): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<ProjectSitePublishedDetail>(PROJECT_SITE_PUBLISHED_EVENT, { detail }));
}
