// Regression test for the bug fixed in commit (forthcoming):
//
//   Bug: `process.minlo.provides` was only populated AFTER all
//   abilities had finished init. A downstream ability whose init
//   called `process.minlo.call('upstream.fn', ...)` therefore
//   saw "no ability X has registered a provide" and init threw.
//
//   Fix: split ability processing into three explicit passes
//     (provide → init → execute). Pass 1 registers every ability's
//     `provide` field into process.minlo.provides BEFORE any init
//     runs. Pass 2 then runs all inits in deps-topo order; by then
//     process.minlo.provides is fully populated, so init-time
//     `process.minlo.call(...)` resolves correctly.
//
// This test exercises the path end-to-end: it spawns a real
// `minlo run` against a temp .minlo/ workspace where the second
// ability's init calls process.minlo.call on the first ability's
// provide. If the bug regresses, init throws and the child exits
// non-zero.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const repoRoot = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const minloBin = join(repoRoot, 'dist', 'bin', 'minlo.js');

test('downstream ability init can call process.minlo.call on upstream provide', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'minlo-test-'));
  const minloDir = join(tmp, '.minlo');
  const abilitiesDir = join(minloDir, 'abilities');
  const missionsDir = join(minloDir, 'missions');
  mkdirSync(abilitiesDir, { recursive: true });
  mkdirSync(missionsDir, { recursive: true });

  // provider — declares a `provide` field
  writeFileSync(
    join(abilitiesDir, 'counter.js'),
    `export const name = 'counter';
export const description = 'test counter';
export const provide = {
  increment() { return 42; },
};
export async function init() { /* no-op */ }
`,
  );

  // consumer — calls counter in its OWN init (the regression case)
  writeFileSync(
    join(abilitiesDir, 'demo-user.js'),
    `export const name = 'demo-user';
export const description = 'test consumer';
export const deps = ['counter'];
export async function init() {
  const n = process.minlo.call('counter.increment');
  if (n !== 42) {
    throw new Error('expected 42, got ' + n);
  }
}
export async function execute() { return { action: 'stop' }; }
`,
  );

  writeFileSync(
    join(missionsDir, 'demo.json'),
    JSON.stringify({ name: 'demo', abilities: ['counter', 'demo-user'] }),
  );

  const result = spawnSync(process.execPath, [minloBin, 'run', 'demo'], {
    cwd: tmp,
    timeout: 5000,
    encoding: 'utf8',
  });

  const out = result.stdout + result.stderr;

  // Bug indicator: init-time call throws "no ability ... has registered a provide"
  assert.doesNotMatch(
    out,
    /no ability "counter" has registered a provide/,
    'regression: init-time process.minlo.call could not resolve upstream provide',
  );
  // Success indicator
  assert.match(out, /✓ init counter/);
  assert.match(out, /✓ init demo-user/);
  assert.equal(result.status, 0, `minlo exited non-zero:\n${out}`);
});