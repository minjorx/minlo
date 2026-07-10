// Thin dispatcher: build the commander program, register each command
// module, and parse argv. Each `registerXxx` is the only contract commands
// have with the rest of the CLI — adding a new command means a new file
// under src/commands/ and one line here.
import { Command } from 'commander';
import { registerVersion } from './commands/version.js';
import { registerInit } from './commands/init.js';
import { registerRun } from './commands/run.js';
import { registerList } from './commands/list.js';

export interface PackageMetadata {
  name: string;
  version: string;
  description?: string;
}

export async function run(pkg: PackageMetadata, argv: string[]): Promise<void> {
  const program = new Command();
  program
    .name(pkg.name)
    .description(pkg.description ?? 'Minlo project CLI')
    .version(pkg.version, '-V, --version', 'print version');

  registerVersion(program, pkg);
  registerInit(program);
  registerList(program);
  registerRun(program);

  await program.parseAsync(argv);
}
