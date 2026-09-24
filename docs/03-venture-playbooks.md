# 03. Venture Playbooks

One section per venture kind. Each follows the same shape: what actually sells, what gets you banned, pricing, the pipeline as wired in `packages/core/src/playbooks.ts`, the review criteria the reviewer agent scores against, a first-30-days plan, and the kill criteria. Platform facts were checked on 2026-09-23; the detailed rules live in `04-platform-constraints.md`.

Read `01-economics-reality-check.md` first. Every plan below assumes you accept that a single listing is worth about a dollar a month and that distribution, not production, is the constraint.

## Shared rules for every kind

- No trademarked IP, ever. No characters, logos, team names, band names, celebrity likenesses, or "inspired by" phrasing. The reviewer blocks it; you block it again at the Airlock.
- Disclose AI where the platform asks (Etsy, itch.io, DistroKid, Unity) and where the FTC would consider it a material fact about a review (affiliate posts).
- One niche per venture. The market model penalises many listings in one niche (`saturationK`); HERMES spawns a new venture for a new niche rather than piling listings into an old one.
- Quality gate before publish. `review-output` produces a 0 to 1 score; demand scales with the square of it. A 0.5 listing gets a quarter of the traffic of a 1.0 listing. Publishing junk faster never wins.

Default kill rules (`DEFAULT_POLICY`), applied by HERMES after a 72-tick grace period (three simulated days):

| Rule | Threshold |
|---|---|
| Trailing ROI over the last 168 ticks | below -0.5 (spent twice what it earned back) |
| Ticks since last sale | more than 240 (ten simulated days), or never sold in 240 ticks |

In live mode a simulated day is whatever `TICK_HZ` makes it. The kind-specific kill criteria below are stated in real calendar time and are for you, at the weekly review.

---

## pod-store: print-on-demand on Etsy via Printify

Room: Print Foundry. Roles: scout, designer, writer, reviewer, marketer. Platforms: etsy, printify.

### What actually sells

Text-forward and simple-graphic designs for a specific identity or hobby, on a small range of products (Bella+Canvas 3001 tee, Gildan 18000 sweatshirt, 11oz mug, tote). Buyers search Etsy by identity plus occasion: "gift for beekeeper", "sourdough sweatshirt", "night shift nurse shirt". Niches in the playbook's list: vintage botanical cat tees, retro national-park style poster hoodies, dark academia library mugs, sourdough baking club sweatshirts, cottagecore mushroom foraging totes, minimalist constellation map tees, birdwatching life-list mugs, beekeeping apiary crest sweatshirts, sea kayaking tide-chart tees. Seasonal spikes (Mother's Day, teacher gifts, Christmas) are where new shops get their first sales; list six to eight weeks ahead.

### What gets you banned

- Trademarked or licensed content of any kind. Etsy's takedowns are automated and three strikes closes a shop. This includes fonts you do not have a commercial licence for.
- Undisclosed AI. Etsy's Creativity Standards require you to say what your role was (designer, producer, sourcer) and that AI tools were used. A human must have made a creative contribution; a shop of raw prompt output is removable.
- Multiple shops that hide from each other. Allowed, but each needs its own email, must list the other shops in its public profile, and must not duplicate listings. Do not let an agent open a shop; the seller of record is you.
- Offsite Ads surprises: shops over $10k in trailing 12 months are enrolled mandatorily at 12% of attributed sales. Price for it.

### Pricing

Base cost $8.50 to $13 for the tee, $4.69 to $8.25 for the mug, plus shipping you either charge or absorb. Etsy takes 6.5% plus ~3% + $0.25 plus $0.20 per listing. The code models a $24.99 tee with $16 all-in base cost and $2.83 in fees, leaving $6.16. Sweatshirts at $34.99 to $44.99 leave more per unit and sell fewer. Free shipping thresholds get a search boost in the US; bake shipping into the price.

### Pipeline

`research-niche -> 3 x (design-artwork -> create-mockups -> write-listing -> review-output -> publish-listing) -> promote`

17 tasks per cycle, three listings per cycle, estimated $0.54 in Sonnet 5 tokens plus image generation in live mode. Publish goes through the Airlock with the Printify payload; in draft-only mode you get copy-paste text and files for Shop Manager.

