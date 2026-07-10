// counter.js — example ability that exposes a counter API via the
// `provide` field. Other abilities call the API through
// `process.minlo.call('counter.<fn>', ...)`:
//
//   process.minlo.call('counter.increment');
//   const n = process.minlo.call('counter.get');
//
// State is held in a closure variable `n`; the same `counter` module
// is loaded once per process, so all callers share the same counter.

export const name = 'counter';
export const description = '提供计数器 API(供其他能力调用)';

let n = 0;

export const provide = {
  increment() {
    n += 1;
    return n;
  },
  get() {
    return n;
  },
  reset() {
    n = 0;
  },
};

// Trivial init is required because the strict 8-field schema (see
// docs/design.md §3.1) requires at least one of init / execute /
// destroy. The actual API is already registered on the module
// instance at import time, so init has nothing to do.
export async function init() {
  // no-op
}
