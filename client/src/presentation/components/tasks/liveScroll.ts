// The chat owns its viewport. Moving task/page ancestors on every LIVE event
// fights native wheel scrolling and can push the visible chat out of its panel.
export function scrollLiveToBottom(feed: HTMLElement | null): void {
  if (feed && feed.clientHeight > 0) feed.scrollTop = feed.scrollHeight;
}

export function isLiveNearBottom(feed: HTMLElement | null): boolean {
  return !feed || feed.clientHeight === 0
    || feed.scrollHeight - feed.scrollTop - feed.clientHeight <= 2;
}
