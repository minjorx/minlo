// Ability loader.
//
// Scans one or more directories for `.js` / `.ts` files, dynamically imports
// each one, and validates the exports against the strict 7-field schema
// (name / description / init / execute / destroy / deps / externalDeps — see
// docs/design.md §3.1).
//
// Validation rules (per docs/design.md §5.3):
//   - `name` and `description` are required and must be strings
//   - At least one of `init` / `execute` / `destroy` must be a function
//   - Any other export key (e.g. `type`, `order`, `config`, `chat`) → reject
//
// Files that fail validation are reported on stderr and skipped; the loader
// continues processing siblings. The returned registry is the survivors.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { hasTypeScript, tsxLoaderAvailable } from './runtime.js';

export interface CapabilityRecord {
  name: string;
  description: string;
  hasInit: boolean;
  hasExecute: boolean;
  hasDestroy: boolean;
  deps: string[];
  externalDeps: string[];
  instance: Record<string, unknown>;
  source: 'local' | 'global';
  filePath: string;
}

const ALLOWED_KEYS = new Set([
  'name', 'description', 'init', 'execute', 'destroy', 'deps', 'externalDeps', 'provide',
]);

export interface LoadOptions {
  /** Directory to scan. Must exist (no auto-create). */
  dir: string;
  /** Tag for source classification in error messages and registry. */
  source: 'local' | 'global';
}

export async function loadCapabilitiesFrom(opts: LoadOptions): Promise<CapabilityRecord[]> {
  const { dir, source } = opts;
  if (!existsSync(dir)) return [];

  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (!st.isFile()) continue;
    if (entry.endsWith('.js') || entry.endsWith('.ts')) {
      files.push(full);
    }
  }

  const useTsx = hasTypeScript();
  const tsxOk = await tsxLoaderAvailable();

  const out: CapabilityRecord[] = [];
  for (const filePath of files) {
    if (filePath.endsWith('.ts') && !(useTsx && tsxOk)) {
      console.error(`minlo: skip ${relativeIn(dir, filePath)} — .ts file but tsx is not available`);
      continue;
    }

    let mod: Record<string, unknown>;
    try {
      mod = (await import(pathToFileURL(filePath).href + '?t=' + Date.now())) as Record<string, unknown>;
    } catch (err) {
      // If the import failed because an npm dependency (declared via
      // `externalDeps` or implicit via `import`) couldn't be resolved,
      // print a clearer hint than the raw Node ESM error. We try to pull
      // the missing package name out of Node's message — it has the form
      // `Cannot find package '<name>' imported from <url>`.
      const raw = (err as Error).message;
      const hint = describeImportFailure(raw, source, dir, filePath);
      console.error(hint);
      continue;
    }

    const instance = (mod.default && typeof mod.default === 'object' ? mod.default : mod) as Record<string, unknown>;
    const record = validateCapability(instance, filePath, source);
    if (record) out.push(record);
  }

  return out;
}

function relativeIn(dir: string, filePath: string): string {
  return filePath.startsWith(dir) ? filePath.slice(dir.length).replace(/^[\\/]/, '') : filePath;
}

/**
 * Turn a raw import-time error message into a minlo-friendly hint.
 *
 * Two cases get special treatment:
 *   1. "Cannot find package 'X' imported from ..." — the user is missing
 *      an npm dep. We point them at the right install command, which differs
 *      by ability source: local abilities must be installed into the
 *      project's node_modules; global abilities should also be installed
 *      there (minlo does not auto-resolve from its own bundle).
 *   2. Anything else (syntax error, TypeScript failure, etc.) — fall back
 *      to the raw message with the file path prefixed.
 */
function describeImportFailure(
  raw: string,
  source: 'local' | 'global',
  dir: string,
  filePath: string,
): string {
  const rel = relativeIn(dir, filePath);
  const pkgMatch = /Cannot find package ['"]([^'"]+)['"]/.exec(raw);
  if (pkgMatch) {
    const pkg = pkgMatch[1];
    const where = source === 'global' ? 'global ability' : 'local ability';
    return (
      `minlo: cannot import ${rel} (${where}): missing npm package "${pkg}"\n` +
      `       ${raw}\n` +
      `       Install it in your project's node_modules:\n` +
      `         npm install ${pkg}\n` +
      `       (This is required even for global abilities — see CLAUDE.md §3.10.)`
    );
  }
  return `minlo: cannot import ${rel}: ${raw}`;
}