### Review criteria

1. Artwork is original: no trademarked characters, logos, team names or celebrity likenesses.
2. Design reads clearly at 4 inches on a printed garment; no text under 24pt equivalent.
3. Print file is 300 DPI, transparent background, sized to the product template.
4. Title and 13 tags use buyer search phrases, not the design description.
5. Mockups show the design on at least two product colours.
6. Listing discloses AI-assisted design where the platform requires it.

### First 30 days

| Days | Do |
|---|---|
| 1 to 3 | You: open the Etsy shop yourself, verify identity, connect Printify, publish one hand-made listing so the shop is not empty. Set the shop's About section honestly, including AI use. |
| 4 to 10 | Station: two cycles, six listings in one niche across tee, sweatshirt, mug. Approve only the ones you would buy. Reject the rest with a note; the note is the reviewer's training signal. |
| 11 to 20 | Station: `promote` produces Pinterest pins; you post them (or connect the API). Add a second niche only if the first has views in Etsy stats. |
| 21 to 30 | Order one sample of the best seller and photograph it; real photos beat mockups. Check Etsy search analytics for the queries that brought views and feed them back with `overseer.instruct`. |

Target at day 30: 15 to 25 live listings, 200 to 800 total views, 0 to 3 sales. That is normal.

### Kill criteria

HERMES: defaults above. You, at week 6: fewer than 300 listing views in the trailing 30 days across 20 or more live listings, or no sale by week 8 with 30 or more listings. Kill the niche, keep the shop, spawn a new thesis.

---

## game-assets: 2D packs on itch.io and Gumroad

Room: Pixel Forge. Roles: scout, pixel-artist, reviewer, marketer. Platforms: itch, gumroad.

### What actually sells

Complete, consistent tilesets and sprite packs that plug into a jam or a prototype in an hour: a 16x16 desert ruins tileset, a top-down sci-fi station interior, 1-bit dungeon tiles, an isometric medieval market prop set, a pixel weather and particle sheet, a retro UI and icon kit, a haunted mansion 32x32 set, tactical RPG grid terrain. Buyers are indie developers browsing itch.io's assets section and following jams. Packs with an assembled demo scene as the cover outsell bare sheets several times over. Free "lite" versions with a paid full pack are the standard funnel.

### What gets you banned

- itch.io requires AI-generated content to be tagged as such; untagged AI packs are delisted and repeat offenders lose the account.
- Ripped or traced assets from commercial games. The community reports them within hours.
- Unclear licences. State exactly what a buyer may do (use in commercial games) and may not (resell or redistribute the raw files).

### Pricing

$4.99 to $14.99 on itch; $9.99 is the modal price and what the code uses. itch.io's default 10% share is creator-adjustable; leave it at 10%. Gumroad direct sales cost 10% + $0.50, but 30% if the buyer comes through Discover, so link from itch to Gumroad only as a mirror. Bundle three related packs at 40% off once you have them.

### Pipeline

`research-niche -> create-asset-pack -> write-listing -> review-output -> publish-listing -> promote`

Six tasks, one pack per cycle, about $0.20 in tokens. In live mode the pixel-artist writes specs, palettes and a build script; the actual pixel art needs an image model or a human pass. The reviewer should fail anything that does not tile.

### Review criteria

1. Consistent tile size, palette and pixel density across the whole pack.
2. Tiles connect seamlessly on all edges; autotile sets include every needed transition.
3. Pack ships as PNG sprite sheets plus individual files with a README and licence.
4. Cover image shows an assembled scene, not a bare sheet.
5. At least 40 unique tiles or sprites per pack.
6. Licence permits commercial use in games and forbids resale of the raw assets.

### First 30 days

| Days | Do |
|---|---|
| 1 to 3 | You: itch.io account, payout setup, `butler login`. Create the project pages by hand (no API for that); the station pushes files with butler. |
| 4 to 14 | Two packs in one style family. One goes out free with a "full pack" link. Post both in the itch.io assets forum and one devlog. |
| 15 to 30 | Third pack. Enter the next game jam's asset thread. Mirror on Gumroad. Ask the first buyers what is missing; the answer is the fourth pack. |

Target at day 30: three packs, 300 to 1,500 page views, 2 to 10 sales including the free downloads' conversions.

