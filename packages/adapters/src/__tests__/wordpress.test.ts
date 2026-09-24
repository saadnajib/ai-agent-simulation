import { describe, expect, it } from 'vitest';
import { WordPressAdapter, articleHtml } from '../wordpress.js';
import { fakeFetch, markdown, png, sampleListing } from './helpers.js';

const env = { WORDPRESS_URL: 'https://blog.example.com/', WORDPRESS_USER: 'editor', WORDPRESS_APP_PASSWORD: 'abcd efgh ijkl' };
const expectedAuth = `Basic ${Buffer.from('editor:abcd efgh ijkl').toString('base64')}`;

function happyPath() {
  return fakeFetch((call) => {
    if (call.url.endsWith('/wp/v2/media')) return { status: 201, json: { id: 44 } };
    if (call.url.endsWith('/wp/v2/tags')) {
      const name = (call.body as { name: string }).name;
      return name === 'botanical' ? { status: 400, json: { code: 'term_exists', data: { term_id: 7 } } } : { status: 201, json: { id: 8 } };
    }
    if (call.url.endsWith('/wp/v2/posts')) return { status: 201, json: { id: 101, link: 'https://blog.example.com/best-cat-trees/' } };
    return { status: 404, text: 'unexpected ' + call.url };
  });
}

describe('WordPressAdapter.createListing', () => {
  it('uploads the featured image, resolves tags and publishes the post with basic auth', async () => {
    const ff = happyPath();
    const listing = sampleListing({ platform: 'wordpress', title: 'Best Cat Trees', tags: ['cat shirt', 'botanical'] });
    const res = await new WordPressAdapter({ env, fetchImpl: ff.fetch }).createListing(listing, [png(), markdown()]);

    expect(res).toEqual({ ok: true, externalId: '101', url: 'https://blog.example.com/best-cat-trees/' });
    expect(ff.calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'POST https://blog.example.com/wp-json/wp/v2/media',
      'POST https://blog.example.com/wp-json/wp/v2/tags',
      'POST https://blog.example.com/wp-json/wp/v2/tags',
      'POST https://blog.example.com/wp-json/wp/v2/posts',
    ]);
    for (const call of ff.calls) expect(call.headers.authorization).toBe(expectedAuth);

    expect(ff.calls[0]!.headers['content-type']).toBe('image/png');
    expect(ff.calls[0]!.headers['content-disposition']).toBe('attachment; filename="cat-front.png"');

    const post = ff.calls[3]!;
    expect(post.headers['content-type']).toBe('application/json');
    expect(post.body).toMatchObject({ title: 'Best Cat Trees', status: 'publish', slug: 'best-cat-trees', tags: [8, 7], featured_media: 44 });
    expect((post.body as { content: string }).content).toContain('<h1>Best cat trees</h1>');
    expect((post.body as { content: string }).content).toContain('<a href="https://amzn.to/x" rel="nofollow sponsored">Tower</a>');
    expect((post.body as { content: string }).content).toContain('<ul><li>tall</li><li>sturdy</li></ul>');
  });

  it('returns ok:false with error text on non-2xx and never throws', async () => {
    const ff = fakeFetch(() => ({ status: 401, json: { code: 'rest_cannot_create', message: 'Sorry, you are not allowed to create posts as this user.' } }));
    const res = await new WordPressAdapter({ env, fetchImpl: ff.fetch }).createListing(sampleListing(), [markdown()]);
    expect(res.ok).toBe(false);
    expect(res.error).toContain('HTTP 401');
    expect(res.error).toContain('not allowed');
    expect(res.error).not.toContain('abcd efgh');
  });

  it('keeps publishing when tag or media calls fail', async () => {
    const ff = fakeFetch((call) => (call.url.endsWith('/posts') ? { json: { id: 5, link: 'https://blog.example.com/p/' } } : { status: 500, text: 'nope' }));
    const res = await new WordPressAdapter({ env, fetchImpl: ff.fetch }).createListing(sampleListing(), [png(), markdown()]);
    expect(res.ok).toBe(true);
    expect(ff.calls.at(-1)!.body).toMatchObject({ tags: [] });
    expect(ff.calls.at(-1)!.body).not.toHaveProperty('featured_media');
  });

  it('uses the description as the article when no text asset is attached, and fails on an empty body', async () => {
    expect(articleHtml(sampleListing({ description: 'Hello **world**' }), [])).toBe('<p>Hello <strong>world</strong></p>');
    const res = await new WordPressAdapter({ env, fetchImpl: fakeFetch([]).fetch }).createListing(sampleListing({ description: '  ' }), []);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/no article body/);
  });
});

describe('WordPressAdapter other operations', () => {
  it('updates and unpublishes via POST /posts/{id}', async () => {
    const ff = fakeFetch(() => ({ json: { id: 101, link: 'https://blog.example.com/x/' } }));
    const adapter = new WordPressAdapter({ env, fetchImpl: ff.fetch });
    const listing = sampleListing({ externalId: '101' });
    expect(await adapter.updateListing(listing, { title: 'New title' })).toEqual({ ok: true, externalId: '101', url: 'https://blog.example.com/x/' });
    expect(ff.calls[0]).toMatchObject({ method: 'POST', url: 'https://blog.example.com/wp-json/wp/v2/posts/101', body: { title: 'New title' } });
    expect(await adapter.delist(listing)).toEqual({ ok: true, externalId: '101' });
    expect(ff.calls[1]!.body).toEqual({ status: 'draft' });
  });

  it('has no sales and reports capability from env', async () => {
    const adapter = new WordPressAdapter({ env, fetchImpl: fakeFetch([]).fetch });
    expect(await adapter.readSales('2026-01-01T00:00:00Z')).toEqual([]);
    expect(adapter.capability()).toMatchObject({ connected: true, hasApi: true, can: { createListing: true, updateListing: true, readSales: false } });
    expect(new WordPressAdapter({ env: { WORDPRESS_URL: 'https://x' }, fetchImpl: fakeFetch([]).fetch }).capability().connected).toBe(false);
  });
});