function validateCapability(
  instance: Record<string, unknown>,
  filePath: string,
  source: 'local' | 'global',
): CapabilityRecord | null {
  // 1. Field whitelist
  for (const k of Object.keys(instance)) {
    if (!ALLOWED_KEYS.has(k)) {
      console.error(
        `minlo: reject ${relativeIn('', filePath)} — unknown field "${k}" ` +
          `(allowed: name, description, init, execute, destroy)`,
      );
      return null;
    }
  }

  // 2. name required
  const name = instance.name;
  if (typeof name !== 'string' || name.length === 0) {
    console.error(`minlo: reject ${relativeIn('', filePath)} — missing or invalid "name"`);
    return null;
  }

  // 3. description required
  const description = instance.description;
  if (typeof description !== 'string') {
    console.error(`minlo: reject ${relativeIn('', filePath)} — missing or invalid "description"`);
    return null;
  }

  // 4. At least one of init / execute / destroy
  const hasInit = typeof instance.init === 'function';
  const hasExecute = typeof instance.execute === 'function';
  const hasDestroy = typeof instance.destroy === 'function';
  if (!hasInit && !hasExecute && !hasDestroy) {
    console.error(
      `minlo: reject ${relativeIn('', filePath)} — ` +
        `"${name}" exports none of init / execute / destroy`,
    );
    return null;
  }

  // 5. deps (optional) — must be string[] if present
  let deps: string[] = [];
  if (instance.deps !== undefined) {
    if (!Array.isArray(instance.deps) || !instance.deps.every((d) => typeof d === 'string')) {
      console.error(
        `minlo: reject ${relativeIn('', filePath)} — ` +
          `"${name}" deps must be a string[] (got ${typeof instance.deps})`,
      );
      return null;
    }
    deps = instance.deps as string[];
  }

  // 6. externalDeps (optional) — must be string[] of npm package names
  let externalDeps: string[] = [];
  if (instance.externalDeps !== undefined) {
    if (
      !Array.isArray(instance.externalDeps) ||
      !instance.externalDeps.every((d) => typeof d === 'string')
    ) {
      console.error(
        `minlo: reject ${relativeIn('', filePath)} — ` +
          `"${name}" externalDeps must be a string[] of npm package names`,
      );
      return null;
    }
    externalDeps = instance.externalDeps as string[];
  }

  // 7. provide (optional) — must be a plain object whose values are all
  //    functions. When present, the framework exposes this object to
  //    other abilities via `process.minlo.call('<name>.<fn>', ...args)`.
  //    See docs/design.md §3.12 (v1.1 — replaces the rejected
  //    `process:minlo` virtual-module design).
  if (instance.provide !== undefined) {
    if (instance.provide === null || typeof instance.provide !== 'object' || Array.isArray(instance.provide)) {
      console.error(
        `minlo: reject ${relativeIn('', filePath)} — ` +
          `"${name}" provide must be a plain object of { [fnName]: function }`,
      );
      return null;
    }
    for (const [k, v] of Object.entries(instance.provide as Record<string, unknown>)) {
      if (typeof v !== 'function') {
        console.error(
          `minlo: reject ${relativeIn('', filePath)} — ` +
            `"${name}" provide["${k}"] must be a function`,
        );
        return null;
      }
    }
  }

  return {
    name,
    description,
    hasInit,
    hasExecute,
    hasDestroy,
    deps,
    externalDeps,
    instance,
    source,
    filePath,
  };
}

/**
 * Build the merged registry from local + global directories.
 * Local takes precedence on name collision (per CLAUDE.md §3.6 / §5.1).
 */
export async function buildRegistry(localDir: string, globalDir: string): Promise<CapabilityRecord[]> {
  const locals = await loadCapabilitiesFrom({ dir: localDir, source: 'local' });
  const globals = await loadCapabilitiesFrom({ dir: globalDir, source: 'global' });

  const byName = new Map<string, CapabilityRecord>();
  const conflicts: string[] = [];

  // Globals first (lower priority)
  for (const rec of globals) {
    byName.set(rec.name, rec);
  }
  // Locals override
  for (const rec of locals) {
    if (byName.has(rec.name)) {
      const existing = byName.get(rec.name)!;
      if (existing.source !== 'local') {
        conflicts.push(rec.name);
      }
    }
    byName.set(rec.name, rec);
  }

  for (const name of conflicts) {
    console.error(`minlo: capability "${name}" — local version overrides global`);
  }

  return [...byName.values()];
}

/**
 * Cheap pre-scan: read each .js/.ts file in `dir` and extract the
 * `externalDeps = [...]` array literal via a small regex. Used to check
 * npm dependencies BEFORE actually importing capability files (which would
 * fail with a noisy stack trace if a dep is missing).
 *
 * Returns a Map<capabilityName, { pkgs, source }>. Files that fail to read
 * or don't declare externalDeps are simply absent from the result.
 */
export async function scanExternalDeps(
  dir: string,
  source: 'local' | 'global',
): Promise<Map<string, { pkgs: string[]; source: 'local' | 'global' }>> {
  const result = new Map<string, { pkgs: string[]; source: 'local' | 'global' }>();
  if (!existsSync(dir)) return result;

  // Matches:  export const externalDeps = [ 'foo', "bar" ]  (whitespace tolerant)
  const re = /export\s+const\s+externalDeps\s*=\s*\[([^\]]*)\]/;

  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith('.js') && !entry.endsWith('.ts')) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (!st.isFile()) continue;
    try {
      const text = readFileSync(full, 'utf8');
      const m = re.exec(text);
      if (!m) continue;
      const arr = m[1];
      const pkgs: string[] = [];
      for (const raw of arr.split(',')) {
        const lit = raw.trim().replace(/^['"]|['"]$/g, '');
        if (lit) pkgs.push(lit);
      }
      if (pkgs.length === 0) continue;
      // Try to also pull a `name = '...'` from the same file so we can key
      // by capability name. Falls back to filename.
      const nameMatch = /export\s+const\s+name\s*=\s*['"]([^'"]+)['"]/.exec(text);
      const capName = nameMatch ? nameMatch[1] : entry.replace(/\.(js|ts)$/, '');
      result.set(capName, { pkgs, source });
    } catch {
      // unreadable files: skip silently, full validation will catch them later
    }
  }
  return result;
}
