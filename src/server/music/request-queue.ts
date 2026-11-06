/** Bound concurrent upstream work while preserving the provider's request-start interval. */
export class RequestQueue {
  private waiting: {
    run: () => Promise<unknown>;
    resolve: (value: unknown) => void;
    reject: (error: unknown) => void;
  }[] = [];
  private active = 0;
  private nextStart = 0;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(
    private concurrency = 4,
    private interval = 300,
  ) {}
  run<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.waiting.push({
        run: task,
        resolve: (value) => resolve(value as T),
        reject,
      });
      this.pump();
    });
  }
  private pump() {
    if (this.timer || this.active >= this.concurrency || !this.waiting.length)
      return;
    const delay = this.nextStart - Date.now();
    if (delay > 0) {
      this.timer = setTimeout(() => {
        this.timer = undefined;
        this.pump();
      }, delay);
      return;
    }
    const job = this.waiting.shift()!;
    this.active++;
    this.nextStart = Date.now() + this.interval;
    Promise.resolve()
      .then(job.run)
      .then(job.resolve, job.reject)
      .finally(() => {
        this.active--;
        this.pump();
      });
    this.pump();
  }
}
