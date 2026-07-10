#!/usr/bin/env node
// Process entry point. `npm link` makes this reachable as `minlo` on PATH
// via the `bin` field in package.json. Source imports use `.js` extensions
// (NodeNext requires it); tsc resolves them to the corresponding `.ts` files.
//
// We read package.json HERE (the bin entry) rather than deeper in the
// module tree. The bin file lives at a different depth in source vs dist:
//   - source: bin/minlo.ts        → parent is repo root
//   - dist:   dist/bin/minlo.js   → parent is dist/
// Hard-coded `..`s would break one of the two. Instead we walk up from
// the bin file until we find a directory containing package.json with our
// `name` field — that is unambiguously the package root.
//
// FIRST: install the `process:minlo` ESM loader hook. This must happen
// before any ability file is dynamically imported. The hook intercepts
// `import { use, provide } from 'process:minlo'` in ability files (see
// docs/design.md §3.12). Abilities that do NOT use this virtual module
// are unaffected — the hook only resolves the `process:minlo` specifier
// and passes everything else through to Node's default loader.
//
// Before delegating to run(), we lazily create the user-global `~/.minlo/`
// directory if missing (per CLAUDE.md §3.6). This is a no-op on subsequent
// runs.
import { register } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';

// Install the loader hook relative to this file's URL. From the bin entry
// (which is the very first thing Node loads), we resolve the hook at a
// known sibling path under dist/src/lib/ (tsc preserves the source tree
// under dist/). This works in both `npm link` (where dist/ lives next
// to bin/) and in development (where the script is run via tsx against
// source).
const here = dirname(fileURLToPath(import.meta.url));
// Try dist/src/lib/minlo-loader-hook.js first (built artifact); fall back
// to src/lib/ for tsx dev.
const candidates = [
  resolve(here, '..', 'dist', 'src', 'lib', 'minlo-loader-hook.js'),
  resolve(here, '..', 'src', 'lib', 'minlo-loader-hook.ts'),
  resolve(here, '..', 'src', 'lib', 'minlo-loader-hook.js'),
];
const hookPath = candidates.find((p) => existsSync(p));
if (!hookPath) {
  console.error(
    `minlo: cannot locate minlo-loader-hook under any of:\n` +
      candidates.map((p) => `  - ${p}`).join('\n') +
      `\n       Make sure you ran 'npm run build' before running minlo.`,
  );
  process.exit(1);
}
// module.register() on Windows requires a file:// URL, not a bare path.
register(pathToFileURL(hookPath).href, import.meta.url);

const { run } = await import('../src/index.js');

interface PackageMetadata {
  name: string;
  version: string;
  description?: string;
}

async function readPackageMetadata(): Promise<PackageMetadata> {
  const start = dirname(fileURLToPath(import.meta.url));
  let dir = start;
  for (let i = 0; i < 6; i++) {
    const candidate = resolve(dir, 'package.json');
    try {
      const raw = await readFile(candidate, 'utf8');
      const parsed = JSON.parse(raw) as Partial<PackageMetadata>;
      if (parsed.name === 'minlo') {
        if (typeof parsed.version !== 'string') {
          throw new Error(`package.json at ${candidate} is missing "version"`);
        }
        return {
          name: parsed.name,
          version: parsed.version,
          description: parsed.description,
        };
      }
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code !== 'ENOENT') throw new Error(`Cannot read ${candidate}: ${e.message}`);
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`Cannot locate minlo's package.json starting from ${start}`);
}

/**
 * Lazy-create `~/.minlo/` (the user-global abilities root) if missing.
 * Idempotent: subsequent runs are no-ops. We don't pre-populate any default
 * abilities here — that ships with future `npm install -g minlo` packages.
 */
async function ensureGlobalDir(): Promise<void> {
  const globalDir = join(homedir(), '.minlo');
  const globalAbilitiesDir = join(globalDir, 'abilities');
  const globalGitkeep = join(globalAbilitiesDir, '.gitkeep');

  if (existsSync(globalDir)) return;

  await mkdir(globalAbilitiesDir, { recursive: true });
  // Marker so the empty directory survives `git`-style tooling if the user
  // ever decides to track it.
  await writeFile(globalGitkeep, '', 'utf8');
}

const pkg = await readPackageMetadata();
await ensureGlobalDir();
run(pkg, process.argv).catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`minlo: ${message}`);
  process.exit(1);
});
