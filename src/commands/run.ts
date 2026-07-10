// `minlo run [mission_name[:default]]` — main loop dispatcher.
//
// Per CLAUDE.md §4:
//   阶段 1: mission 解析 + 拓扑序 init
//   阶段 2: 死循环（每轮顺序 execute，按 action 协议决定继续/退出）
//   阶段 3: 倒序 destroy
//   阶段 4: 进程退出
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createRequire } from 'node:module';
import type { Command } from 'commander';
import {
  buildRegistry,
  scanExternalDeps,
  type CapabilityRecord,
} from '../lib/loader.js';
import {
  topoSort,
  DependencyNotFoundError,
  CyclicDependencyError,
} from '../lib/topo.js';
import {
  parseMissionArg,
  resolveMission,
  MissionNotFoundError,
  type MissionSpec,
} from '../lib/mission.js';

interface RunOptions {
  positional?: string;
}

interface MinloNamespace {
  ctx: Record<string, unknown>;
  // configs[name] = mission.capabilities[].config for that ability
  configs: Record<string, Record<string, unknown>>;
}

function ensureMinloNamespace(): MinloNamespace {
  // We attach the namespace to `process` (not `globalThis`) so user code
  // variables named `minlo` don't collide, and so the value doesn't leak
  // into other processes / REPLs sharing the same global object.
  const p = process as NodeJS.Process & { minlo?: MinloNamespace };
  if (!p.minlo) {
    p.minlo = { ctx: {}, configs: {} };
  } else {
    if (!p.minlo.ctx) p.minlo.ctx = {};
    if (!p.minlo.configs) p.minlo.configs = {};
  }
  return p.minlo;
}

/**
 * Check a pre-scanned (capName → { pkgs, source }) map of externalDeps
 * against the project's node_modules. Used BEFORE buildRegistry so
 * missing packages produce a clean "Run: npm install …" error instead
 * of a noisy Node ESM stack trace from a failed import.
 */
function checkExternalDepsByName(
  depsByCap: Map<string, { pkgs: string[]; source: 'local' | 'global' }>,
  projectRoot: string,
): Array<{ cap: string; pkg: string; source: 'local' | 'global' }> {
  if (depsByCap.size === 0) return [];
  let req: NodeRequire;
  try {
    req = createRequire(join(projectRoot, 'package.json'));
  } catch {
    return [...depsByCap.entries()].flatMap(([cap, { pkgs, source }]) =>
      pkgs.map((pkg) => ({ cap, pkg, source })),
    );
  }
  const missing: Array<{ cap: string; pkg: string; source: 'local' | 'global' }> = [];
  for (const [cap, { pkgs, source }] of depsByCap) {
    for (const pkg of pkgs) {
      try {
        req.resolve(pkg);
      } catch {
        missing.push({ cap, pkg, source });
      }
    }
  }
  return missing;
}

export function registerRun(program: Command): void {
  program
    .command('run [mission]')
    .description('Start the main loop with the given mission (or "default" if omitted)')
    .action(async (missionArg: string | undefined) => {
      const exitCode = await runMain({ positional: missionArg });
      process.exit(exitCode);
    });
}

