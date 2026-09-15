/**
 * Concurrency Limiter (Semaphore pattern)
 *
 * Controls how many async tasks run simultaneously.
 * Tasks beyond the limit are queued and executed as slots free up.
 * NOT parallel — concurrent with a hard cap.
 *
 * Usage:
 *   const limiter = createLimiter(3);        // max 3 concurrent
 *   await limiter.add(() => fetch(url1));
 *   await limiter.add(() => fetch(url2));     // queued if 3 already running
 *   await limiter.addAll([fn1, fn2, fn3]);   // batch with same limit
 */

class ConcurrencyLimiter {
  /**
   * @param {number} concurrency - Max tasks running at once (default 5)
   * @param {object} [opts]
   * @param {number} [opts.timeout] - Per-task timeout in ms (0 = no timeout, default 0)
   */
  constructor(concurrency = 5, opts = {}) {
    if (concurrency < 1) throw new Error('Concurrency must be >= 1');
    this._limit = concurrency;
    this._running = 0;
    this._queue = [];
    this._timeout = opts.timeout || 0;
    this._taskId = 0;
  }

  /**
   * Current number of running tasks
   */
  get running() {
    return this._running;
  }

  /**
   * Number of tasks waiting in queue
   */
  get queued() {
    return this._queue.length;
  }

  /**
   * Concurrency limit
   */
  get limit() {
    return this._limit;
  }

  /**
   * Enqueue a single async function and return its result.
   * @template T
   * @param {() => Promise<T>} fn - Async function to execute
   * @returns {Promise<T>}
   */
  add(fn) {
    return new Promise((resolve, reject) => {
      const task = {
        id: ++this._taskId,
        fn,
        resolve,
        reject
      };
      this._enqueue(task);
    });
  }

  /**
   * Run multiple async functions concurrently (bounded by limit).
   * Returns results in the same order as input.
   * @template T
   * @param {Array<() => Promise<T>>} fns - Array of async functions
   * @returns {Promise<Array<{status: 'fulfilled', value: T} | {status: 'rejected', reason: any}>>}
   */
  async addAll(fns) {
    return Promise.all(fns.map(fn => this.add(fn).then(
      value => ({ status: 'fulfilled', value }),
      reason => ({ status: 'rejected', reason })
    )));
  }

  /**
   * Map an array of items through an async function with concurrency control.
   * @template T, R
   * @param {T[]} items
   * @param {(item: T, index: number) => Promise<R>} fn
   * @returns {Promise<R[]>}
   */
  async map(items, fn) {
    return this.addAll(items.map((item, i) => () => fn(item, i))).then(results =>
      results.map(r => {
        if (r.status === 'fulfilled') return r.value;
        throw r.reason;
      })
    );
  }

  _enqueue(task) {
    if (this._running < this._limit) {
      this._run(task);
    } else {
      this._queue.push(task);
    }
  }

  _next() {
    if (this._queue.length === 0 || this._running >= this._limit) return;
    const next = this._queue.shift();
    this._run(next);
  }

  async _run(task) {
    this._running++;
    try {
      let result;
      if (this._timeout > 0) {
        result = await this._withTimeout(task.fn(), this._timeout);
      } else {
        result = await task.fn();
      }
      task.resolve(result);
    } catch (err) {
      task.reject(err);
    } finally {
      this._running--;
      this._next();
    }
  }

  _withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Task timed out after ${ms}ms`)), ms);
      promise.then(
        val => { clearTimeout(timer); resolve(val); },
        err => { clearTimeout(timer); reject(err); }
      );
    });
  }
}

/**
 * Create a new concurrency limiter.
 * @param {number} [concurrency=5] - Max concurrent tasks
 * @param {object} [opts]
 * @param {number} [opts.timeout] - Per-task timeout in ms
 * @returns {ConcurrencyLimiter}
 */
function createLimiter(concurrency = 5, opts = {}) {
  return new ConcurrencyLimiter(concurrency, opts);
}

module.exports = { ConcurrencyLimiter, createLimiter };
