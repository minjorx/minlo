// ESM loader hook for the `process:minlo` virtual module.
//
// Node 22+ exposes `module.register(specifier, parentURL)` which lets a
// process install an ESM loader hook at runtime. We use it to intercept
// `import { use, provide } from 'process:minlo'` in ability files and
// return a virtual module whose bindings reach into `process.minlo`.
//
// What this hook does NOT do:
//   - It does NOT touch any other specifier. tsx / npm / file: imports
//     pass straight through.
//   - It does NOT load TypeScript. Abilities that use `process:minlo`
//     must be `.js` (see docs/design.md §3.12). tsx's own loader does
//     not know about our virtual specifier.
//
// Storage layout (lives on process.minlo, owned by the main loop in
// src/commands/run.ts — this hook only *reads* / *writes* to that
// same shared object):
//
//   process.minlo.provides = {
//     [capabilityName: string]: Record<string, Function>,
//   }
//
// `provide(name, api)` writes here; `use(name)` reads here.

import { fileURLToPath } from 'node:url';
import type { LoadHook, ResolveHook } from 'node:module';

const VIRTUAL_SPECIFIER = 'process:minlo';

// The actual store for provide/use lives on globalThis, lazily
// initialized the first time anything touches it. Reasons:
//   1. The hook's virtual module may be evaluated BEFORE this
//      module's body finishes running — Node registers hooks
//      asynchronously from a worker thread, so we cannot rely on
//      the order of `register()` and the first `import
//      'process:minlo'`.
//   2. Tests (test/process-minlo.test.mjs) use the hook without
//      the minlo main loop.
//
// Both the virtual module's `provide`/`use` and this file's
// `getProvides()` go through `_store()` (in the virtual module) or
// read globalThis.__minlo_provides__ directly (in getProvides), so
// the same object is shared.
const VIRTUAL_MODULE_SOURCE = `
function _store() {
  if (!globalThis.__minlo_provides__) {
    globalThis.__minlo_provides__ = Object.create(null);
  }
  if (!globalThis.__minlo_use_log__) {
    globalThis.__minlo_use_log__ = [];
  }
  return { provides: globalThis.__minlo_provides__, log: globalThis.__minlo_use_log__ };
}

export function provide(name, api) {
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error('process:minlo: provide(name, api) — name must be a non-empty string');
  }
  if (api == null || typeof api !== 'object') {
    throw new Error('process:minlo: provide(name, api) — api must be an object');
  }
  for (const k of Object.keys(api)) {
    if (typeof api[k] !== 'function') {
      throw new Error(
        'process:minlo: provide(' + JSON.stringify(name) + ', api) — ' +
          'api[' + JSON.stringify(k) + '] must be a function (only function values are exposed)',
      );
    }
  }
  const s = _store();
  if (s.provides[name]) {
    s.log.push({ caller: 'unknown', target: name, kind: 'overwrite' });
  }
  s.provides[name] = api;
}

export function use(name) {
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error('process:minlo: use(name) — name must be a non-empty string');
  }
  const api = _store().provides[name];
  if (!api) {
    throw new Error(
      'process:minlo: use(' + JSON.stringify(name) + ') — no ability has ' +
        'provided this name yet. Did you forget to declare it in deps and ' +
        'import { provide } from "process:minlo" in that ability?',
    );
  }
  return api;
}
`;

// The actual `__minlo_provides__` and `__minlo_use_log__` objects
// are created lazily by the virtual module's `_store()` function
// the first time it runs. We do not pre-create them here because
// the timing of this module's body relative to the first
// `import 'process:minlo'` is unreliable (see comment above).

export const resolve: ResolveHook = (specifier, context, nextResolve) => {
  if (specifier === VIRTUAL_SPECIFIER) {
    // Return a URL Node will then ask us to `load`. We tag it with a
    // query string so each `load` call is treated as a fresh URL by
    // Node's module cache (not strictly required for a stateless
    // virtual module, but cheap insurance against stale resolution
    // in long-lived test runners).
    return {
      url: 'minlo:virtual:process-minlo',
      shortCircuit: true,
      format: 'module',
    };
  }
  return nextResolve(specifier, context);
};

export const load: LoadHook = (url, context, nextLoad) => {
  if (url === 'minlo:virtual:process-minlo') {
    return {
      format: 'module',
      source: VIRTUAL_MODULE_SOURCE,
      shortCircuit: true,
    };
  }
  return nextLoad(url, context);
};

// File-system path of this file, exposed for the CLI to call
// `module.register('./minlo-loader-hook.js', import.meta.url)` from a
// stable location.
export const hookUrl = fileURLToPath(import.meta.url);

/**
 * Read-only view of the provides store. The minlo main loop calls
 * this once at start of phase 2 (after all inits) to copy the map
 * into process.minlo.provides for introspection by `minlo list` and
 * friends. The map itself lives on globalThis (since the hook module
 * may not have run its top level by the time we need to read it —
 * see VIRTUAL_MODULE_SOURCE).
 */
export function getProvides(): Record<string, Record<string, (...args: unknown[]) => unknown>> {
  const g = globalThis as unknown as { __minlo_provides__?: Record<string, Record<string, (...args: unknown[]) => unknown>> };
  if (!g.__minlo_provides__) g.__minlo_provides__ = {};
  return g.__minlo_provides__;
}
