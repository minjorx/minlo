#!/usr/bin/env node
// Copy bundled assets (templates/ and docs/) from source root to dist/
// so the published package contains them next to the compiled JS. Runtime
// resolvers in src/commands/init.ts and src/commands/docs.ts look for
// these relative to their own location, so the dist layout must mirror
// the src layout.
//
//   templates/missions/default.json  →  dist/templates/missions/default.json
//                                     (used by `minlo init`)
//   docs/design.md                   →  dist/docs/design.md
//                                     (printed by `minlo docs` for LLM agents)
//
// The walker is recursive so adding more files / subdirectories is a
// no-op for this script.
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');

const assetRoots = [
  { src: join(repoRoot, 'templates'), dest: join(repoRoot, 'dist', 'templates') },
  { src: join(repoRoot, 'docs'), dest: join(repoRoot, 'dist', 'docs') },
];

for (const { src, dest } of assetRoots) {
  if (!existsSync(src)) {
    console.error(`copy-assets: source not found: ${src}`);
    process.exit(1);
  }
  walk(src, dest);
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
      console.log(`  ${relative(repoRoot, sp)} → ${relative(here, dp)}`);
    }
  }
}

console.log('copy-assets: done');
