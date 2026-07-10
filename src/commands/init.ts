// `minlo init` — scaffold a Minlo workspace in the current working directory.
//
// Two modes:
//
//   minlo init          (default, no flags)
//     Refuses to run unless cwd is empty. Creates the directory layout,
//     copies the `default.json` mission template, and creates a fresh
//     package.json with the minlo framework dependency.
//
//   minlo init --here
//     Designed for an existing project. Creates only the .minlo/ tree
//     and *merges* into an existing package.json (adds minlo to
//     dependencies and a few scripts). Refuses if .minlo/ already exists.
//
// No .env file is generated — env / secrets are the user's responsibility.
// No ability files are generated — minlo does not ship example abilities.
// The single `default.json` mission template is the only "starter" content
// minlo ships; it provides a fallback for `minlo run` (no-arg mode) and
// references the global `llm` ability so the new project is interactive
// out of the box (requires OPENAI_API_KEY).
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Command } from 'commander';

const MINLO_SCRIPTS: Record<string, string> = {
  'minlo:list': 'minlo list',
  'minlo:run': 'minlo run',
};

/** Absolute path to the bundled default.json template, resolved from this file's location. */
function defaultTemplatePath(): string {
  // dist/src/commands/init.js → ../../templates/missions/default.json
  // src/commands/init.ts      → ../../templates/missions/default.json
  // Both layouts resolve the same way because the relative path is identical.
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, '..', '..', 'templates', 'missions', 'default.json');
}

