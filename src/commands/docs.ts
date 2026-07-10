// `minlo docs` — print the minlo design document to stdout so an
// LLM agent (or any external consumer) can read the framework's
// spec / schema / conventions without having to fetch the source
// repository.
//
// Layout (post-build):
//   dist/bin/minlo.js              ← this file (compiled)
//   dist/docs/design.md            ← what we print
//
// The resolver walks up from this file to find minlo's package
// root, then opens <root>/docs/design.md. Mirrors the pattern
// in src/commands/init.ts (which finds templates/ relative to
// its own location).
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Command } from 'commander';

/**
 * Absolute path to the bundled design.md. From the bin entry (which
 * is the very first thing Node loads), we walk up to find the
 * directory containing package.json with name="minlo" — that is
 * the package root. Then we open <root>/docs/design.md.
 */
function designDocPath(): string {
  const start = dirname(fileURLToPath(import.meta.url));
  let dir = start;
  for (let i = 0; i < 6; i++) {
    const candidate = resolve(dir, 'package.json');
    if (existsSync(candidate)) {
      try {
        const raw = readFileSync(candidate, 'utf8');
        const parsed = JSON.parse(raw) as { name?: string };
        if (parsed.name === 'minlo') {
          return resolve(dir, 'docs', 'design.md');
        }
      } catch {
        // unreadable / unparsable — keep walking
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `Cannot locate minlo's package root starting from ${start}; ` +
      `the docs subcommand needs the framework installed via npm.`,
  );
}

export function registerDocs(program: Command): void {
  program
    .command('docs')
    .description(
      'Print the minlo design document (markdown) to stdout. ' +
        'Intended for LLM agents and external tools that need to read the framework spec.',
    )
    .action(() => {
      const path = designDocPath();
      if (!existsSync(path)) {
        console.error(
          `minlo: design document not found at ${path}\n` +
            `       This is a packaging problem — try \`npm run build\` or reinstall minlo.`,
        );
        process.exit(1);
      }
      const text = readFileSync(path, 'utf8');
      // Print raw. Do not add banners or color codes — downstream
      // tools (LLM agents, grep, less) want clean markdown.
      process.stdout.write(text);
    });
}
