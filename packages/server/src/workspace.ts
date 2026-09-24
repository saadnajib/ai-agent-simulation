/**
 * Confined filesystem per venture. Every path a brain (scripted or model)
 * supplies is resolved under `<WORKSPACE_ROOT>/<ventureId>` and rejected if it
 * escapes: lexical check first, then fs.realpath for anything that exists so
 * symlinks cannot smuggle a path out.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export class WorkspaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkspaceError';
  }
}

export interface Workspace {
  /** Absolute root of this venture's workspace. */
  readonly root: string;
  /** Path of this workspace relative to WORKSPACE_ROOT (the venture id). */
  readonly relRoot: string;
  /** Writes text under the workspace and returns the normalised relative path. */
  write(rel: string, content: string | Uint8Array): string;
  read(rel: string): string;
  /** Every file under the root, as sorted relative POSIX paths. */
  list(): string[];
  exists(rel: string): boolean;
  resolve(rel: string): string;
}

const SAFE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const MAX_FILE_BYTES = 4 * 1024 * 1024;

function toPosix(path: string): string {
  return path.split(sep).join('/');
}

/** Resolves `rel` under `root`, throwing WorkspaceError for anything that escapes. */
export function resolveConfined(root: string, rel: string): string {
  if (typeof rel !== 'string' || rel.length === 0) throw new WorkspaceError('Path must be a non-empty string');
  if (rel.length > 512) throw new WorkspaceError('Path is too long');
  if (rel.includes('\0')) throw new WorkspaceError('Path contains a null byte');
  if (rel.includes('\\')) throw new WorkspaceError('Use forward slashes in paths');
  if (isAbsolute(rel) || rel.startsWith('/') || /^[a-zA-Z]:/.test(rel)) throw new WorkspaceError(`Absolute paths are not allowed: ${rel}`);
  const segments = rel.split('/').filter((s) => s.length > 0);
  if (segments.length === 0) throw new WorkspaceError('Path resolves to the workspace root');
  if (segments.some((s) => s === '..')) throw new WorkspaceError(`Path may not contain "..": ${rel}`);
  if (segments.some((s) => s === '.')) throw new WorkspaceError(`Path may not contain "." segments: ${rel}`);

  const absRoot = resolve(root);
  const target = resolve(absRoot, ...segments);
  const relFromRoot = relative(absRoot, target);
  if (relFromRoot === '' || relFromRoot.startsWith('..') || isAbsolute(relFromRoot)) {
    throw new WorkspaceError(`Path escapes the workspace: ${rel}`);
  }
  // Realpath check on the deepest existing ancestor (or the file itself).
  let probe = target;
  while (!existsSync(probe)) {
    const parent = dirname(probe);
    if (parent === probe) break;
    probe = parent;
  }
  const realRoot = existsSync(absRoot) ? realpathSync(absRoot) : absRoot;
  const realProbe = realpathSync(probe);
  const relReal = relative(realRoot, realProbe);
  if (relReal.startsWith('..') || isAbsolute(relReal)) {
    throw new WorkspaceError(`Path escapes the workspace through a link: ${rel}`);
  }
  return target;
}

export function createWorkspace(workspaceRoot: string, ventureId: string): Workspace {
  if (!SAFE_ID.test(ventureId)) throw new WorkspaceError(`Unsafe workspace id: ${ventureId}`);
  const root = resolve(workspaceRoot, ventureId);
  mkdirSync(root, { recursive: true });

  const resolvePath = (rel: string): string => resolveConfined(root, rel);

  const write = (rel: string, content: string | Uint8Array): string => {
    const target = resolvePath(rel);
    const size = typeof content === 'string' ? Buffer.byteLength(content) : content.byteLength;
    if (size > MAX_FILE_BYTES) throw new WorkspaceError(`File exceeds ${MAX_FILE_BYTES} bytes: ${rel}`);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
    return toPosix(relative(root, target));
  };

  const read = (rel: string): string => {
    const target = resolvePath(rel);
    if (!existsSync(target) || !statSync(target).isFile()) throw new WorkspaceError(`No such file: ${rel}`);
    return readFileSync(target, 'utf8');
  };

  const list = (): string[] => {
    const out: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.isFile()) out.push(toPosix(relative(root, full)));
      }
    };
    walk(root);
    return out.sort();
  };

  const exists = (rel: string): boolean => {
    try {
      return existsSync(resolvePath(rel));
    } catch {
      return false;
    }
  };

  return { root, relRoot: ventureId, write, read, list, exists, resolve: resolvePath };
}
