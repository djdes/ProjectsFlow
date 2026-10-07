/** One task's draft and serial save queue; late responses never replace newer input. */
export class TaskDescriptionDraft {
  value: string;
  private saved: string;
  private pending: Promise<void> | null = null;

  constructor(initial: string, private persist: (value: string) => Promise<string>, private changed: () => void, private savedCallback: () => void) {
    this.value = initial;
    this.saved = initial;
  }

  get saving(): boolean { return this.pending !== null; }

  change(value: string): void {
    this.value = value;
    this.changed();
  }

  commit(): Promise<void> {
    if (this.pending) return this.pending;
    if (!this.value.trim() || this.value.trim() === this.saved.trim()) return Promise.resolve();
    this.pending = this.drain().finally(() => {
      this.pending = null;
      this.changed();
    });
    this.changed();
    return this.pending;
  }

  private async drain(): Promise<void> {
    while (this.value.trim() && this.value.trim() !== this.saved.trim()) {
      const submitted = this.value;
      const result = await this.persist(submitted.trim());
      this.saved = result;
      if (this.value === submitted) this.value = result;
      this.changed();
      this.savedCallback();
    }
  }
}
