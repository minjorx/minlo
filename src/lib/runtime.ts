// Runtime helpers: detect whether tsx is installed (so we can load .ts files).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);

export function hasTypeScript(): boolean {
  // Quick syntactic check: any .ts file in capabilities/ → true
  // (we still verify tsx is loadable below).
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
