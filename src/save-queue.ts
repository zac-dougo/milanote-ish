type SaveJob = () => Promise<void>;

// Keep the latest edit per entity, including edits made while an older save is in flight.
export class SaveQueue {
  private jobs = new Map<string, SaveJob>();
  private active: Promise<void> | null = null;

  enqueue(key: string, job: SaveJob) {
    this.jobs.set(key, job);
  }

  get pending() {
    return this.jobs.size;
  }

  flush(): Promise<void> {
    if (this.active) return this.active;
    if (!this.jobs.size) return Promise.resolve();
    this.active = this.drain().finally(() => {
      this.active = null;
    });
    return this.active;
  }

  private async drain() {
    while (this.jobs.size) {
      const [key, job] = this.jobs.entries().next().value!;
      await job();
      if (this.jobs.get(key) === job) this.jobs.delete(key);
    }
  }
}
