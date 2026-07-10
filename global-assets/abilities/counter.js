// counter.js — example ability that exports a counter API via
// process:minlo. Other abilities call the counter function set via
// process:minlo to get the shared { increment, get, reset } functions.
//
// Note: this ability file is .js, not .ts. The process:minlo
// virtual specifier only works in .js (tsx's esbuild pipeline does
// not know about it — see docs/design.md §3.12).
//
// counter has a trivial init() because the strict 7-field schema
// requires at least one of init / execute / destroy. The actual
// `provide()` call happens at module-load time (when the ability
// file is imported), so init is just there to satisfy the loader.

import { provide } from 'process:minlo';

export const name = 'counter';
export const description = '示例能力：provide 计数器,其他能力可通过 process:minlo 调用';

let n = 0;

provide('counter', {
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
});

export async function init() {
  // No-op. See file header.
}
