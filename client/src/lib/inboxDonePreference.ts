// «Входящие» never show finished tasks unless the person explicitly asks for them in the
// filters. The preference used to default to «show» (key inbox.hide-done, hidden only on
// '1'), so any storage reset — a reinstalled PWA, cleared site data, a new phone — flooded the
// inbox with every done task. Now only an explicit «show done» ('1' under a new key) shows
// them; the old key is ignored on purpose, so every device starts hidden again.
export const INBOX_SHOW_DONE_KEY = 'inbox.show-done';

type KeyValue = Pick<Storage, 'getItem'>;

export function inboxHidesDone(storage: KeyValue | null): boolean {
  try {
    return storage?.getItem(INBOX_SHOW_DONE_KEY) !== '1';
  } catch {
    return true;
  }
}

/** Value to store for the toggle «Скрыть выполненные». */
export function inboxShowDoneValue(hideDone: boolean): string {
  return hideDone ? '0' : '1';
}
