/**
 * WebSocket client with exponential reconnect. Every frame from the server
 * is a StationEvent; every frame we send is a StationCommand. On reconnect
 * we ask for a fresh snapshot so the store can resync.
 */
import type { StationCommand, StationEvent } from '@eternity/core';
import type { ConnectionState } from './store.js';

export interface Transport {
  start(): void;
  stop(): void;
  /** Returns false when the command could not be sent right now (it is queued). */
  sendCommand(command: StationCommand): boolean;
}

export interface NetOptions {
  url: string;
  onEvent(event: StationEvent): void;
  onStatus(state: ConnectionState): void;
  minDelayMs?: number;
  maxDelayMs?: number;
  maxQueued?: number;
  webSocketFactory?: (url: string) => WebSocket;
}

export function defaultWsUrl(loc: Pick<Location, 'protocol' | 'host'>): string {
  const proto = loc.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${loc.host}/ws`;
}

export function isStationEvent(value: unknown): value is StationEvent {
  return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string';
}

/** Delay before reconnect attempt `attempt` (0-based) with jitter. */
export function backoffDelay(attempt: number, minMs: number, maxMs: number, jitter: number = Math.random()): number {
  const base = Math.min(maxMs, minMs * 2 ** Math.min(attempt, 12));
  return Math.round(base * (0.75 + jitter * 0.5));
}

export function createNetClient(options: NetOptions): Transport {
  const minDelay = options.minDelayMs ?? 500;
  const maxDelay = options.maxDelayMs ?? 15_000;
  const maxQueued = options.maxQueued ?? 32;
  const factory = options.webSocketFactory ?? ((url: string) => new WebSocket(url));

  let socket: WebSocket | null = null;
  let attempt = 0;
  let everConnected = false;
  let stopped = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  const queue: StationCommand[] = [];

  const flushQueue = (): void => {
    while (queue.length > 0 && socket !== null && socket.readyState === WebSocket.OPEN) {
      const next = queue.shift();
      if (next !== undefined) socket.send(JSON.stringify(next));
    }
  };

  const scheduleReconnect = (): void => {
    if (stopped || reconnectTimer !== null) return;
    const delay = backoffDelay(attempt, minDelay, maxDelay);
    attempt++;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  };

  const handleMessage = (raw: unknown): void => {
    if (typeof raw !== 'string') return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.warn('[net] dropped malformed frame');
      return;
    }
    if (!isStationEvent(parsed)) {
      console.warn('[net] dropped frame without type');
      return;
    }
    options.onEvent(parsed);
  };

  const connect = (): void => {
    if (stopped) return;
    options.onStatus('connecting');
    let ws: WebSocket;
    try {
      ws = factory(options.url);
    } catch (err) {
      console.warn('[net] failed to open socket', err);
      scheduleReconnect();
      return;
    }
    socket = ws;

    ws.addEventListener('open', () => {
      if (socket !== ws) return;
      attempt = 0;
      options.onStatus('open');
      if (everConnected) ws.send(JSON.stringify({ type: 'snapshot.request' } satisfies StationCommand));
      everConnected = true;
      flushQueue();
    });
    ws.addEventListener('message', (e: MessageEvent) => {
      if (socket === ws) handleMessage(e.data);
    });
    ws.addEventListener('close', () => {
      if (socket !== ws) return;
      socket = null;
      options.onStatus('closed');
      scheduleReconnect();
    });
    ws.addEventListener('error', () => {
      // The close event follows and drives the reconnect.
    });
  };

  return {
    start(): void {
      stopped = false;
      if (socket === null) connect();
    },
    stop(): void {
      stopped = true;
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      const ws = socket;
      socket = null;
      ws?.close();
      options.onStatus('closed');
    },
    sendCommand(command: StationCommand): boolean {
      if (socket !== null && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(command));
        return true;
      }
      if (queue.length >= maxQueued) queue.shift();
      queue.push(command);
      return false;
    },
  };
}
