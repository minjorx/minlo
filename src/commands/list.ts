// `minlo list` — list all abilities in the registry.
//
// Output format (one line per ability):
//   <name>     [init] [execute] [destroy]   <description>   (local|global)
//
// Per CLAUDE.md §6.1.3.
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { Command } from 'commander';
import { buildRegistry } from '../lib/loader.js';

export function registerList(program: Command): void {
  program
    .command('list')
    .description('List all registered abilities with their exported function tags')
    .action(async () => {
      const cwd = process.cwd();
      const localAbilitiesDir = join(cwd, '.minlo', 'abilities');
      const globalAbilitiesDir = join(homedir(), '.minlo', 'abilities');

      const registry = await buildRegistry(localAbilitiesDir, globalAbilitiesDir);

      if (registry.length === 0) {
        console.log('minlo: no abilities found');
        console.log(`  local:  ${localAbilitiesDir}`);
        console.log(`  global: ${globalAbilitiesDir}`);
        console.log('');
        console.log('Add a .js file under .minlo/abilities/ to get started.');
        return;
      }

      // Sort by source (local first) then by name, for deterministic output
      const sorted = [...registry].sort((a, b) => {
        if (a.source !== b.source) return a.source === 'local' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      // Compute padding for the name column
      const nameWidth = Math.max(...sorted.map((r) => r.name.length));
      const tagWidth = '[init] [execute] [destroy]'.length;

      for (const ability of sorted) {
        const tags =
          (ability.hasInit ? '[init] ' : '       ').padEnd(7) +
          (ability.hasExecute ? '[execute] ' : '          ').padEnd(10) +
          (ability.hasDestroy ? '[destroy]' : '         ');
        const paddedName = ability.name.padEnd(nameWidth);
        const paddedTags = tags.padEnd(tagWidth);
        console.log(`${paddedName}  ${paddedTags}  ${ability.description}  (${ability.source})`);
      }
    });
}
