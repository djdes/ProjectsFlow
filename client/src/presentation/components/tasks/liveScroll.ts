// Both the feed and the task panel can overflow in a narrow drawer.
export function liveScrollViewports(feed: HTMLElement | null): HTMLElement[] {
  if (!feed || feed.clientHeight === 0) return [];
  const viewports = [feed];
  for (let parent = feed.parentElement; parent; parent = parent.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY)
      && parent.clientHeight > 0 && parent.scrollHeight > parent.clientHeight + 1) {
      viewports.push(parent);
    }
  }
  return viewports;
}

export function scrollLiveToBottom(feed: HTMLElement | null): void {
  for (const viewport of liveScrollViewports(feed)) {
    viewport.scrollTop = viewport.scrollHeight;
  }
}

export function isLiveNearBottom(feed: HTMLElement | null): boolean {
  return liveScrollViewports(feed).every(viewport =>
    viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 80);
}
