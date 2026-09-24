/**
 * Minimal HTTP helper used by every real adapter.
 *
 * Never throws: network failures and non-2xx responses come back as a
 * `HttpResult` with `ok: false`. Error text never includes request headers,
 * so secrets cannot leak into the ledger or the UI.
 */
import type { PublishResult } from './types.js';
import { truncate } from './util.js';

export interface HttpResult {
  ok: boolean;
  status: number;
  /** Parsed JSON body when the response was JSON, otherwise undefined. */
  json: unknown;
  /** Raw body text (truncated) for error messages. */
  text: string;
  /** Transport-level failure message when the request never completed. */
  transportError?: string;
}

const MAX_ERROR_TEXT = 400;

export async function http(fetchImpl: typeof fetch, url: string, init: RequestInit): Promise<HttpResult> {
  let response: Response;
  try {
    response = await fetchImpl(url, init);
  } catch (err) {
    return { ok: false, status: 0, json: undefined, text: '', transportError: errorMessage(err) };
  }
  return readBody(response);
}

async function readBody(response: Response): Promise<HttpResult> {
  let text = '';
  try {
    text = await response.text();
  } catch (err) {
    return { ok: false, status: response.status, json: undefined, text: '', transportError: errorMessage(err) };
  }
  return { ok: response.ok, status: response.status, json: parseJson(text), text: truncate(text, MAX_ERROR_TEXT) };
}

function parseJson(text: string): unknown {
  if (text.trim() === '') return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === 'string' ? err : 'unknown error';
}

/** Human-readable description of a failed call, safe to show in the Airlock. */
export function describeFailure(platform: string, action: string, res: HttpResult): string {
  if (res.transportError) return `${platform} ${action} failed: network error (${res.transportError})`;
  const detail = res.text ? `: ${res.text}` : '';
  return `${platform} ${action} failed with HTTP ${res.status}${detail}`;
}

export function failure(error: string): PublishResult {
  return { ok: false, error };
}

/** Safe accessor for a nested field on an unknown JSON value. */
export function pick(value: unknown, ...path: Array<string | number>): unknown {
  let cur: unknown = value;
  for (const key of path) {
    if (cur === null || cur === undefined) return undefined;
    if (typeof cur !== 'object') return undefined;
    cur = (cur as Record<string | number, unknown>)[key];
  }
  return cur;
}

export function pickString(value: unknown, ...path: Array<string | number>): string | undefined {
  const v = pick(value, ...path);
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  return undefined;
}

export function pickNumber(value: unknown, ...path: Array<string | number>): number | undefined {
  const v = pick(value, ...path);
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

export function pickArray(value: unknown, ...path: Array<string | number>): unknown[] {
  const v = pick(value, ...path);
  return Array.isArray(v) ? v : [];
}

export function jsonHeaders(extra: Record<string, string>): Record<string, string> {
  return { 'Content-Type': 'application/json', Accept: 'application/json', ...extra };
}

export function basicAuth(user: string, password: string): string {
  return `Basic ${Buffer.from(`${user}:${password}`, 'utf8').toString('base64')}`;
}