function ensureDir(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

function relativeTo(cwd: string, p: string): string {
  const rel = p.startsWith(cwd) ? p.slice(cwd.length).replace(/^[\\/]/, '') : p;
  return rel || p;
}

/** Result of a package.json merge. */
interface PkgMergeResult {
  status: 'created' | 'merged' | 'unchanged';
  file: string;
  details: string[];
}

/**
 * Either create a new package.json or merge into the existing one.
 * - Adds `minlo` to dependencies (only if not present, version not overwritten)
 * - Adds `minlo:*` scripts (only the keys that are not already defined)
 * - Does not touch any other field — user's dependencies/scripts stay put
 */
function ensurePackageJson(cwd: string): PkgMergeResult {
  const pkgPath = join(cwd, 'package.json');

  // Fresh create
  if (!existsSync(pkgPath)) {
    const projectName = resolve(cwd).split(/[\\/]/).pop() || 'minlo-project';
    const pkg = {
      name: projectName,
      version: '0.1.0',
      private: true,
      type: 'module',
      description: 'Minlo mission project',
      scripts: { ...MINLO_SCRIPTS },
      // No dependencies here: the minlo CLI is installed globally
      // (`npm install -g minlo`), not per-project. Per-project deps
      // should be added when the user installs npm packages for
      // capabilities (see CLAUDE.md §3.10).
    };
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
    return {
      status: 'created',
      file: relativeTo(cwd, pkgPath),
      details: ['created with minlo scripts (no project deps)'],
    };
  }

  // Merge into existing
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(readFileSync(pkgPath, 'utf8')) as Record<string, unknown>;
  } catch (err) {
    throw new Error(
      `Cannot parse existing package.json at ${pkgPath}: ${(err as Error).message}`,
    );
  }

  const details: string[] = [];

  // No per-project dependency on minlo: the CLI is installed globally,
  // not per-project. (Per-project deps are added by the user when they
  // install npm packages for capabilities — see CLAUDE.md §3.10.)

  // scripts: only add the keys that don't exist (never overwrite user scripts)
  const scripts = (parsed.scripts as Record<string, string> | undefined) ?? {};
  for (const [k, v] of Object.entries(MINLO_SCRIPTS)) {
    if (typeof scripts[k] === 'string') {
      details.push(`scripts["${k}"] already present, not overwritten`);
    } else {
      scripts[k] = v;
      details.push(`added scripts["${k}"] = "${v}"`);
    }
  }
  parsed.scripts = scripts;

  writeFileSync(pkgPath, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
  return { status: 'merged', file: relativeTo(cwd, pkgPath), details };
}

/**
 * Copy the bundled `default.json` template into the project's missions directory.
 * The template is the only "starter content" minlo ships — it provides a
 * fallback for `minlo run` (no-arg mode). If the file already exists in the
 * destination, it is left untouched.
 */
function copyDefaultMissionTemplate(missionsDir: string, cwd: string): 'copied' | 'skipped' {
  const dest = join(missionsDir, 'default.json');
  if (existsSync(dest)) return 'skipped';
  const src = defaultTemplatePath();
  if (!existsSync(src)) {
    throw new Error(`bundled default.json template not found at ${src}`);
  }
  copyFileSync(src, dest);
  return 'copied';
}

export function registerInit(program: Command): void {
  program
    .command('init')
    .description('Initialize a Minlo workspace in the current directory')
    .option('--here', 'merge into an existing project (do not require empty dir except for .minlo/)')
    .action((options: { here?: boolean }) => {
      const cwd = process.cwd();
      const minloDir = join(cwd, '.minlo');

      // Guard: .minlo/ is always a hard conflict — never overwrite a scaffolded
      // workspace. To re-init, the user must remove it first.
      if (existsSync(minloDir)) {
        console.error(
          `minlo: cannot init in ${cwd}\n` +
            `       .minlo/ already exists.\n` +
            `       minlo init will not overwrite a scaffolded workspace.\n` +
            `       To re-initialize, remove .minlo/ first.`,
        );
        process.exit(1);
      }

      // Without --here: refuse to run in a non-empty directory (an existing
      // project root would have its own package.json we'd otherwise clobber).
      if (!options.here) {
        const pkgPath = join(cwd, 'package.json');
        if (existsSync(pkgPath)) {
          console.error(
            `minlo: cannot init in ${cwd}\n` +
              `       package.json already exists.\n` +
              `       Refusing to overwrite an existing project.\n` +
              `       If you want to add Minlo to this project, use: minlo init --here`,
          );
          process.exit(1);
        }
      }

      // Create .minlo/ tree (3 directories: missions / abilities / workspace)
      const missionsDir = join(minloDir, 'missions');
      const abilitiesDir = join(minloDir, 'abilities');
      const workspaceDir = join(minloDir, 'workspace');

      ensureDir(missionsDir);
      ensureDir(abilitiesDir);
      ensureDir(workspaceDir);

      // Copy default mission template
      const tplResult = copyDefaultMissionTemplate(missionsDir, cwd);

      // package.json
      const pkgResult = ensurePackageJson(cwd);

      // Summary
      console.log(`Initialized Minlo workspace in ${cwd}`);
      console.log('');
      console.log(`Created directories:`);
      console.log(`  + .minlo/missions/`);
      console.log(`  + .minlo/abilities/`);
      console.log(`  + .minlo/workspace/  (能力运行时使用，init 阶段为空)`);
      if (tplResult === 'copied') {
        console.log('');
        console.log(`Copied default mission template:`);
        console.log(`  + .minlo/missions/default.json  (from minlo's bundled template)`);
      } else {
        console.log('');
        console.log(`Default mission template already exists, left untouched.`);
      }
      console.log('');
      if (pkgResult.status === 'created') {
        console.log(`Created ${pkgResult.file} (with minlo dep and scripts).`);
      } else {
        console.log(`Merged into ${pkgResult.file}:`);
        for (const d of pkgResult.details) console.log(`  ~ ${d}`);
      }
      console.log('');
      console.log('Next steps:');
      console.log('  1. npm install                         # install the minlo framework');
      console.log('  2. edit .minlo/missions/default.json  # or add your own missions');
      console.log('  3. add abilities under .minlo/abilities/');
      console.log('  4. minlo list                           # verify abilities are loaded');
    });
}
