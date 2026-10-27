import { renderToStaticMarkup } from 'react-dom/server';
import { PageSkeleton, ShellSkeleton } from './LoadingLayouts';
import {
  bootSkeletonKey,
  installBannerExpected,
  loadingLayoutForPath,
  projectLoadingLayout,
  routeLoadingLayout,
  type LoadingLayout,
} from '@/lib/loadingLayout';

const LAYOUTS: LoadingLayout[] = [
  'inbox', 'board', 'table', 'list', 'calendar', 'task', 'studio',
  'chat', 'document', 'settings', 'overview', 'dashboard', 'auth',
];

/**
 * Build time (vite.config.ts): index.html gets the same skeleton markup React renders while
 * the app loads, so the first paint already shows the final silhouette. The inline script
 * reuses the route rules of lib/loadingLayout.ts and stores no account data.
 */
export function renderBootSkeleton(): string {
  const shell = renderToStaticMarkup(
    <ShellSkeleton layout="board" page={<i data-pf-boot-page="" />} />,
  );
  const pages = LAYOUTS.map(
    (layout) =>
      `<template data-pf-boot-page="${layout}">${renderToStaticMarkup(<PageSkeleton layout={layout} />)}</template>`,
  ).join('');
  const rules = [
    loadingLayoutForPath,
    projectLoadingLayout,
    routeLoadingLayout,
    bootSkeletonKey,
    installBannerExpected,
  ]
    .map(String)
    .join('\n');
  return `<template id="pf-boot-shell">${shell}</template>${pages}
<script>
(function () {
${rules}
  if (installBannerExpected()) document.documentElement.dataset.pfInstall = '';
  var key = 'shell:board';
  try { key = bootSkeletonKey(location.pathname, location.search, location.host); } catch (_) { /* default */ }
  var parts = key.split(':');
  var boot = document.getElementById('pf-boot');
  var page = document.querySelector('template[data-pf-boot-page="' + parts[1] + '"]');
  if (boot && page) {
    var content = page.content.cloneNode(true);
    if (parts[0] === 'shell') {
      var shell = document.getElementById('pf-boot-shell').content.cloneNode(true);
      shell.querySelector('[data-pf-boot-page]').replaceWith(content);
      content = shell;
    }
    boot.appendChild(content);
    // The app's skeletons continue this shimmer phase (syncSkeletonShimmer).
    if (document.getAnimations) document.getAnimations().forEach(function (a) { if (a.animationName === 'pf-skeleton-sweep') a.startTime = 0; });
  }
  document.querySelectorAll('template[data-pf-boot-page], #pf-boot-shell').forEach(function (t) { t.remove(); });
})();
</script>`;
}
