/**
 * ScriptedBrain: deterministic, offline, instant in wall time. Each task kind
 * takes 1..3 simulated ticks (scheduled through ctx.waitTicks), writes real
 * files into the venture workspace and returns a TaskOutput whose `data`
 * matches the shapes in docs/architecture/CONTRACTS.md.
 */
import type { Listing, Platform, Rng, Task, TaskKind, TaskOutput, VentureKind } from '@eternity/core';
import { KIND_ECONOMICS, PLAYBOOKS } from '@eternity/core';
import {
  PALETTES,
  PRODUCT_ADJECTIVES,
  PRODUCT_BRANDS,
  articleMarkdown,
  artworkSvg,
  keywordsFor,
  mockupSvg,
  shuffle,
  slugify,
  spriteSheetSvg,
  thumbnailSvg,
  titleCase,
} from './content.js';
import { depOutput, inputNumber, inputString, parseTaskOutput, type Brain, type BrainContext } from './types.js';

/** Simulated ticks of work per task kind (all within 1..3). */
export const SCRIPTED_DURATION: Record<TaskKind, [min: number, max: number]> = {
  'research-niche': [1, 2],
  'analyse-competitors': [1, 2],
  'design-artwork': [2, 3],
  'create-mockups': [1, 1],
  'create-asset-pack': [2, 3],
  'design-thumbnail': [1, 2],
  'write-article': [2, 3],
  'build-template': [2, 3],
  'compose-track': [2, 3],
  'write-listing': [1, 1],
  'publish-listing': [1, 1],
  'fulfil-order': [1, 2],
  'optimise-listing': [1, 1],
  promote: [1, 2],
  'review-output': [1, 1],
  'overseer-epoch': [1, 1],
};

/** Centre of the reviewer's quality distribution per venture kind (0.45..0.85). */
export const REVIEW_QUALITY_CENTRE: Record<VentureKind, number> = {
  'pod-store': 0.62,
  'game-assets': 0.72,
  'thumbnail-service': 0.58,
  'affiliate-blog': 0.66,
  'software-templates': 0.7,
  'music-packs': 0.6,
};

const REVIEW_SD = 0.09;
const REVIEW_MIN = 0.3;
const REVIEW_MAX = 0.95;
const REVIEW_APPROVE_AT = 0.4;

export function sampleReviewQuality(kind: VentureKind, rng: Rng): number {
  const raw = rng.normal(REVIEW_QUALITY_CENTRE[kind], REVIEW_SD);
  return Math.round(Math.min(REVIEW_MAX, Math.max(REVIEW_MIN, raw)) * 100) / 100;
}

type Generator = (task: Task, ctx: BrainContext) => TaskOutput;

export class ScriptedBrain implements Brain {
  readonly name = 'scripted';

