import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { createApi, type Api } from './api.js';
import { headlessStation, type HeadlessStation } from './testUtil.js';

describe('api', () => {
  let h: HeadlessStation;
  let api: Api;
  let base: string;

  beforeEach(async () => {
    h = headlessStation();
    api = createApi(h.station);
    const port = await api.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${port}`;
  });

  afterEach(async () => {
    await api.close();
    h.cleanup();
  });

  it('returns 400 for a bad command body', async () => {
    const notJson = await fetch(`${base}/api/command`, { method: 'POST', body: 'nope', headers: { 'content-type': 'application/json' } });
    expect(notJson.status).toBe(400);
    expect(await notJson.json()).toMatchObject({ ok: false });

    const badShape = await fetch(`${base}/api/command`, { method: 'POST', body: JSON.stringify({ type: 'clock.speed', speed: 3 }), headers: { 'content-type': 'application/json' } });
    expect(badShape.status).toBe(400);
    const body = (await badShape.json()) as { ok: boolean; reason: string };
    expect(body.ok).toBe(false);
    expect(body.reason).toMatch(/speed/);
  });

  it('serves health, state, capabilities and ledger and accepts valid commands', async () => {
    const health = (await (await fetch(`${base}/api/health`)).json()) as { ok: boolean; mode: string; tick: number };
    expect(health).toMatchObject({ ok: true, mode: 'sim', tick: 0 });
    const ok = await fetch(`${base}/api/command`, { method: 'POST', body: JSON.stringify({ type: 'clock.speed', speed: 16 }) });
    expect(ok.status).toBe(200);
    const state = (await (await fetch(`${base}/api/state`)).json()) as { clock: { speed: number }; agents: unknown[] };
    expect(state.clock.speed).toBe(16);
    expect(state.agents.length).toBeGreaterThan(0);
    const caps = (await (await fetch(`${base}/api/capabilities`)).json()) as Array<{ platform: string }>;
    expect(caps.some((c) => c.platform === 'mock')).toBe(true);
    const ledger = await fetch(`${base}/api/ledger?sinceTick=0&limit=10`);
    expect(ledger.status).toBe(200);
    expect(Array.isArray(await ledger.json())).toBe(true);
    const rejected = await fetch(`${base}/api/command`, { method: 'POST', body: JSON.stringify({ type: 'agent.dismiss', agentId: 'ghost' }) });
    expect(rejected.status).toBe(409);
  });

  it('sends a snapshot first on /ws and answers command frames', async () => {
    const ws = new WebSocket(`${base.replace('http', 'ws')}/ws`);
    const queue: Array<{ type: string }> = [];
    const waiters: Array<(frame: { type: string }) => void> = [];
    ws.on('message', (raw) => {
      const frame = JSON.parse(raw.toString()) as { type: string };
      const waiter = waiters.shift();
      if (waiter) waiter(frame);
      else queue.push(frame);
    });
    const next = () => new Promise<{ type: string }>((resolve) => {
      const queued = queue.shift();
      if (queued) resolve(queued);
      else waiters.push(resolve);
    });
    await new Promise<void>((resolve) => ws.once('open', () => resolve()));
    expect((await next()).type).toBe('snapshot');
    ws.send('garbage');
    expect((await next()).type).toBe('command.rejected');
    ws.send(JSON.stringify({ type: 'clock.pause' }));
    const replies: string[] = [];
    while (replies.length < 2) replies.push((await next()).type);
    expect(replies).toContain('command.ok');
    ws.close();
  });
});
