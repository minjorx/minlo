// `minlo version` — richer than the built-in `-V` flag: shows Node version
// and the package description. Kept separate so commander can register it
// as a subcommand and so `-V` still prints just the semver.
import type { Command } from 'commander';

export function registerVersion(
  program: Command,
  pkg: { name: string; version: string; description?: string },
): void {
  program
    .command('version')
    .description('Print minlo and Node runtime versions')
    .action(() => {
      const lines = [
        `${pkg.name} v${pkg.version}`,
        `Node ${process.versions.node}`,
      ];
      if (pkg.description) lines.push(pkg.description);
      console.log(lines.join('\n'));
    });
}