### Kill criteria

HERMES: defaults. You: no paid sale by week 6 with three or more packs live and a free funnel in place, or download-to-purchase under 1%. Kill the style family, not the venture kind; game assets have the best sim margin of the six.

---

## thumbnail-service: paid YouTube thumbnails on Fiverr

Room: Thumbnail Bay. Roles: scout, thumbnail-artist, reviewer, marketer. Platform: fiverr.

### What actually sells

Genre-specific gigs with a portfolio that looks like the buyer's channel: finance explainers, woodworking tutorials, indie devlogs, true-crime clips, home cooking, language lessons, mechanical keyboard reviews, chess openings, 3D printing, board game reviews. Buyers are small channels (1k to 50k subs) who want a 24-hour turnaround and two revisions for $20 to $35. Ratings compound: the first ten five-star reviews are worth more than any portfolio.

### What gets you banned

- Account sharing and automation. Fiverr's terms forbid anyone but the account holder operating the account, explicitly including assistants. The station never touches Fiverr; it drafts, you paste. Detected automation means a permanent ban with the balance frozen.
- Misrepresenting AI. AI use is allowed; Fiverr judges the order by whether the client's expectations were clear and the delivery is tailored, not generic. Say "AI-assisted" in the gig if it is.
- Delivering copyrighted photos or brand logos in thumbnails.
- Communicating or paying off-platform.

### Pricing

$20 basic (one thumbnail, one revision), $45 standard (three), $90 premium (five plus source files). Fiverr keeps 20%. Tooling per order is about $1.50 in image generation. New sellers are limited to seven active gigs; pick genres, not more gigs.

### Pipeline

`research-niche -> design-thumbnail -> write-listing -> review-output -> publish-listing -> promote`

Six tasks per gig setup, about $0.18. Orders arrive as `fulfil-order` tasks you create when a buyer orders; the artist drafts, you review and deliver by hand. `customer` approvals carry the reply text for you to paste.

### Review criteria

1. Portfolio samples cover three distinct channel genres.
2. Focal subject and text are legible at 168x94 pixels.
3. No more than four words of text per thumbnail; high contrast against the background.
4. Faces and hands are anatomically correct; no artefacts.
5. Gig description states turnaround, revisions included and file formats delivered.
6. Samples contain no copyrighted photos or brand logos.

### First 30 days

| Days | Do |
|---|---|
| 1 to 2 | You: Fiverr seller profile in your own name, identity check, payout method. |
| 3 to 7 | Station drafts two gigs and nine portfolio pieces; you publish them. Set 24-hour delivery. |
| 8 to 30 | Answer every buyer request within an hour during your waking hours (response time is ranked). Deliver early. Ask for a review in the delivery message, once. |

Target at day 30: two gigs, 3 to 8 orders, first reviews. This is the only kind where you personally are in the loop for every dollar.

### Kill criteria

HERMES: defaults. You: fewer than two orders in the first 45 days, or a rating below 4.7 after five orders, or you find yourself unable to deliver within 24 hours. This kind converts your time into money at roughly $15 to $30 an hour; kill it the day that is not worth it to you.

---

## affiliate-blog: SEO articles with Amazon Associates links on WordPress

Room: Scriptorium. Roles: scout, writer, reviewer, marketer. Platforms: wordpress, amazon-associates.

### What actually sells

Narrow buying-intent comparisons where the searcher already has a wallet out: budget espresso machines under $300, ergonomic chairs for tall people, beginner telescopes, quiet mechanical keyboards for open offices, cold-weather running gear, compact sous vide setups, e-reader cases, standing desk converters under $200, air purifiers for small apartments, indoor herb garden kits. Ten deep articles on one topic cluster beat a hundred shallow ones; Google's March 2026 core update explicitly targeted scaled unreviewed AI pages and sites lost 50% to 80% of traffic.

### What gets you banned

- Amazon Associates closes accounts with no qualifying sales in the first 180 days. It also forbids cloaked links, links in emails or PDFs, and quoting prices that can go stale.
- Missing disclosure. The FTC Endorsement Guides require a clear disclosure before or near the affiliate link on every page. Maximum penalty per violation is $53,088 in 2026 and each page is a violation.
- Invented product claims. The reviewer criterion is that every spec is verifiable on the product page; hallucinated specs are both a legal and a trust problem.
- Publishing at scale without editorial review. Google calls it scaled content abuse. The kill criteria below treat a sudden traffic drop as a signal to stop, not to publish more.

