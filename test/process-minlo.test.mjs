// Tests for the process:minlo virtual module. Runs as a child Node
// process with --import=register.js so the loader hook is in place
// before any user module is loaded. See test/run-process-minlo-tests.mjs
// for the wrapper that spawns this file with the right flags.

import test from 'node:test';
import assert from 'node:assert/strict';
import { use, provide } from 'process:minlo';

test('process:minlo exports use and provide', () => {
  assert.equal(typeof use, 'function');
  assert.equal(typeof provide, 'function');
});

test('provide + use round-trip', () => {
  // Note: this test relies on the loader being registered (see wrapper
  // script). If you see "Cannot find module 'process:minlo'" here,
  // the wrapper isn't passing --import correctly.
  provide('test-ability', {
    greet(name) {
      return `hello, ${name}`;
    },
  });
  const api = use('test-ability');
  assert.equal(api.greet('alice'), 'hello, alice');
});

test('use throws when name was not provided', () => {
  assert.throws(
    () => use('does-not-exist-' + Math.random().toString(36).slice(2)),
    /no ability has provided this name/,
  );
});

test('provide rejects non-function values', () => {
  assert.throws(
    () => provide('bad-ability', { value: 42, fn: () => 1 }),
    /api\[.value.\] must be a function/,
  );
});

test('provide rejects non-object api', () => {
  assert.throws(
    () => provide('bad-ability-2', null),
    /api must be an object/,
  );
});

test('provide rejects empty name', () => {
  assert.throws(
    () => provide('', { fn: () => 1 }),
    /name must be a non-empty string/,
  );
});
