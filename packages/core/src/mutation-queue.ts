export interface MutationQueueTiming {
  waitMs: number;
  operationMs: number;
}

export interface MutationQueueOptions {
  slowOperationMs?: number;
  onSlowOperation?: (timing: MutationQueueTiming) => void;
}

export class MutationQueue {
  #tail: Promise<void> = Promise.resolve();
  #slowOperationMs: number;
  #onSlowOperation?: (timing: MutationQueueTiming) => void;

  constructor(options: MutationQueueOptions = {}) {
    this.#slowOperationMs = Math.max(0, options.slowOperationMs ?? 5_000);
    this.#onSlowOperation = options.onSlowOperation;
  }

  async run<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.#tail;
    const submittedAt = Date.now();
    let release!: () => void;
    this.#tail = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;
    const startedAt = Date.now();
    try {
      return await operation();
    } finally {
      const finishedAt = Date.now();
      const timing = {
        waitMs: startedAt - submittedAt,
        operationMs: finishedAt - startedAt,
      };
      if (
        this.#onSlowOperation &&
        Math.max(timing.waitMs, timing.operationMs) >= this.#slowOperationMs
      ) {
        try {
          this.#onSlowOperation(timing);
        } catch {
          // Diagnostics must never change the result of a queued mutation.
        }
      }
      release();
    }
  }
}
