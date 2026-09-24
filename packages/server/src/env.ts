/**
 * Repo-root discovery and a minimal .env loader (KEY=VALUE lines, `#`
 * comments, optional quotes). Existing process.env values always win.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

/** Nearest ancestor containing pnpm-workspace.yaml, else the start directory. */
export function findRepoRoot(start: string): string {
  let dir = resolve(start);
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(start);
}

export function parseDotEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, '');
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    } else {
      const hash = value.indexOf(' #');
      if (hash >= 0) value = value.slice(0, hash).trim();
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) out[key] = value;
  }
  return out;
}

/** Loads `<root>/.env` into a copy of env without overriding existing keys. */
export function withDotEnv(env: NodeJS.ProcessEnv, root: string): Record<string, string | undefined> {
  const file = join(root, '.env');
  const merged: Record<string, string | undefined> = { ...env };
  if (!existsSync(file)) return merged;
  for (const [key, value] of Object.entries(parseDotEnv(readFileSync(file, 'utf8')))) {
    if (merged[key] === undefined || merged[key] === '') merged[key] = value;
  }
  return merged;
}

/** Relative data paths resolve against the repo root so `pnpm --filter` cwd does not matter. */
export function resolveDataPath(path: string, root: string): string {
  if (path === ':memory:' || isAbsolute(path)) return path;
  return resolve(root, path);
}
