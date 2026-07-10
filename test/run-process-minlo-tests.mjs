#!/usr/bin/env node
// Test entry point: registers the process:minlo loader hook in the
// current process, then dynamically imports and runs the test file.
//
// We do NOT use spawnSync with --import=hook because --import only
// runs preload scripts; it does NOT register ESM resolve/load hooks.
// module.register() must be called from the entry script before any
// dynamic import of a file that imports 'process:minlo'.
//
// On success, exits 0. On any test failure, exits 1.

import { register } from 'node:module';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

const candidates = [
  resolve(repoRoot, 'dist', 'src', 'lib', 'minlo-loader-hook.js'),
  resolve(repoRoot, 'src', 'lib', 'minlo-loader-hook.ts'),
  resolve(repoRoot, 'src', 'lib', 'minlo-loader-hook.js'),
];
const hookPath = candidates.find((p) => existsSync(p));
if (!hookPath) {
  console.error(
    `run-process-minlo-tests: cannot locate minlo-loader-hook. Tried:\n` +
      candidates.map((p) => `  - ${p}`).join('\n') +
      `\nDid you run 'npm run build'?`,
  );
  process.exit(2);
}

register(pathToFileURL(hookPath).href, import.meta.url);

const testFileUrl = pathToFileURL(resolve(here, 'process-minlo.test.mjs')).href;
await import(testFileUrl);
