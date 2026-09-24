/** Tiny DOM helpers: element creation, HTML escaping and keyed list reconciliation. */

export function esc(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else node.setAttribute(k, v);
  }
  for (const child of children) node.append(child);
  return node;
}

interface Tracked {
  el: HTMLElement;
  sig: string;
}

const tracked = new WeakMap<HTMLElement, Map<string, Tracked>>();

export interface ReconcileSpec<T> {
  key(item: T): string;
  /** Cheap signature; the item is re-rendered only when it changes. */
  signature(item: T): string;
  create(item: T): HTMLElement;
  render(node: HTMLElement, item: T): void;
}

/**
 * Keep `container`'s children in sync with `items`, preserving DOM nodes (and
 * their open/scroll/focus state) for items whose signature has not changed.
 */
export function reconcileList<T>(container: HTMLElement, items: readonly T[], spec: ReconcileSpec<T>): void {
  let map = tracked.get(container);
  if (map === undefined) {
    map = new Map();
    tracked.set(container, map);
  }
  const seen = new Set<string>();
  let cursor: Node | null = container.firstChild;
  for (const item of items) {
    const key = spec.key(item);
    seen.add(key);
    const sig = spec.signature(item);
    let entry = map.get(key);
    if (entry === undefined) {
      const node = spec.create(item);
      node.dataset['key'] = key;
      spec.render(node, item);
      entry = { el: node, sig };
      map.set(key, entry);
    } else if (entry.sig !== sig) {
      spec.render(entry.el, item);
      entry.sig = sig;
    }
    if (cursor !== entry.el) {
      container.insertBefore(entry.el, cursor);
    } else {
      cursor = cursor.nextSibling;
    }
  }
  for (const [key, entry] of map) {
    if (seen.has(key)) continue;
    entry.el.remove();
    map.delete(key);
  }
}

export function setText(node: HTMLElement | null, text: string): void {
  if (node !== null && node.textContent !== text) node.textContent = text;
}

export function clamp01(n: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));
}