export async function runMain(opts: RunOptions): Promise<number> {
  const cwd = process.cwd();
  const minloDir = join(cwd, '.minlo');
  const localAbilitiesDir = join(minloDir, 'abilities');
  const globalAbilitiesDir = join(homedir(), '.minlo', 'abilities');
  const missionsDir = join(minloDir, 'missions');
  const workspacePath = join(minloDir, 'workspace');

  // Guard: .minlo/ must exist
  if (!existsSync(minloDir)) {
    console.error(
      `minlo: .minlo/ not found in ${cwd}\n` +
        `       Run 'minlo init' first to scaffold a workspace.`,
    );
    return 1;
  }
  if (!existsSync(missionsDir)) {
    console.error(`minlo: .minlo/missions/ not found in ${cwd}`);
    return 1;
  }

  // === 阶段 1 步骤 0: 外部依赖预扫描（在 import 任何能力之前） ===
  // 用正则读源文件拿到每个能力的 externalDeps 声明，先检查 node_modules
  // 是否有这些包。缺包直接给清晰的 "npm install …" 提示，避免 import
  // 失败时的 ESM stack trace。
  const extDepsByCap = await scanExternalDeps(localAbilitiesDir, 'local');
  const extDepsGlobal = await scanExternalDeps(globalAbilitiesDir, 'global');
  const allExtDeps = new Map<string, { pkgs: string[]; source: 'local' | 'global' }>();
  for (const [k, v] of extDepsGlobal) allExtDeps.set(k, v);
  for (const [k, v] of extDepsByCap) allExtDeps.set(k, v); // local overrides global

  const missing = checkExternalDepsByName(allExtDeps, cwd);
  if (missing.length > 0) {
    const pkgs = [...new Set(missing.map((m) => m.pkg))];
    const lines = missing.map((m) => {
      const where = m.source === 'global' ? 'global' : 'local';
      return `  - ${m.pkg} (required by "${m.cap}" — ${where} ability)`;
    });
    console.error(
      `minlo: missing external dependencies:\n` +
        lines.join('\n') +
        `\n       Run: npm install ${pkgs.join(' ')}\n` +
        `       (This installs into the project's node_modules, which is required\n` +
        `        even for global abilities — see CLAUDE.md §3.10.)`,
    );
    return 1;
  }

  // === 阶段 1: 加载 + 解析 ===
  console.log('minlo: loading capabilities...');
  const registry = await buildRegistry(localAbilitiesDir, globalAbilitiesDir);
  if (registry.length === 0) {
    console.error(
      `minlo: no capabilities found in ${localAbilitiesDir}\n` +
        `       Add at least one .js file under .minlo/abilities/ to proceed.`,
    );
    return 1;
  }

  let mission: MissionSpec;
  try {
    const resolution = parseMissionArg(opts.positional);
    mission = resolveMission(resolution, missionsDir, registry);
  } catch (err) {
    if (err instanceof MissionNotFoundError) {
      console.error(
        `minlo: ${err.message}\n` +
          `       Check .minlo/missions/ — none of the tried names exist.`,
      );
    } else {
      console.error(`minlo: ${(err as Error).message}`);
    }
    return 1;
  }
  const abilityNames = mission.capabilities.map((a) => a.name);
  console.log(
    `minlo: mission "${mission.name}" loaded (abilities: ${abilityNames.join(', ') || '<none>'})`,
  );

  // Resolve the set of capabilities actually in play: start from
  // mission.capabilities, then transitively pull in every dep. This way
  // `topoSort` can detect (a) deps that reference names not in the
  // registry at all, and (b) cycles among the full reachable set.
  const byName = new Map(registry.map((c) => [c.name, c]));
  const inScope = new Set<string>();
  const queue: string[] = [...abilityNames];
  while (queue.length > 0) {
    const name = queue.shift()!;
    if (inScope.has(name)) continue;
    const cap = byName.get(name);
    if (!cap) {
      console.error(
        `minlo: mission "${mission.name}" references unknown capability "${name}" ` +
          `(check .minlo/abilities/ or remove the reference)`,
      );
      return 1;
    }
    inScope.add(name);
    for (const dep of cap.deps) queue.push(dep);
  }
  const inScopeRecords = [...inScope].map((n) => byName.get(n)!);

  let orderedCaps: CapabilityRecord[];
  try {
    orderedCaps = topoSort(inScopeRecords);
  } catch (err) {
    if (err instanceof DependencyNotFoundError) {
      // Shouldn't reach here — we already pulled in all transitive deps.
      console.error(`minlo: ${err.message}`);
    } else if (err instanceof CyclicDependencyError) {
      console.error(`minlo: ${err.message}`);
    } else {
      console.error(`minlo: ${(err as Error).message}`);
    }
    return 1;
  }
  console.log(`minlo: init order: ${orderedCaps.map((c) => c.name).join(' → ')}`);

  // === 阶段 1 步骤 4: 创建 minlo 命名空间 + minlo.ctx + minlo.configs ===
  // 框架在 init 之前确保 minlo.ctx 与 minlo.configs 存在；能力 init 里可以放心读写。
  const ns = ensureMinloNamespace();
  for (const ref of mission.capabilities) {
    if (ref.config !== undefined) {
      ns.configs[ref.name] = ref.config;
    }
  }

  const initCtx = { cwd, mission: mission.raw, workspacePath };

  // === 阶段 2: 拓扑序 init ===
  // v1 行为：init 失败 → stderr 报错 → 直接退出（不再进主循环）。
  // 原因：init 失败的 config / 资源问题让主循环毫无意义，
  // 而 execute 二次抛"state not initialized"会污染错误信息。
  console.log('minlo: init phase...');
  for (const cap of orderedCaps) {
    if (!cap.hasInit) continue;
    try {
      await (cap.instance.init as (ctx: typeof initCtx) => Promise<void> | void)(initCtx);
      console.log(`  ✓ init ${cap.name}`);
    } catch (err) {
      console.error(
        `minlo: init "${cap.name}" threw: ${(err as Error).message}`,
      );
      return 1;
    }
  }

  // === 阶段 3: 死循环 ===
  console.log('minlo: main loop (Ctrl-C to abort)...');
  let step = 0;
  let exitCode = 0;
  let aborted = false;

  // Ctrl-C handler: just mark aborted; loop will see and break
  process.on('SIGINT', () => {
    aborted = true;
  });

  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (aborted) {
      console.log('\nminlo: SIGINT received, exiting loop');
      exitCode = 130;
      break;
    }

    for (const cap of orderedCaps) {
      if (!cap.hasExecute) continue;
      if (aborted) break;

      let action: 'continue' | 'break' | 'stop' = 'continue';
      try {
        const result = await (cap.instance.execute as (p: unknown) => Promise<unknown>)({
          cwd,
          mission: mission.raw,
          workspacePath,
          step,
        });
        if (result && typeof result === 'object' && 'action' in result) {
          const a = (result as { action: unknown }).action;
          if (a === 'stop' || a === 'break' || a === 'continue') {
            action = a;
          } else {
            console.error(
              `minlo: execute "${cap.name}" returned unknown action "${String(a)}" — treating as 'continue'`,
            );
          }
        }
      } catch (err) {
        const e = err as Error;
        console.error(`minlo: execute "${cap.name}" threw: ${e.message}`);
        if (e.stack) console.error(e.stack);
        exitCode = 1;
        aborted = true;
        break;
      }

      if (action === 'stop') {
        console.log(`minlo: execute "${cap.name}" returned stop — exiting loop`);
        aborted = true;
        break;
      }
      if (action === 'break') {
        // break the inner for, continue the while
        break;
      }
      // 'continue' falls through
    }

    if (aborted) break;
    step += 1;
  }

  // === 阶段 4: 倒序 destroy ===
  console.log('minlo: destroy phase...');
  for (let i = orderedCaps.length - 1; i >= 0; i--) {
    const cap = orderedCaps[i];
    if (!cap.hasDestroy) continue;
    try {
      await (cap.instance.destroy as (ctx: typeof initCtx) => Promise<void> | void)(initCtx);
      console.log(`  ✓ destroy ${cap.name}`);
    } catch (err) {
      console.error(`minlo: destroy "${cap.name}" threw: ${(err as Error).message}`);
      // Per §4.3, destroy 异常不阻断后续 destroy —— 尽量清理
    }
  }

  // === 阶段 5: 清理 minlo.ctx 与 minlo.configs（保留命名空间本身） ===
  // Per §3.8 / §3.9 / §3.10: 主循环结束清空 ctx/configs；下次 minlo run 重新填充
  const p = process as NodeJS.Process & { minlo?: MinloNamespace };
  if (p.minlo) {
    p.minlo.ctx = {};
    p.minlo.configs = {};
  }

  console.log(`minlo: done (exit ${exitCode})`);
  return exitCode;
}
