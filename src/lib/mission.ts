// Mission loader.
//
// Resolves a mission name (per CLAUDE.md §6.1.2) to an absolute path, reads
// the JSON, and validates that every name in `capabilities` exists in the
// capability registry.
//
// `capabilities` schema (v1): each item is either:
//   - a string  (e.g. "openai")   — equivalent to { name: "openai" }
//   - an object (e.g. { name: "openai", config: { ... } })
//
// The `config` object is stored as-is on the MissionSpec. The run command
// later exposes it to the capability at process.minlo.configs[name].
//
// Terminology note: we use "mission" (not "agent") because minlo is not
// tied to LLM. A mission can be an LLM REPL, a MUD room update, a periodic
// timer — anything that combines capabilities into a runnable unit.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CapabilityRecord } from './loader.js';

export interface AbilityRef {
  name: string;
  config?: Record<string, unknown>;
}

export interface MissionSpec {
  name: string;
  description?: string;
  capabilities: AbilityRef[];
  raw: Record<string, unknown>;
  filePath: string;
}

export type MissionResolution =
  | { kind: 'strict'; missionName: string }
  | { kind: 'fallback'; primary: string; fallback: string };

/**
 * Parse `minlo run` positional arg per §6.1.2:
 *   - undefined / "" → use "default" (fixed)
 *   - "foo"         → strict: must exist
 *   - "foo:bar"     → try "foo", fallback to "bar"
 */
export function parseMissionArg(arg: string | undefined): MissionResolution {
  if (!arg) return { kind: 'strict', missionName: 'default' };
  if (arg.includes(':')) {
    const [primary, fallback] = arg.split(':', 2);
    return { kind: 'fallback', primary, fallback };
  }
  return { kind: 'strict', missionName: arg };
}

/**
 * Resolve a MissionResolution to an absolute path + validated MissionSpec.
 * Throws if not found; throws if JSON is invalid; throws if capabilities
 * reference names not in the registry.
 */
export function resolveMission(
  resolution: MissionResolution,
  missionsDir: string,
  registry: CapabilityRecord[],
): MissionSpec {
  const candidates: string[] =
    resolution.kind === 'strict'
      ? [resolution.missionName]
      : [resolution.primary, resolution.fallback];

  let lastAttempted: string | null = null;
  for (const name of candidates) {
    lastAttempted = name;
    const filePath = join(missionsDir, `${name}.json`);
    if (existsSync(filePath)) {
      return loadMission(filePath, registry, name);
    }
  }

  throw new MissionNotFoundError(candidates, lastAttempted);
}

export class MissionNotFoundError extends Error {
  constructor(public readonly tried: string[], public readonly lastName: string | null) {
    super(`mission not found: tried ${tried.map((n) => `"${n}"`).join(', ')}`);
    this.name = 'MissionNotFoundError';
  }
}

function loadMission(
  filePath: string,
  registry: CapabilityRecord[],
  expectedName: string,
): MissionSpec {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>;
  } catch (err) {
    throw new Error(`Cannot parse mission JSON at ${filePath}: ${(err as Error).message}`);
  }

  // name
  if (typeof raw.name !== 'string' || raw.name.length === 0) {
    throw new Error(`mission at ${filePath} — missing or invalid "name"`);
  }

  // description
  const description = typeof raw.description === 'string' ? raw.description : undefined;

  // abilities — v1: each item is string OR { name, config? }
  // (We store internally as `capabilities` but the on-disk JSON field is
  //  `abilities` — see CLAUDE.md §3.3)
  if (!Array.isArray(raw.abilities)) {
    throw new Error(`mission "${expectedName}" — "abilities" must be an array`);
  }
  const capabilities: AbilityRef[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < raw.abilities.length; i++) {
    const item = raw.abilities[i];
    const at = `abilities[${i}]`;

    let ref: AbilityRef;
    if (typeof item === 'string') {
      if (item.length === 0) {
        throw new Error(`mission "${expectedName}" — ${at} is an empty string`);
      }
      ref = { name: item };
    } else if (item && typeof item === 'object' && !Array.isArray(item)) {
      const obj = item as Record<string, unknown>;
      if (typeof obj.name !== 'string' || obj.name.length === 0) {
        throw new Error(`mission "${expectedName}" — ${at}.name must be a non-empty string`);
      }
      let config: Record<string, unknown> | undefined;
      if (obj.config !== undefined) {
        if (
          obj.config === null ||
          typeof obj.config !== 'object' ||
          Array.isArray(obj.config)
        ) {
          throw new Error(
            `mission "${expectedName}" — ${at}.config must be an object (got ${
              obj.config === null ? 'null' : Array.isArray(obj.config) ? 'array' : typeof obj.config
            })`,
          );
        }
        config = obj.config as Record<string, unknown>;
      }
      ref = { name: obj.name, config };
    } else {
      throw new Error(
        `mission "${expectedName}" — ${at} must be a string or { name, config? } object`,
      );
    }

    if (seen.has(ref.name)) {
      throw new Error(
        `mission "${expectedName}" — capability "${ref.name}" appears more than capabilities`,
      );
    }
    seen.add(ref.name);
    capabilities.push(ref);
  }

  // Reject v1-removed fields explicitly
  for (const forbidden of ['loop', 'type', 'order']) {
    if (forbidden in raw) {
      throw new Error(
        `mission "${expectedName}" — field "${forbidden}" is not allowed in v1 ` +
          `(see CLAUDE.md §3.3 / §10.1)`,
      );
    }
  }

  // Validate capabilities reference real capabilities
  const registered = new Set(registry.map((c) => c.name));
  for (const a of capabilities) {
    if (!registered.has(a.name)) {
      throw new Error(
        `mission "${expectedName}" references unknown capability "${a.name}" ` +
          `(check .minlo/capabilities/ or remove the reference)`,
      );
    }
  }

  return { name: raw.name, description, capabilities, raw, filePath };
}
