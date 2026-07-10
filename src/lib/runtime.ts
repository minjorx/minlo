// Runtime helpers: detect whether tsx is installed (so we can load .ts files).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);

export function hasTypeScript(): boolean {
  // We always say "yes, the project might use TypeScript abilities" here
  // and let `tsxLoaderAvailable()` do the real check by trying to resolve
  // `tsx/esm`. This way the loader can give a clear "tsx not installed"
  // hint when a .ts ability exists but the dep is missing, rather than
  // silently skipping TS support based on a syntactic guess.
  return true;
}

export async function tsxLoaderAvailable(): Promise<boolean> {
  try {
    require_.resolve('tsx/esm');
    return true;
  } catch {
    return false;
  }
}
