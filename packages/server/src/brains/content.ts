/**
 * Deterministic content generators for the scripted brain: SVG artwork with
 * the thesis rendered as text, markdown articles assembled from templates,
 * and JSON specs. Everything is a pure function of its inputs plus an Rng.
 */
import type { Rng, VentureKind } from '@eternity/core';

export function slugify(text: string, maxLength = 48): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
  return slug.length > 0 ? slug : 'untitled';
}

export function titleCase(text: string): string {
  return text
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(' ');
}

export function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function keywordsFor(thesis: string, kind: VentureKind, rng: Rng): string[] {
  const base = thesis
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
  const extras = KIND_KEYWORDS[kind];
  const pool = [...new Set([...base, ...extras])];
  const picked: string[] = [];
  const count = Math.min(pool.length, 13);
  const shuffled = shuffle(pool, rng);
  for (const word of shuffled) {
    if (picked.length >= count) break;
    picked.push(word);
  }
  return picked;
}

export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

const STOPWORDS = new Set(['the', 'and', 'for', 'with', 'under', 'style', 'club', 'kit', 'set', 'pack']);

const KIND_KEYWORDS: Record<VentureKind, string[]> = {
  'pod-store': ['gift', 'unisex tee', 'soft cotton', 'vintage', 'aesthetic', 'graphic tee', 'gift for her', 'gift for him', 'cozy'],
  'game-assets': ['pixel art', 'tileset', 'sprite sheet', 'game dev', 'indie', 'top-down', '2d assets', 'commercial license'],
  'thumbnail-service': ['youtube thumbnail', 'click through', 'custom thumbnail', '24h delivery', 'eye catching', 'channel art'],
  'affiliate-blog': ['best', 'review', 'buying guide', 'comparison', 'budget', 'top picks', 'worth it'],
  'software-templates': ['starter kit', 'boilerplate', 'typescript', 'template', 'saas', 'notion template', 'open source'],
  'music-packs': ['royalty free', 'loop pack', 'game music', 'background music', 'wav', 'seamless loop', 'stock music'],
};

export const PALETTES: ReadonlyArray<readonly [string, string, string]> = [
  ['#1b2a41', '#f2e9dc', '#c9a227'],
  ['#2d1e2f', '#f4d06f', '#ff8811'],
  ['#0b3954', '#bfd7ea', '#ff6663'],
  ['#233d4d', '#fe7f2d', '#fcca46'],
  ['#1c1c1c', '#e0e0e0', '#8ac926'],
  ['#3a2e39', '#f1e3d3', '#99c1b9'],
  ['#14213d', '#fca311', '#e5e5e5'],
];

export interface ArtworkOptions {
  title: string;
  subtitle?: string;
  width?: number;
  height?: number;
  palette?: readonly [string, string, string];
  motif?: 'rings' | 'grid' | 'stars' | 'waves';
}

