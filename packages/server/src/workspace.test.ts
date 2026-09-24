import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { tempDir } from './testUtil.js';
import { WorkspaceError, createWorkspace, resolveConfined } from './workspace.js';

describe('workspace confinement', () => {
  let dir: ReturnType<typeof tempDir>;
  beforeEach(() => {
    dir = tempDir('ws-');
  });
  afterEach(() => dir.cleanup());

  it('writes, reads and lists files under the venture root', () => {
    const ws = createWorkspace(dir.path, 'ven_abc123');
    const rel = ws.write('designs/nested/fox.svg', '<svg/>');
    expect(rel).toBe('designs/nested/fox.svg');
    expect(ws.read('designs/nested/fox.svg')).toBe('<svg/>');
    ws.write('notes.md', 'hi');
    expect(ws.list()).toEqual(['designs/nested/fox.svg', 'notes.md']);
    expect(ws.root.endsWith('ven_abc123')).toBe(true);
  });

  it('rejects ../ traversal, absolute paths and odd segments', () => {
    const ws = createWorkspace(dir.path, 'ven_abc123');
    expect(() => ws.write('../escape.txt', 'x')).toThrow(WorkspaceError);
    expect(() => ws.write('designs/../../escape.txt', 'x')).toThrow(WorkspaceError);
    expect(() => ws.write('/etc/passwd', 'x')).toThrow(WorkspaceError);
    expect(() => ws.read('/etc/passwd')).toThrow(WorkspaceError);
    expect(() => ws.write('C:/windows/x', 'x')).toThrow(WorkspaceError);
    expect(() => ws.write('a\\b.txt', 'x')).toThrow(WorkspaceError);
    expect(() => ws.write('./a.txt', 'x')).toThrow(WorkspaceError);
    expect(() => ws.write('', 'x')).toThrow(WorkspaceError);
    expect(() => ws.write('a\0b', 'x')).toThrow(WorkspaceError);
  });

  it('rejects paths that escape through a symlink', () => {
    const outside = join(dir.path, 'outside');
    mkdirSync(outside);
    writeFileSync(join(outside, 'secret.txt'), 'secret');
    const ws = createWorkspace(dir.path, 'ven_link');
    symlinkSync(outside, join(ws.root, 'link'));
    expect(() => ws.read('link/secret.txt')).toThrow(WorkspaceError);
    expect(() => resolveConfined(ws.root, 'link/new.txt')).toThrow(WorkspaceError);
  });

  it('refuses unsafe venture ids', () => {
    expect(() => createWorkspace(dir.path, '../oops')).toThrow(WorkspaceError);
    expect(() => createWorkspace(dir.path, 'Has Spaces')).toThrow(WorkspaceError);
  });
});