  async run(task: Task, ctx: BrainContext): Promise<TaskOutput> {
    const [min, max] = SCRIPTED_DURATION[task.kind];
    const generator = GENERATORS[task.kind];
    ctx.speak(startLine(task, ctx));
    await ctx.waitTicks(ctx.rng.int(min, max));
    const output = parseTaskOutput(generator(task, ctx));
    ctx.speak(finishLine(task, ctx));
    return output;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function thesisOf(task: Task, ctx: BrainContext): string {
  return inputString(task, 'thesis', ctx.venture.thesis);
}

function nicheOf(task: Task, ctx: BrainContext): string {
  const research = depOutput(ctx, task, 'researchRef');
  const niche = research?.data['niche'];
  return typeof niche === 'string' && niche.length > 0 ? niche : thesisOf(task, ctx);
}

function firstWord(text: string): string {
  return text.split(/\s+/).find((w) => w.length > 3) ?? text;
}

function batchLabel(task: Task): string {
  const index = inputNumber(task, 'batchIndex', 0) + 1;
  return `variant ${index}`;
}

function startLine(task: Task, ctx: BrainContext): string {
  const thesis = thesisOf(task, ctx);
  const word = firstWord(thesis);
  const lines: Record<TaskKind, string> = {
    'research-niche': `Scanning demand for ${word}.`,
    'analyse-competitors': `Pulling the top ranking pages for ${word}.`,
    'design-artwork': `Rendering ${batchLabel(task)} of the ${word} design.`,
    'create-mockups': `Dropping the design onto product templates.`,
    'create-asset-pack': `Laying out the ${word} sprite sheet.`,
    'design-thumbnail': `Blocking in three ${word} thumbnails.`,
    'write-article': `Drafting the ${word} buying guide.`,
    'build-template': `Scaffolding the ${word} starter kit.`,
    'compose-track': `Sketching loops for ${word}.`,
    'write-listing': `Writing copy and tags.`,
    'publish-listing': `Packing the listing for the Airlock.`,
    'fulfil-order': `Delivering the order.`,
    'optimise-listing': `Refreshing tags and title.`,
    promote: `Scheduling posts for ${word}.`,
    'review-output': `Reviewing against the checklist.`,
    'overseer-epoch': `Reallocating capital.`,
  };
  return lines[task.kind];
}

function finishLine(task: Task, ctx: BrainContext): string {
  const word = firstWord(thesisOf(task, ctx));
  const lines: Record<TaskKind, string> = {
    'research-niche': `Demand notes filed for ${word}.`,
    'analyse-competitors': `Found the gap. Nobody covers the budget end.`,
    'design-artwork': `${titleCase(batchLabel(task))} exported at 300 DPI.`,
    'create-mockups': `Mockups ready on two colourways.`,
    'create-asset-pack': `Sheet exported. Tiles connect on every edge.`,
    'design-thumbnail': `Thumbnails read fine at 168 pixels.`,
    'write-article': `Draft done. Disclosure sits above the first link.`,
    'build-template': `Fresh clone installs clean.`,
    'compose-track': `Loops are seamless at the stated BPM.`,
    'write-listing': `Tags locked in.`,
    'publish-listing': `Handed to the Airlock.`,
    'fulfil-order': `Order delivered.`,
    'optimise-listing': `Listing refreshed.`,
    promote: `Posts queued.`,
    'review-output': `Score is in.`,
    'overseer-epoch': `Directive issued.`,
  };
  return lines[task.kind];
}

function priceFor(kind: VentureKind, rng: Rng): number {
  const typical = KIND_ECONOMICS[kind].typicalPriceCents;
  const jitter = rng.int(-Math.round(typical * 0.15), Math.round(typical * 0.15));
  return Math.max(99, Math.round((typical + jitter) / 100) * 100 - 1);
}

function fileBase(task: Task, ctx: BrainContext, prefix: string): string {
  const index = inputNumber(task, 'batchIndex', 0) + 1;
  return `${prefix}/${slugify(thesisOf(task, ctx))}-${index}`;
}

// ---------------------------------------------------------------------------
// Generators per task kind
// ---------------------------------------------------------------------------

const researchNiche: Generator = (task, ctx) => {
  const thesis = thesisOf(task, ctx);
  const kind = ctx.venture.kind;
  const demandScore = Math.round((0.35 + ctx.rng.next() * 0.5) * 100) / 100;
  const competition = Math.round((0.3 + ctx.rng.next() * 0.6) * 100) / 100;
  const keywords = keywordsFor(thesis, kind, ctx.rng);
  const suggestedPriceCents = priceFor(kind, ctx.rng);
  const platforms = Array.isArray(task.input['platforms']) ? (task.input['platforms'] as string[]) : PLAYBOOKS[kind].platforms;
  const rationale = `Search interest for "${thesis}" is ${demandScore >= 0.6 ? 'steady' : 'thin but present'}; competition is ${competition >= 0.6 ? 'dense, so differentiate on style' : 'moderate'}. Price near $${(suggestedPriceCents / 100).toFixed(2)} keeps margin after ${platforms.join('/')} fees.`;
  const data = { niche: thesis, demandScore, competition, keywords, suggestedPriceCents, rationale, platforms };
  const file = ctx.workspace.write(`research/${slugify(thesis)}.json`, JSON.stringify(data, null, 2));
  return { summary: `Niche "${thesis}": demand ${demandScore}, competition ${competition}.`, files: [file], data };
};

const analyseCompetitors: Generator = (task, ctx) => {
  const niche = nicheOf(task, ctx);
  const names = shuffle(PRODUCT_BRANDS, ctx.rng).slice(0, 3);
  const competitors = names.map((name) => ({
    name: `${name} ${niche.split(' ')[0] ?? ''} guide`.trim(),
    priceCents: priceFor(ctx.venture.kind, ctx.rng),
    strengths: shuffle(['strong domain authority', 'frequent updates', 'clear comparison table', 'video embeds', 'first-hand photos'], ctx.rng).slice(0, 2),
  }));
  const gap = `None of the ranking pages for "${niche}" answers the budget question in the first screen; lead with a price-tiered answer.`;
  const data = { niche, competitors, gap };
  const file = ctx.workspace.write(`research/${slugify(niche)}-competitors.json`, JSON.stringify(data, null, 2));
  return { summary: `Analysed ${competitors.length} competitors for "${niche}".`, files: [file], data };
};

const designArtwork: Generator = (task, ctx) => {
  const thesis = thesisOf(task, ctx);
  const niche = nicheOf(task, ctx);
  const index = inputNumber(task, 'batchIndex', 0) + 1;
  const palette = ctx.rng.pick(PALETTES);
  const title = `${titleCase(thesis)} ${['I', 'II', 'III', 'IV', 'V', 'VI'][index - 1] ?? index}`;
  const svg = artworkSvg({ title: thesis, subtitle: ctx.venture.name, palette }, ctx.rng);
  const file = ctx.workspace.write(`${fileBase(task, ctx, 'designs')}.svg`, svg);
  const specs = { width: 4500, height: 5400, dpi: 300, background: 'transparent-ready', palette: [...palette], format: 'svg' };
  const data = { title, description: `Original ${niche} artwork, ${batchLabel(task)}. Hand-lettered look with a ${['rings', 'grid', 'stars', 'waves'][index % 4]} motif.`, niche, files: [file], specs };
  return { summary: `Designed "${title}".`, files: [file], data };
};

const createMockups: Generator = (task, ctx) => {
  const artwork = depOutput(ctx, task, 'artworkRef');
  const title = typeof artwork?.data['title'] === 'string' ? (artwork.data['title'] as string) : titleCase(thesisOf(task, ctx));
  const providerInput = inputString(task, 'provider', 'mock');
  const provider = providerInput === 'printify' || providerInput === 'printful' ? providerInput : 'mock';
  const productType = ctx.rng.pick(['tee', 'hoodie', 'mug', 'tote'] as const);
  const palettes = shuffle(PALETTES, ctx.rng).slice(0, 2);
  const base = fileBase(task, ctx, 'mockups');
  const files = palettes.map((palette, i) => ctx.workspace.write(`${base}-${productType}-${i + 1}.svg`, mockupSvg(productType, title, palette)));
  const upstream = Array.isArray(artwork?.files) ? artwork.files : [];
  const data = { productType, files: [...upstream, ...files], provider, title };
  return { summary: `${files.length} ${productType} mockups for "${title}".`, files, data };
};

const createAssetPack: Generator = (task, ctx) => {
  const thesis = thesisOf(task, ctx);
  const niche = nicheOf(task, ctx);
  const tileSize = /32x32/.test(thesis) ? 32 : 16;
  const columns = 8;
  const rows = 6;
  const base = fileBase(task, ctx, 'packs');
  const sheet = ctx.workspace.write(`${base}-sheet.svg`, spriteSheetSvg(thesis, tileSize, columns, rows, ctx.rng));
  const manifest = { name: thesis, tileSize, columns, rows, tiles: columns * rows, licence: 'commercial-use-no-resale', formats: ['svg', 'png'] };
  const manifestFile = ctx.workspace.write(`${base}-manifest.json`, JSON.stringify(manifest, null, 2));
  const readme = ctx.workspace.write(`${base}-README.md`, `# ${titleCase(thesis)}\n\n${columns * rows} tiles at ${tileSize}x${tileSize}. Tiles connect on all edges. Licence: use in commercial games, no resale of raw assets.\n`);
  const files = [sheet, manifestFile, readme];
  const data = { title: titleCase(thesis), description: `${columns * rows}-tile ${niche} pack at ${tileSize}px with autotile transitions and a README.`, niche, files, specs: manifest };
  return { summary: `Asset pack "${thesis}" with ${columns * rows} tiles.`, files, data };
};

const designThumbnail: Generator = (task, ctx) => {
  const thesis = thesisOf(task, ctx);
  const niche = nicheOf(task, ctx);
  const samples = Math.min(4, Math.max(1, inputNumber(task, 'samples', 3)));
  const headlines = ['I Tried It', 'Do Not Buy', 'Finally', 'The Truth', 'Worth It?'];
  const files: string[] = [];
  const base = fileBase(task, ctx, 'thumbnails');
  for (let i = 0; i < samples; i++) {
    const palette = ctx.rng.pick(PALETTES);
    files.push(ctx.workspace.write(`${base}-${i + 1}.svg`, thumbnailSvg(ctx.rng.pick(headlines), titleCase(firstWord(thesis)), palette)));
  }
  const data = { title: `${titleCase(thesis)} portfolio`, description: `${samples} sample thumbnails at 1280x720 with four-word headlines and high-contrast text.`, niche, files, specs: { size: '1280x720', samples, maxWords: 4 } };
  return { summary: `${samples} thumbnail samples for ${niche}.`, files, data };
};

const writeArticle: Generator = (task, ctx) => {
  const thesis = thesisOf(task, ctx);
  const niche = nicheOf(task, ctx);
  const index = inputNumber(task, 'batchIndex', 0);
  const program = inputString(task, 'affiliateProgram', 'amazon-associates');
  const products = shuffle(PRODUCT_BRANDS, ctx.rng).slice(0, 3).map((brand, i) => {
    const adjective = ctx.rng.pick(PRODUCT_ADJECTIVES);
    const name = `${brand} ${adjective}`;
    return {
      name,
      priceCents: priceFor('software-templates', ctx.rng) * (i + 1) * 3,
      url: `https://www.amazon.com/dp/EXAMPLE${slugify(name).toUpperCase().replace(/-/g, '').slice(0, 6)}?tag=eternity-20`,
      pros: shuffle(['solid build for the price', 'quiet in normal use', 'simple setup', 'good documentation', 'wide parts availability'], ctx.rng).slice(0, 3),
      cons: shuffle(['bulky footprint', 'plastic fittings', 'short power cord', 'no carry case'], ctx.rng).slice(0, 2),
    };
  });
  const angle = index === 0 ? `Best ${titleCase(niche)}` : `${titleCase(niche)}: Which One Should You Buy?`;
  const { markdown, wordCount } = articleMarkdown({ title: angle, niche, products, audience: 'readers on a normal budget', rng: ctx.rng });
  const slug = slugify(angle);
  const file = ctx.workspace.write(`articles/${slug}.md`, markdown);
  const affiliateLinks = products.map((p) => ({ product: p.name, url: p.url }));
  const data = { title: angle, slug, wordCount, affiliateLinks, files: [file], niche, affiliateProgram: program };
  return { summary: `Wrote "${angle}" (${wordCount} words).`, files: [file], data };
};

const buildTemplate: Generator = (task, ctx) => {
  const thesis = thesisOf(task, ctx);
  const niche = nicheOf(task, ctx);
  const slug = slugify(thesis);
  const licence = inputString(task, 'licence', 'MIT');
  const pkg = { name: slug, version: '0.1.0', private: false, license: licence, scripts: { dev: 'vite', build: 'tsc && vite build', test: 'vitest run' } };
  const files = [
    ctx.workspace.write(`templates/${slug}/package.json`, JSON.stringify(pkg, null, 2)),
    ctx.workspace.write(`templates/${slug}/README.md`, `# ${titleCase(thesis)}\n\n## Setup\n\n1. Clone.\n2. \`pnpm install\`.\n3. \`pnpm dev\`.\n\n## Configuration\n\nCopy \`.env.example\` to \`.env\`.\n\n## Deployment\n\nAny static host or Node runtime.\n\n## Licence\n\n${licence}.\n`),
    ctx.workspace.write(`templates/${slug}/src/index.ts`, `export function hello(name: string): string {\n  return \`Hello from ${titleCase(thesis)}, \${name}\`;\n}\n`),
    ctx.workspace.write(`templates/${slug}/spec.json`, JSON.stringify({ stack: ['typescript', 'vite', 'vitest'], ci: task.input['includeCi'] === true, licence, screens: ['landing', 'dashboard', 'settings'] }, null, 2)),
  ];
  const data = { title: titleCase(thesis), description: `${niche} starter with typed config, tests and CI. Installs in under five minutes.`, niche, files, specs: { licence, stack: ['typescript', 'vite', 'vitest'] } };
  return { summary: `Built template "${thesis}".`, files, data };
};

const composeTrack: Generator = (task, ctx) => {
  const thesis = thesisOf(task, ctx);
  const niche = nicheOf(task, ctx);
  const trackCount = Math.max(4, Math.min(12, inputNumber(task, 'minimumTracks', 10)));
  const bpmMatch = /(\d{2,3})\s*bpm/i.exec(thesis);
  const bpm = bpmMatch ? Number(bpmMatch[1]) : ctx.rng.int(70, 140);
  const keys = ['C minor', 'D dorian', 'F major', 'A minor', 'G mixolydian', 'E phrygian'];
  const tracks = Array.from({ length: trackCount }, (_, i) => ({ index: i + 1, title: `${titleCase(firstWord(thesis))} ${i + 1}`, bpm, key: ctx.rng.pick(keys), bars: ctx.rng.pick([8, 16, 32]), lengthSeconds: Math.round((ctx.rng.pick([8, 16, 32]) * 4 * 60) / bpm) }));
  const base = fileBase(task, ctx, 'music');
  const files = [
    ctx.workspace.write(`${base}-score.json`, JSON.stringify({ pack: thesis, bpm, format: inputString(task, 'format', 'wav-24bit'), tracks }, null, 2)),
    ctx.workspace.write(`${base}-tracklist.md`, `# ${titleCase(thesis)}\n\n${tracks.map((t) => `${t.index}. ${t.title} (${t.key}, ${t.bars} bars, ${t.lengthSeconds}s)`).join('\n')}\n`),
  ];
  const data = { title: titleCase(thesis), description: `${trackCount} seamless loops at ${bpm} BPM, 24-bit WAV plus MP3 previews.`, niche, files, specs: { bpm, tracks: trackCount, format: 'wav-24bit' } };
  return { summary: `Composed ${trackCount} loops for "${thesis}".`, files, data };
};

const writeListing: Generator = (task, ctx) => {
  const kind = ctx.venture.kind;
  const product = depOutput(ctx, task, 'productRef');
  const research = depOutput(ctx, task, 'researchRef');
  const niche = typeof research?.data['niche'] === 'string' ? (research.data['niche'] as string) : thesisOf(task, ctx);
  const productTitle = typeof product?.data['title'] === 'string' ? (product.data['title'] as string) : titleCase(niche);
  const platformInput = inputString(task, 'platform', PLAYBOOKS[kind].platforms[0] ?? 'mock');
  const platform = platformInput as Platform;
  const keywords = Array.isArray(research?.data['keywords']) ? (research.data['keywords'] as string[]) : keywordsFor(niche, kind, ctx.rng);
  const suggested = typeof research?.data['suggestedPriceCents'] === 'number' ? (research.data['suggestedPriceCents'] as number) : priceFor(kind, ctx.rng);
  const storefront = ctx.venture.storefronts[0];
  const description = [
    `${productTitle}. ${typeof product?.data['description'] === 'string' ? product.data['description'] : `Made for people who love ${niche}.`}`,
    kind === 'pod-store' ? 'Printed to order on soft unisex cotton. AI-assisted original design, finished by hand.' : '',
    `Tags: ${keywords.slice(0, 5).join(', ')}.`,
  ]
    .filter((s) => s.length > 0)
    .join('\n\n');
  const listing: Omit<Listing, 'id' | 'status' | 'createdAtTick' | 'stats'> = {
    ventureId: ctx.venture.id,
    storefrontId: storefront?.id ?? '',
    platform,
    title: (productTitle.toLowerCase().includes(niche.toLowerCase()) ? productTitle : `${productTitle} | ${titleCase(niche)}`).slice(0, 140),
    description,
    tags: keywords.slice(0, 13),
    priceCents: suggested,
    unitCostCents: KIND_ECONOMICS[kind].unitCostCents,
    quality: 0.5,
    niche,
    kind,
    assets: Array.isArray(product?.files) ? product.files : [],
  };
  const file = ctx.workspace.write(`listings/${slugify(listing.title)}.json`, JSON.stringify(listing, null, 2));
  return { summary: `Listing copy for "${listing.title}" at $${(listing.priceCents / 100).toFixed(2)}.`, files: [file], data: { listing } };
};

const reviewOutput: Generator = (task, ctx) => {
  const quality = sampleReviewQuality(ctx.venture.kind, ctx.rng);
  const approved = quality >= REVIEW_APPROVE_AT;
  const criteria = Array.isArray(task.input['criteria']) ? (task.input['criteria'] as string[]) : PLAYBOOKS[ctx.venture.kind].reviewCriteria;
  const flagged = shuffle(criteria, ctx.rng).slice(0, quality < 0.6 ? 2 : 1);
  const notes = [
    `Quality ${quality.toFixed(2)}: ${quality >= 0.75 ? 'strong' : quality >= 0.55 ? 'solid with minor fixes' : 'weak'}.`,
    ...flagged.map((c) => `${quality >= 0.6 ? 'Watch' : 'Fix'}: ${c}`),
    approved ? 'Cleared for the Airlock.' : 'Blocked: rework before publishing.',
  ];
  const targetTaskId = inputString(task, 'targetRef', task.dependsOn[0] ?? '');
  const data = { quality, approved, notes, targetTaskId };
  const file = ctx.workspace.write(`reviews/${task.id}.json`, JSON.stringify(data, null, 2));
  return { summary: notes[0] ?? 'Reviewed.', files: [file], data, quality };
};

const publishListing: Generator = (task, ctx) => {
  const listingDep = depOutput(ctx, task, 'listingRef') ?? depOutput(ctx, task, 'articleRef');
  const listingId = typeof listingDep?.data['listingId'] === 'string' ? (listingDep.data['listingId'] as string) : inputString(task, 'listingId', '');
  const data: Record<string, unknown> = { listingId, platform: inputString(task, 'platform', 'mock') };
  return { summary: `Prepared ${listingId || 'the listing'} for publication.`, files: [], data };
};

const optimiseListing: Generator = (task, ctx) => {
  const listingId = inputString(task, 'listingId', '');
  const thesis = thesisOf(task, ctx);
  const changes = { tags: keywordsFor(thesis, ctx.venture.kind, ctx.rng).slice(0, 13), title: `${titleCase(thesis)} | ${ctx.rng.pick(['Gift Idea', 'New Design', 'Limited Colourway'])}` };
  const file = ctx.workspace.write(`listings/optimise-${task.id}.json`, JSON.stringify({ listingId, changes }, null, 2));
  return { summary: `Refreshed tags and title for ${listingId || 'listing'}.`, files: [file], data: { listingId, changes } };
};

const promote: Generator = (task, ctx) => {
  const channelInput = inputString(task, 'channel', 'pinterest');
  const channel = channelInput as Platform;
  const thesis = thesisOf(task, ctx);
  const refs = Array.isArray(task.input['publishedRefs']) ? (task.input['publishedRefs'] as string[]) : [];
  const urls = refs.map((ref) => ctx.deps[ref]?.data['url']).filter((u): u is string => typeof u === 'string');
  const posts = [
    { text: `New in: ${titleCase(thesis)}. ${ctx.rng.pick(['Made for the quiet hours.', 'Small batch, big mood.', 'For people who notice details.'])}` },
    { text: `Behind the design: why we made ${firstWord(thesis)} the centrepiece.` },
    { text: `${titleCase(thesis)} is live. Link in bio.` },
  ].map((p, i) => (urls[i % Math.max(1, urls.length)] ? { ...p, url: urls[i % urls.length] as string } : p));
  const file = ctx.workspace.write(`promo/${channel}-${task.id}.md`, posts.map((p) => `- ${p.text}${'url' in p ? ` (${p.url})` : ''}`).join('\n') + '\n');
  return { summary: `${posts.length} posts scheduled on ${channel}.`, files: [file], data: { channel, posts } };
};

const fulfilOrder: Generator = (task, ctx) => {
  const orderId = inputString(task, 'orderId', `order_${task.id}`);
  const thesis = thesisOf(task, ctx);
  const file = ctx.workspace.write(`orders/${slugify(orderId)}/deliverable.svg`, thumbnailSvg(titleCase(firstWord(thesis)), 'Custom order', ctx.rng.pick(PALETTES)));
  return { summary: `Delivered ${orderId}.`, files: [file], data: { orderId, deliverables: [file] } };
};

const overseerEpoch: Generator = (task) => {
  const directiveId = inputString(task, 'directiveId', 'pending');
  return { summary: 'Epoch directive recorded.', files: [], data: { directiveId } };
};

const GENERATORS: Record<TaskKind, Generator> = {
  'research-niche': researchNiche,
  'analyse-competitors': analyseCompetitors,
  'design-artwork': designArtwork,
  'create-mockups': createMockups,
  'create-asset-pack': createAssetPack,
  'design-thumbnail': designThumbnail,
  'write-article': writeArticle,
  'build-template': buildTemplate,
  'compose-track': composeTrack,
  'write-listing': writeListing,
  'review-output': reviewOutput,
  'publish-listing': publishListing,
  'optimise-listing': optimiseListing,
  promote,
  'fulfil-order': fulfilOrder,
  'overseer-epoch': overseerEpoch,
};