/** Print-ready SVG with the thesis rendered as the central text. */
export function artworkSvg(opts: ArtworkOptions, rng: Rng): string {
  const width = opts.width ?? 4500;
  const height = opts.height ?? 5400;
  const [bg, fg, accent] = opts.palette ?? rng.pick(PALETTES);
  const motif = opts.motif ?? rng.pick(['rings', 'grid', 'stars', 'waves'] as const);
  const lines = wrapText(opts.title, 18);
  const fontSize = Math.round(Math.min(width / 10, (height * 0.4) / Math.max(1, lines.length)));
  const startY = height / 2 - ((lines.length - 1) * fontSize * 1.1) / 2;
  const textLines = lines
    .map((line, i) => `<text x="${width / 2}" y="${Math.round(startY + i * fontSize * 1.1)}" text-anchor="middle" font-family="Georgia, serif" font-weight="700" font-size="${fontSize}" fill="${fg}">${escapeXml(line)}</text>`)
    .join('\n    ');
  const subtitle = opts.subtitle
    ? `<text x="${width / 2}" y="${Math.round(height * 0.86)}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="${Math.round(fontSize * 0.35)}" letter-spacing="12" fill="${accent}">${escapeXml(opts.subtitle.toUpperCase())}</text>`
    : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="${bg}"/>
  <g opacity="0.35">
    ${motifSvg(motif, width, height, accent, rng)}
  </g>
  <g>
    ${textLines}
  </g>
  ${subtitle}
</svg>
`;
}

function motifSvg(motif: 'rings' | 'grid' | 'stars' | 'waves', w: number, h: number, colour: string, rng: Rng): string {
  switch (motif) {
    case 'rings': {
      const parts: string[] = [];
      for (let i = 1; i <= 6; i++) parts.push(`<circle cx="${w / 2}" cy="${h / 2}" r="${Math.round((w / 2.2) * (i / 6))}" fill="none" stroke="${colour}" stroke-width="${18 + i * 4}"/>`);
      return parts.join('\n    ');
    }
    case 'grid': {
      const parts: string[] = [];
      const step = Math.round(w / 12);
      for (let x = step; x < w; x += step) parts.push(`<line x1="${x}" y1="0" x2="${x}" y2="${h}" stroke="${colour}" stroke-width="10"/>`);
      for (let y = step; y < h; y += step) parts.push(`<line x1="0" y1="${y}" x2="${w}" y2="${y}" stroke="${colour}" stroke-width="10"/>`);
      return parts.join('\n    ');
    }
    case 'stars': {
      const parts: string[] = [];
      for (let i = 0; i < 40; i++) parts.push(`<circle cx="${rng.int(0, w)}" cy="${rng.int(0, h)}" r="${rng.int(8, 40)}" fill="${colour}"/>`);
      return parts.join('\n    ');
    }
    case 'waves': {
      const parts: string[] = [];
      for (let i = 0; i < 8; i++) {
        const y = Math.round((h / 9) * (i + 1));
        parts.push(`<path d="M0 ${y} Q ${w / 4} ${y - 200} ${w / 2} ${y} T ${w} ${y}" fill="none" stroke="${colour}" stroke-width="24"/>`);
      }
      return parts.join('\n    ');
    }
  }
}

export function wrapText(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const next = current.length === 0 ? word : `${current} ${word}`;
    if (next.length > maxChars && current.length > 0) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current.length > 0) lines.push(current);
  return lines.length > 0 ? lines : [text];
}

/** Product mockup: a simple garment/mug silhouette with the design title placed on it. */
export function mockupSvg(productType: string, title: string, palette: readonly [string, string, string]): string {
  const [bg, fg, accent] = palette;
  const shape =
    productType === 'mug'
      ? `<rect x="260" y="300" width="420" height="440" rx="40" fill="${fg}"/><path d="M680 380 q140 0 140 120 q0 120 -140 120" fill="none" stroke="${fg}" stroke-width="60"/>`
      : productType === 'tote'
        ? `<rect x="240" y="320" width="520" height="520" fill="${fg}"/><path d="M340 320 q160 -220 320 0" fill="none" stroke="${fg}" stroke-width="30"/>`
        : `<path d="M300 260 l120 -80 h160 l120 80 l100 160 l-120 60 v420 h-360 v-420 l-120 -60 z" fill="${fg}"/>`;
  const lines = wrapText(title, 14);
  const text = lines
    .map((line, i) => `<text x="500" y="${540 + i * 46}" text-anchor="middle" font-family="Georgia, serif" font-weight="700" font-size="40" fill="${bg}">${escapeXml(line)}</text>`)
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000" viewBox="0 0 1000 1000">
  <rect width="1000" height="1000" fill="${accent}" opacity="0.15"/>
  ${shape}
  ${text}
  <text x="500" y="940" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="28" fill="#333">${escapeXml(titleCase(productType))} mockup</text>
</svg>
`;
}

