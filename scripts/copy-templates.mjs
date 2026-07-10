#!/usr/bin/env node
// Copy bundled templates from templates/ to dist/templates/ so the published
// package contains them next to the compiled JS. The runtime resolver in
// src/commands/init.ts looks for templates relative to its own location, so
// the dist layout must mirror the src layout.
//
// Currently templates/missions/default.json is the only file (used by
// `minlo init`). The walker is recursive so adding more subdirectories
// (e.g. templates/abilities/) is a no-op for this script.
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(here, '..', 'templates');
const destRoot = join(here, '..', 'dist', 'templates');

if (!existsSync(srcRoot)) {
  console.error(`copy-templates: source not found: ${srcRoot}`);
  process.exit(1);
}

function walk(src, dest) {
  if (!existsSync(dest)) mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src)) {
    const sp = join(src, entry);
    const dp = join(dest, entry);
    const st = statSync(sp);
    if (st.isDirectory()) {
      walk(sp, dp);
    } else if (st.isFile()) {
      copyFileSync(sp, dp);
      console.log(`  ${relative(srcRoot, sp)} → ${relative(here, dp)}`);
    }
  }
}

walk(srcRoot, destRoot);
console.log('copy-templates: done');
