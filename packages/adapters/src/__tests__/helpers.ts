import type { Listing } from '@eternity/core';
import type { AssetFile } from '../types.js';

export interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
  rawBody: RequestInit['body'];
}

export interface FakeResponseSpec {
  status?: number;
  json?: unknown;
  text?: string;
}

type Responder = (call: RecordedCall, index: number) => FakeResponseSpec;

/** A fetch double that records every call and answers from a responder or a queue. */
export function fakeFetch(responder: Responder | FakeResponseSpec[]): { fetch: typeof fetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const queue = Array.isArray(responder) ? [...responder] : undefined;
  const fetchImpl = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const call = record(input, init);
    calls.push(call);
    const spec = queue ? queue.shift() ?? { status: 200, json: {} } : (responder as Responder)(call, calls.length - 1);
    const status = spec.status ?? 200;
    const body = spec.text ?? (spec.json === undefined ? '' : JSON.stringify(spec.json));
    const nullBody = status === 204 || status === 205 || status === 304;
    return new Response(nullBody ? null : body, { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { fetch: fetchImpl, calls };
}

export function throwingFetch(message = 'ECONNRESET'): typeof fetch {
  return (async () => {
    throw new Error(message);
  }) as typeof fetch;
}

function record(input: Parameters<typeof fetch>[0], init?: RequestInit): RecordedCall {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  const headers = normaliseHeaders(init?.headers);
  const rawBody = init?.body;
  return { url, method: init?.method ?? 'GET', headers, body: parseBody(rawBody), rawBody };
}

function normaliseHeaders(h: RequestInit['headers']): Record<string, string> {
  const out: Record<string, string> = {};
  if (!h) return out;
  if (h instanceof Headers) {
    h.forEach((v, k) => {
      out[k.toLowerCase()] = v;
    });
    return out;
  }
  const entries = Array.isArray(h) ? h : Object.entries(h);
  for (const [k, v] of entries as Array<[string, string]>) out[k.toLowerCase()] = v;
  return out;
}

function parseBody(body: RequestInit['body']): unknown {
  if (body === undefined || body === null) return undefined;
  if (typeof body === 'string') {
    try {
      return JSON.parse(body) as unknown;
    } catch {
      return Object.fromEntries(new URLSearchParams(body).entries());
    }
  }
  if (body instanceof FormData) return body;
  return body;
}

export function sampleListing(overrides: Partial<Listing> = {}): Listing {
  return {
    id: 'lst_abc123',
    ventureId: 'ven_pod1',
    storefrontId: 'sf_1',
    platform: 'etsy',
    title: 'Vintage Botanical Cat Tee',
    description: 'A soft unisex tee with a hand-drawn botanical cat illustration. **AI-assisted** design.',
    tags: ['cat shirt', 'botanical', 'vintage tee', 'cottagecore'],
    priceCents: 2499,
    unitCostCents: 1150,
    quality: 0.8,
    niche: 'botanical-cats',
    status: 'awaiting-approval',
    createdAtTick: 12,
    assets: ['art/cat-front.png', 'art/mockup-1.png'],
    stats: { impressions: 0, clicks: 0, sales: 0, revenueCents: 0 },
    ...overrides,
  };
}

export function png(name = 'art/cat-front.png'): AssetFile {
  return { path: name, mime: 'image/png', bytes: new Uint8Array([137, 80, 78, 71, 1, 2, 3]) };
}

export function markdown(name = 'posts/best-cat-trees.md', text = '# Best cat trees\n\nOur pick is the [Tower](https://amzn.to/x).\n\n- tall\n- sturdy'): AssetFile {
  return { path: name, mime: 'text/markdown', bytes: new TextEncoder().encode(text) };
}
