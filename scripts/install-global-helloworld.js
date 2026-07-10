#!/usr/bin/env node
// install-global-helloworld.js — copy every bundled capability from
// <minlo>/global-assets/abilities/ into ~/.minlo/abilities/.
//
// Used by the `postinstall` npm hook so that `npm install -g minlo` places
// the files automatically. Also runnable manually via `npm run install:global`.
//
// Idempotent: files that already exist at the destination are **not**
// overwritten — user's local edits are preserved. To force reinstall, the
// user can `rm ~/.minlo/abilities/<file>.js` and re-run.
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const SRC_DIR = resolve(here, '..', 'global-assets', 'abilities');
const DEST_DIR = join(homedir(), '.minlo', 'abilities');

function die(msg) {
  console.error(`install-global: ${msg}`);
  process.exit(1);
}

if (!existsSync(SRC_DIR)) die(`source dir not found: ${SRC_DIR}`);
if (!statSync(SRC_DIR).isDirectory()) die(`source is not a directory: ${SRC_DIR}`);

mkdirSync(DEST_DIR, { recursive: true });

// Ensure ~/.minlo/package.json exists with type:module so Node parses the
// global capabilities as ESM (without it, Node tries CommonJS first and
// emits a MODULE_TYPELESS_PACKAGE_JSON warning per file).
const HOME = homedir();
const pkgJsonPath = join(HOME, '.minlo', 'package.json');
if (!existsSync(pkgJsonPath)) {
  const pkg = {
    name: 'minlo-global',
    version: '0.1.0',
    private: true,
    type: 'module',
    description: 'Global minlo capabilities and config — see CLAUDE.md §3.6 / §11',
  };
  writeFileSync(pkgJsonPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  console.log(`install-global: wrote ${pkgJsonPath}`);
}

let copied = 0;
let skipped = 0;
for (const entry of readdirSync(SRC_DIR)) {
  if (!entry.endsWith('.js') && !entry.endsWith('.ts')) continue;
  const src = join(SRC_DIR, entry);
  if (!statSync(src).isFile()) continue;
  const dest = join(DEST_DIR, entry);
  if (existsSync(dest)) {
    console.log(`install-global: ${dest} already exists, skipping`);
    skipped += 1;
    continue;
  }
  copyFileSync(src, dest);
  console.log(`install-global: copied ${entry}`);
  console.log(`  from: ${src}`);
  console.log(`  to:   ${dest}`);
  copied += 1;
}

console.log('');
console.log(`install-global: done (${copied} copied, ${skipped} skipped)`);
console.log('These capabilities are now available globally to all minlo projects.');
console.log('Reference them by name in any agent\'s abilities array.');
