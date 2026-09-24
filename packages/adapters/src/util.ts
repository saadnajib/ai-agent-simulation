/** Small pure helpers shared by the adapters. No IO. */

export function centsToDollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

/** ISO timestamp -> unix seconds (0 when unparsable). */
export function isoToUnixSeconds(iso: string): number {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
}

/** ISO timestamp -> YYYY-MM-DD (today when unparsable). */
export function isoToDate(iso: string): string {
  const ms = Date.parse(iso);
  const d = Number.isFinite(ms) ? new Date(ms) : new Date();
  return d.toISOString().slice(0, 10);
}

export function isImageMime(mime: string): boolean {
  return mime.startsWith('image/');
}

export function fileName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] ?? path;
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

export function hasAll(env: Record<string, string | undefined>, keys: readonly string[]): boolean {
  return keys.every((k) => typeof env[k] === 'string' && env[k]!.trim().length > 0);
}

export function missingKeys(env: Record<string, string | undefined>, keys: readonly string[]): string[] {
  return keys.filter((k) => !(typeof env[k] === 'string' && env[k]!.trim().length > 0));
}

/** Read a numeric env value; undefined when absent or not a finite number. */
export function envNumber(env: Record<string, string | undefined>, key: string): number | undefined {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/** Tiny markdown -> html conversion for blog posts (headings, paragraphs, links, emphasis, lists). */
export function markdownToHtml(md: string): string {
  const blocks = md.replace(/\r\n/g, '\n').split(/\n{2,}/);
  return blocks
    .map((block) => block.trim())
    .filter((block) => block.length > 0)
    .map(renderBlock)
    .join('\n');
}

function renderBlock(block: string): string {
  const heading = /^(#{1,6})\s+(.*)$/.exec(block);
  if (heading) {
    const level = heading[1]!.length;
    return `<h${level}>${inline(heading[2]!)}</h${level}>`;
  }
  const lines = block.split('\n');
  if (lines.every((l) => /^\s*[-*]\s+/.test(l))) {
    const items = lines.map((l) => `<li>${inline(l.replace(/^\s*[-*]\s+/, ''))}</li>`).join('');
    return `<ul>${items}</ul>`;
  }
  return `<p>${inline(lines.join(' '))}</p>`;
}

function inline(text: string): string {
  return escapeHtml(text)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" rel="nofollow sponsored">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