/** Sprite sheet: a grid of coloured tiles with subtle variation, plus a header. */
export function spriteSheetSvg(title: string, tileSize: number, columns: number, rows: number, rng: Rng): string {
  const palette = rng.pick(PALETTES);
  const cells: string[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      const shade = rng.int(0, 2);
      const colour = palette[shade]!;
      const x = c * tileSize;
      const y = r * tileSize;
      cells.push(`<rect x="${x}" y="${y}" width="${tileSize}" height="${tileSize}" fill="${colour}"/>`);
      if (rng.chance(0.5)) cells.push(`<rect x="${x + 2}" y="${y + 2}" width="${tileSize - 4}" height="${tileSize / 2}" fill="${palette[(shade + 1) % 3]}" opacity="0.6"/>`);
    }
  }
  const w = columns * tileSize;
  const h = rows * tileSize;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges">
  <title>${escapeXml(title)}</title>
  ${cells.join('\n  ')}
</svg>
`;
}

export function thumbnailSvg(headline: string, subline: string, palette: readonly [string, string, string]): string {
  const [bg, fg, accent] = palette;
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${bg}"/><stop offset="1" stop-color="${accent}"/></linearGradient></defs>
  <rect width="1280" height="720" fill="url(#g)"/>
  <circle cx="1040" cy="360" r="220" fill="${fg}" opacity="0.2"/>
  <text x="80" y="330" font-family="Impact, Helvetica, sans-serif" font-size="140" fill="${fg}" stroke="#000" stroke-width="8" paint-order="stroke">${escapeXml(headline.toUpperCase())}</text>
  <text x="80" y="450" font-family="Helvetica, Arial, sans-serif" font-size="56" fill="${accent}" stroke="#000" stroke-width="4" paint-order="stroke">${escapeXml(subline)}</text>
</svg>
`;
}

export interface ArticleProduct {
  name: string;
  priceCents: number;
  url: string;
  pros: string[];
  cons: string[];
}

export interface ArticleInput {
  title: string;
  niche: string;
  products: ArticleProduct[];
  audience: string;
  rng: Rng;
}

/** Roughly 600 words of buying-guide prose assembled from templates. */
export function articleMarkdown(input: ArticleInput): { markdown: string; wordCount: number } {
  const { title, niche, products, audience, rng } = input;
  const top = products[0]!;
  const intro = rng.pick(INTROS)(niche, audience, top.name);
  const method = rng.pick(METHODS)(niche);
  const sections = products.map((p, i) => productSection(p, i, niche, rng)).join('\n\n');
  const table = comparisonTable(products);
  const verdict = rng.pick(VERDICTS)(top.name, niche, products[1]?.name ?? top.name);
  const faq = FAQ(niche, rng);
  const markdown = `# ${title}

*Disclosure: this article contains affiliate links. If you buy through them we may earn a commission at no extra cost to you. It does not change which products we recommend.*

${intro}

## How we chose

${method}

## Quick comparison

${table}

${sections}

## Our pick

${verdict}

## Frequently asked questions

${faq}

## Final word

If you are still torn, buy the ${top.name}. It is the option we would hand to a friend who asked about ${niche} with no further questions, and it is the one that kept coming out ahead when we weighed price against what you actually get. Prices move, so check the current listing before you order.
`;
  return { markdown, wordCount: countWords(markdown) };
}

export function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => /[a-z0-9]/i.test(w)).length;
}

function productSection(p: ArticleProduct, index: number, niche: string, rng: Rng): string {
  const label = ['Best overall', 'Best value', 'Best premium pick', 'Best for beginners', 'Best compact option'][index] ?? `Pick ${index + 1}`;
  const opener = rng.pick(SECTION_OPENERS)(p.name, niche);
  return `## ${index + 1}. ${p.name}: ${label}

${opener} At around $${(p.priceCents / 100).toFixed(0)} it sits ${index === 0 ? 'in the middle of the range, which is where most buyers should look' : index === 1 ? 'at the affordable end without feeling cheap' : 'above the entry level, and you can feel where the extra money went'}.

**What we liked**

${p.pros.map((line) => `- ${line}`).join('\n')}

**What we did not**

${p.cons.map((line) => `- ${line}`).join('\n')}

[Check the current price of the ${p.name}](${p.url})`;
}

function comparisonTable(products: ArticleProduct[]): string {
  const rows = products.map((p) => `| ${p.name} | $${(p.priceCents / 100).toFixed(0)} | ${p.pros[0] ?? ''} | ${p.cons[0] ?? ''} |`);
  return ['| Product | Price | Strength | Weakness |', '|---|---|---|---|', ...rows].join('\n');
}

