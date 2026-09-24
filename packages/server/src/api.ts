/**
 * HTTP + WebSocket API. REST routes are exactly the ones in CONTRACTS.md;
 * the WebSocket at /ws sends a snapshot first, then every bus event, and
 * accepts StationCommand frames validated with StationCommandSchema.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import { StationCommandSchema, type StationEvent } from '@eternity/core';
import type { Station } from './station.js';

const MAX_BODY_BYTES = 64 * 1024;
const MAX_LEDGER_LIMIT = 5000;
const DEFAULT_LEDGER_LIMIT = 500;
const HEARTBEAT_MS = 30_000;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
};

export interface ApiOptions {
  staticDir?: string;
}

export interface Api {
  server: Server;
  wss: WebSocketServer;
  listen(port: number, host?: string): Promise<number>;
  close(): Promise<void>;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text), 'access-control-allow-origin': '*' });
  res.end(text);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new HttpError(413, 'Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolvePromise(Buffer.concat(chunks).toString('utf8')));
    req.on('error', (error) => reject(new HttpError(400, error.message)));
  });
}

function parseIntParam(value: string | null, fallback: number, min: number, max: number): number {
  if (value === null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isInteger(n)) throw new HttpError(400, `Expected an integer, got "${value}"`);
  return Math.min(max, Math.max(min, n));
}

export function createApi(station: Station, opts: ApiOptions = {}): Api {
  const staticRoot = opts.staticDir ? resolve(opts.staticDir) : undefined;
  const server = createServer((req, res) => void handle(req, res));
  const wss = new WebSocketServer({ noServer: true });
  const alive = new WeakSet<WebSocket>();

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type' });
        res.end();
        return;
      }
      if (url.pathname.startsWith('/api/')) {
        await handleApi(req, res, url);
        return;
      }
      if (staticRoot && req.method === 'GET') {
        serveStatic(res, staticRoot, url.pathname);
        return;
      }
      sendJson(res, 404, { ok: false, reason: 'Not found' });
    } catch (error) {
      if (error instanceof HttpError) sendJson(res, error.status, { ok: false, reason: error.message });
      else {
        console.error('[api] request failed:', error);
        sendJson(res, 500, { ok: false, reason: 'Internal error' });
      }
    }
  }

  async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const route = `${req.method} ${url.pathname}`;
    switch (route) {
      case 'GET /api/health': {
        const config = station.world.config;
        sendJson(res, 200, {
          ok: true,
          mode: config.mode,
          tick: station.tick,
          seed: station.world.seed,
          paused: station.world.clock.paused,
          speed: station.world.clock.speed,
          ...(config.mode === 'sim' ? { simDemandMultiplier: config.simDemandMultiplier } : {}),
        });
        return;
      }
      case 'GET /api/state':
        sendJson(res, 200, station.state());
        return;
      case 'GET /api/capabilities':
        sendJson(res, 200, station.registry.capabilities());
        return;
      case 'GET /api/ledger': {
        const sinceTick = parseIntParam(url.searchParams.get('sinceTick'), 0, 0, Number.MAX_SAFE_INTEGER);
        const limit = parseIntParam(url.searchParams.get('limit'), DEFAULT_LEDGER_LIMIT, 1, MAX_LEDGER_LIMIT);
        sendJson(res, 200, station.world.ledger.since(sinceTick, limit));
        return;
      }
      case 'POST /api/command': {
        const text = await readBody(req);
        let json: unknown;
        try {
          json = JSON.parse(text);
        } catch {
          throw new HttpError(400, 'Body must be JSON');
        }
        const parsed = StationCommandSchema.safeParse(json);
        if (!parsed.success) throw new HttpError(400, `Invalid command: ${parsed.error.issues.map((i) => `${i.path.join('.') || 'type'}: ${i.message}`).join('; ')}`);
        const result = station.command(parsed.data);
        if (result.ok) sendJson(res, 200, { ok: true });
        else sendJson(res, 409, result);
        return;
      }
      default:
        throw new HttpError(404, `No route ${route}`);
    }
  }

  function serveStatic(res: ServerResponse, root: string, pathname: string): void {
    const safe = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
    let file = join(root, safe);
    if (!file.startsWith(root)) throw new HttpError(403, 'Forbidden');
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(root, 'index.html');
    if (!existsSync(file)) throw new HttpError(404, 'Not found');
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    createReadStream(file).pipe(res);
  }

  // -------------------------------------------------------------------
  // WebSocket
  // -------------------------------------------------------------------

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/ws') {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  const send = (ws: WebSocket, event: StationEvent | { type: 'command.ok'; commandType: string }): void => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(event));
  };

  wss.on('connection', (ws) => {
    alive.add(ws);
    ws.on('pong', () => alive.add(ws));
    send(ws, { type: 'snapshot', state: station.state() });
    ws.on('message', (raw: RawData) => {
      let json: unknown;
      try {
        json = JSON.parse(raw.toString());
      } catch {
        send(ws, { type: 'command.rejected', reason: 'Frame must be JSON' });
        return;
      }
      const parsed = StationCommandSchema.safeParse(json);
      if (!parsed.success) {
        send(ws, { type: 'command.rejected', reason: parsed.error.issues.map((i) => `${i.path.join('.') || 'type'}: ${i.message}`).join('; '), command: json });
        return;
      }
      if (parsed.data.type === 'snapshot.request') {
        send(ws, { type: 'snapshot', state: station.state() });
        send(ws, { type: 'command.ok', commandType: parsed.data.type });
        return;
      }
      const result = station.command(parsed.data);
      if (result.ok) send(ws, { type: 'command.ok', commandType: parsed.data.type });
      else send(ws, { type: 'command.rejected', reason: result.reason, command: json });
    });
  });

  const unsubscribe = station.world.bus.onAny((event) => {
    if (wss.clients.size === 0) return;
    const text = JSON.stringify(event);
    for (const client of wss.clients) if (client.readyState === WebSocket.OPEN) client.send(text);
  });

  const heartbeat = setInterval(() => {
    for (const client of wss.clients) {
      if (!alive.has(client)) {
        client.terminate();
        continue;
      }
      alive.delete(client);
      client.ping();
    }
  }, HEARTBEAT_MS);
  heartbeat.unref();

  return {
    server,
    wss,
    listen: (port, host = '0.0.0.0') =>
      new Promise((resolvePromise, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          const address = server.address();
          resolvePromise(typeof address === 'object' && address ? address.port : port);
        });
      }),
    close: () =>
      new Promise((resolvePromise) => {
        clearInterval(heartbeat);
        unsubscribe();
        for (const client of wss.clients) client.close(1001, 'server shutting down');
        wss.close(() => server.close(() => resolvePromise()));
      }),
  };
}