### Pricing

You do not set a price. Standard categories pay 1% to 3%; home and kitchen 3%. The code models $6 per conversion on a ~$150 basket. Higher-ticket categories in the same niche (espresso machines, telescopes) are how the average rises. Diversify to a second programme (the manufacturer's own affiliate scheme, or a network) once a cluster ranks.

### Pipeline

`research-niche -> analyse-competitors -> 2 x (write-article -> review-output -> publish-listing) -> promote`

Nine tasks, two articles per cycle, about $0.30. Publishing goes through the WordPress REST API with an application password when connected, otherwise as a draft you paste. Revenue is entered by you from the Associates dashboard (no API for new associates), which makes this the slowest kind to measure and the one HERMES will most often kill on the no-sale rule; extend the grace with `overseer.instruct` if the posts are indexing and getting impressions.

### Review criteria

1. Article answers the search intent in the first 150 words.
2. Every product claim is verifiable from the product page; no invented specs.
3. Affiliate disclosure appears above the first affiliate link.
4. At least 1,200 words with a comparison table and a clear top pick.
5. Headings map to real long-tail queries; no keyword stuffing.
6. Article does not plagiarise or closely paraphrase competitor copy.

### First 30 days

| Days | Do |
|---|---|
| 1 to 3 | You: domain, hosting, WordPress, Search Console, Associates application (needs a live site with content). Write an honest About page with a named author. |
| 4 to 20 | Ten articles in one cluster, every one read by you before publishing. Internal links between them. Submit the sitemap. |
| 21 to 30 | Pins for each article via `promote`. Nothing else; you are waiting for indexing. Expect zero revenue. |

Target at day 30: ten indexed articles, first impressions in Search Console, $0.

### Kill criteria

HERMES will want to kill this at 240 ticks with no sale. Give it 90 real days from first publish. You, at day 90: fewer than 500 organic impressions a month in Search Console across ten or more posts, or zero clicks on affiliate links with 1,000 or more visits. If Google drops the site by more than half in a week, pause, do not publish more, and audit.

---

## software-templates: boilerplates and Notion templates on Gumroad

Room: Prototype Lab. Roles: scout, engineer, reviewer, marketer. Platforms: gumroad, lemonsqueezy.

### What actually sells

Templates that save a developer or freelancer a weekend and are current with the framework they use this month: a SaaS billing starter with usage-based pricing, a Stripe subscription webhooks starter, a waitlist landing page with referral tracking, an internal admin dashboard, a markdown docs site, a job board starter, a cron-monitoring micro-tool, and on the no-code side a Notion freelancer CRM, a content calendar, a customer feedback board. Buyers arrive from a demo link, a GitHub README, or a post where someone asked "is there a template for X". A live demo and a sixty-second video are the conversion drivers.

### What gets you banned

- Secrets or third-party code with incompatible licences in the repo. Gumroad refunds and, for repeat DMCA hits, closes accounts.
- Selling something that does not install. Gumroad's refund policy is buyer-friendly; a refund rate above 5% kills Discover visibility.
- Lemon Squeezy is merchant of record and enforces its own acceptable-use list; read it before listing anything that touches payments.

### Pricing

$9 to $29 for Notion templates, $19 to $79 for code starters. The code models $19 with $16.60 net. Gumroad direct is 10% + $0.50; Discover sales are 30%. Lemon Squeezy is 5% + $0.50 and handles VAT, which matters once EU buyers appear. Offer a free tier (the landing page, a stripped repo) with an upgrade.

### Pipeline

`research-niche -> build-template -> write-listing -> review-output -> publish-listing -> promote`

Six tasks, one template per cycle, about $0.22 estimated and the highest real multiplier of any kind because builds are long agentic runs. Gumroad has no product-creation API, so every publish is a draft-only Airlock item: the payload contains the title, description, price and files, and you create the product in the dashboard.

### Review criteria

1. Fresh clone installs and runs with the documented commands in under five minutes.
2. No secrets, personal data or third-party code with incompatible licences in the repo.
3. README covers setup, configuration, deployment and customisation.
4. Type checks and tests pass; CI config included.
5. Product page shows a live demo or screenshots of every major screen.
6. Licence is explicit (MIT or a clear commercial licence).

### First 30 days

| Days | Do |
|---|---|
| 1 to 5 | You: Gumroad account, payout verification. First template chosen from a question you have personally seen asked twice. |
| 6 to 20 | Station builds it; you run criterion 1 yourself on a clean machine. Deploy the demo. Publish with a free tier. |
| 21 to 30 | Post in one community where the question was asked, with the free tier, not the paid link. Second template only after the first has a sale. |

Target at day 30: one or two templates, a working demo, 0 to 5 sales.

### Kill criteria

HERMES: defaults. You: no sale within 45 days of the first template despite a live demo and one honest community post, or a refund rate above 10%. Templates decay with their frameworks (`decayHalfLifeTicks` is 60 days in the code); a template with no sale in 90 days is dead even if nothing is wrong with it.

---

## music-packs: royalty-free loops and SFX on Gumroad and itch.io

Room: Sound Deck. Roles: scout, composer, reviewer, marketer. Platforms: gumroad, itch.

### What actually sells

Packs that solve a specific game or video need: lo-fi study loops at 80 bpm, 8-bit boss themes, ambient space station drones, cozy village exploration loops, cinematic risers and hits, retro synthwave menu music, dungeon percussion, a UI click and confirm SFX pack, horror pads, chiptune victory jingles, podcast stingers. Buyers are the same indie developers who buy the asset packs, plus video editors. Audio previews on the page are the whole conversion; a pack without a playable preview does not sell.

### What gets you banned

- Samples of unclear provenance. Sample-pack licences often forbid resale as loops; use synthesis or samples you are certain you may redistribute.
- DistroKid and the streaming route: uploads require an AI disclosure field, artificial streams get every store to pull your catalogue, and DistroKid forbids automated account operation. Streaming pays about $0.003 a play; it is not the business here.
- Copyrighted cover art.

### Pricing

$8 to $15 per pack; the code uses $12 with $10.30 net after Gumroad. Bundles by mood at $29 to $39. Licence: commercial use in games and video, no redistribution.

### Pipeline

`research-niche -> 2 x (compose-track -> write-listing -> review-output -> publish-listing) -> promote`

Ten tasks, two packs per cycle, about $0.30. In live mode `compose-track` produces arrangement specs, MIDI-style note data and mastering targets; rendering audio needs a generation model or a DAW pass by you. Do not publish a pack you have not listened to.

### Review criteria

1. Loops are seamless at the stated BPM with no click at the loop point.
2. Delivered as 44.1kHz/24-bit WAV plus MP3 previews.
3. Consistent loudness across the pack (around -14 LUFS for previews).
4. No samples with unclear provenance; all sounds original or properly licensed.
5. Pack contains at least 10 distinct tracks or 30 SFX.
6. Licence covers commercial use in games and video, forbids redistribution.

### First 30 days

| Days | Do |
|---|---|
| 1 to 3 | You: decide how audio gets rendered (model, DAW, or a collaborator) before spawning the venture. Without that the venture produces specs nobody can buy. |
| 4 to 20 | One SFX pack (fast to make, easy to check) and one music pack in a style that matches your best-selling asset pack if you have one. Cross-link them. |
| 21 to 30 | Upload previews everywhere the pack is listed. Post in the itch.io assets forum with an embedded player. |

Target at day 30: two packs, 200 to 800 page plays, 0 to 4 sales.

### Kill criteria

HERMES: defaults. You: no sale in 60 days with previews live, or preview-to-purchase under 0.5%. Music has the lowest browse traffic of the six kinds in the code (`baseDailyImpressions` 8); run it as a companion to game-assets, not on its own.

---

## Choosing where to start

If you have to pick one, the code's own numbers rank the kinds by margin per month per listing: game-assets ($7.77), thumbnails ($3.34, but it costs your time), templates ($2.55), music ($1.27), affiliate ($1.11), pod-store ($1.06). The boot seed starts a pod-store because it is the one everyone asks for; the allocator will find its own answer within a few epochs. Let it.