const INTROS: Array<(niche: string, audience: string, top: string) => string> = [
  (niche, audience, top) =>
    `Shopping for ${niche} is harder than it should be. The category is crowded, the spec sheets all look the same, and the reviews on the product pages tell you very little about how something holds up after a month. We spent time with the options that ${audience} keep asking about, compared them side by side, and narrowed the field down to the handful below. If you only read one line: the ${top} is the one to buy for most people, and the rest of this guide explains why, along with when you should pick something else.`,
  (niche, audience, top) =>
    `If you have been searching for ${niche} you have probably noticed that every list online recommends the same six products in a slightly different order. We wanted to do better than that, so we started from what ${audience} actually need, set a realistic budget, and looked for the products that deliver on the fundamentals without charging for features nobody uses. Our top pick is the ${top}. Below you will find how it compares, where it falls short, and two alternatives that make more sense for specific situations.`,
];

const METHODS: Array<(niche: string) => string> = [
  (niche) =>
    `We shortlisted products in the ${niche} category by reading owner reviews from the last twelve months, discarding anything with a pattern of reliability complaints, and comparing what remains on the things that matter day to day: build quality, ease of use, running cost and how easy it is to get support if something goes wrong. We favour products that have been on the market long enough to have a track record over brand-new launches with no history. Every price below is the typical street price at the time of writing.`,
  (niche) =>
    `Our approach to ${niche} is simple. First, we set a sensible price ceiling so the comparison stays relevant to normal budgets. Second, we score each product on the three or four things buyers in this category consistently say they care about, not on the longest feature list. Third, we look at the long tail of reviews for problems that only show up after weeks of use. Products that clear all three stages make the list; the ranking reflects value for money rather than raw performance.`,
];

const SECTION_OPENERS: Array<(name: string, niche: string) => string> = [
  (name, niche) => `The ${name} is the product we kept coming back to while researching ${niche}. It does the basics quietly well and nothing about it gets in the way.`,
  (name, niche) => `Among the ${niche} we compared, the ${name} stands out for how little it asks of you. Setup is quick and the defaults are sensible.`,
  (name) => `The ${name} earns its place on this list by being predictable in the best sense: it behaves the same on day ninety as it did on day one.`,
];

const VERDICTS: Array<(top: string, niche: string, runnerUp: string) => string> = [
  (top, niche, runnerUp) =>
    `For most people looking at ${niche}, the ${top} is the right call. It balances price, build and everyday usability better than anything else we looked at, and its weaknesses are the kind you can live with. If your budget is tighter, the ${runnerUp} gives up a little polish but keeps the essentials intact, and we would not talk anyone out of it.`,
  (top, niche, runnerUp) =>
    `Our recommendation for ${niche} is the ${top}. It is not the cheapest and not the most feature-packed, but it is the one with the fewest compromises, which is what you want from something you will use every week. The ${runnerUp} is the sensible alternative when price matters more than finish.`,
];

function FAQ(niche: string, rng: Rng): string {
  const questions = shuffle(
    [
      `**How much should I spend on ${niche}?** Enough to avoid the very cheapest tier, where reliability complaints cluster, but rarely more than the mid-range. The premium options add convenience, not capability.`,
      `**Do I need the newest model?** Usually not. In this category year-over-year changes are small, and last year's version is often discounted while it is still supported.`,
      `**What is the most common mistake buyers make?** Choosing on a single headline spec. Look at the whole experience: setup, maintenance, noise, consumables and warranty.`,
      `**How long should ${niche} last?** With normal care, several years. Check that replacement parts are available before you buy.`,
    ],
    rng,
  );
  return questions.slice(0, 3).join('\n\n');
}

export const PRODUCT_ADJECTIVES = ['Compact', 'Classic', 'Pro', 'Essential', 'Studio', 'Prime', 'Core', 'Lite'] as const;
export const PRODUCT_BRANDS = ['Northline', 'Halden', 'Verra', 'Oakstead', 'Marlow', 'Kessler', 'Brightwater', 'Solano'] as const;
