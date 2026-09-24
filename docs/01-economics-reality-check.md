# 01. Economics Reality Check

Read this before you run anything in live mode. It is the document the rest of the system is built on.

All platform numbers were checked on 2026-09-23. Every estimate carries a tag: [Certain] means it comes from a filing, a fee schedule or this repository's code; [Likely] means several independent sources agree within a factor of two; [Guessing] means it is an informed range you should treat as a hypothesis to test in the sim and then in the market.

## 0. The one-paragraph version

Six kinds of micro-business run on the station. Each one, run well by an agent crew with a human at the Airlock, earns somewhere between nothing and a few thousand dollars a month after a year. Tokens are not the expensive part; distribution and your own approval time are. The combined yearly sales of every marketplace this system can publish to is about thirteen billion dollars, so the trillion-dollar target cannot be reached by construction. The target is a gauge, not a plan. Its job is to keep HERMES honest and ruthless about killing ventures that do not return.

## 1. What the platforms actually are

| Platform | Size (latest full year) | Take from a sale | Source |
|---|---|---|---|
| Etsy | GMS $11.92B consolidated, $10.46B marketplace, FY2025 [Certain] | $0.20 listing + 6.5% transaction + ~3% + $0.25 payment (US). Offsite Ads adds 15% (12% above $10k/yr) when a buyer arrives through one [Certain] | [Etsy FY2025 results](https://investors.etsy.com/news-events/press-releases/detail/218/etsy-inc-reports-fourth-quarter-and-full-year-2025-results), [Etsy fees](https://craftybase.com/blog/the-complete-guide-to-etsy-fees) |
| Fiverr | GMV $1.073B, FY2025, down 2.2% YoY; platform take rate 27.7% (seller 20% + buyer fees) [Certain] | 20% of every order from the seller [Certain] | [Fiverr FY2025 results](https://investors.fiverr.com/news-releases/news-release-details/fiverr-announces-fourth-quarter-and-full-year-2025-results) |
| Gumroad | Private. Third-party trackers put cumulative tracked creator revenue near $206M; 2023 company revenue about $21M implies roughly $200M/yr GMV [Guessing, range $150M to $300M] | 10% + $0.50 on direct sales; 30% on sales that come through Gumroad Discover [Certain] | [Gumroad fees](https://checkoutpage.com/blog/how-gumroad-pricing-works-and-a-cheaper-alternative), [Sacra](https://sacra.com/research/gumroad-at-21m/), [State of Gumroad](https://insightraider.com/en/state-of-gumroad-2026) |
| itch.io | Private, publishes a yearly finance post that this network could not fetch. Order of magnitude tens of millions per year [Guessing, range $15M to $60M] | Creator-set revenue share, default 10%, plus payment processing [Certain] | [itch.io payments](https://itch.io/docs/creators/payments), [itch.io 2025 finances](https://itch.io/blog/1137874/2025-finances) |
| Amazon Associates | Not a marketplace you sell on; it pays 1% to 20% by category, most standard categories 1% to 3%, home and kitchen 3% [Certain] | Nothing deducted; the commission is the revenue [Certain] | [Commission rates](https://azonpress.com/amazon-affiliate-commission-rates/) |
| Printify / Printful | Fulfilment, not a storefront. Bella+Canvas 3001 tee base $8.50 to $13 by provider; 11oz mug $4.69 to $8.25 [Likely] | No commission; you pay base cost plus shipping per order [Certain] | [Printify 3001](https://www.sellermockups.com/blog/bella-canvas-3001-guide), [Printify mugs](https://printify.com/app/products/home-and-living/mugs) |

The code models Etsy as a flat 9.5% plus $0.45 per order (`PLATFORM_FEES.etsy` in `packages/core/src/economics.ts`). That folds the $0.20 listing fee into the per-sale fixed cost. Real Etsy charges $0.20 per listing whether or not it sells, and again every four months on renewal. With 300 unsold listings that is $60 a quarter the sim does not show you. Budget for it.

## 2. What one well-run venture earns

"Well run" means: a real niche with measured demand, quality above 0.7 at review, published within a week of production, promoted at least once, and a human who approves the Airlock daily. Revenue is gross, before platform fees, base cost and tokens.

| Kind | Month 1 | Month 6 | Month 12 | Gross margin per unit (code) | Confidence |
|---|---|---|---|---|---|
| pod-store (Etsy + Printify) | $0 to $60 | $100 to $1,200 | $300 to $4,000 | $6.16 on a $24.99 tee ($2.83 Etsy, $16.00 base) | [Guessing] on revenue, [Certain] on margin |
| game-assets (itch.io) | $0 to $40 | $50 to $500 | $100 to $1,500 | $8.99 on a $9.99 pack | [Likely] |
| thumbnail-service (Fiverr) | $0 to $100 | $100 to $800 | $200 to $2,000 | $14.50 on a $20 order ($4 fee, $1.50 tooling) | [Likely], capped by your own fulfilment time |
| affiliate-blog (WordPress + Amazon) | $0 | $0 to $150 | $30 to $800 | $6.00 per conversion (3% to 4% of a ~$150 basket) | [Guessing], highest variance |
| software-templates (Gumroad) | $0 to $50 | $30 to $600 | $100 to $2,000 | $16.60 on a $19 template | [Guessing] |
| music-packs (Gumroad, itch.io) | $0 to $20 | $20 to $300 | $50 to $800 | $10.30 on a $12 pack | [Guessing] |

The low end of every range is zero because most ventures of every kind earn zero. The upper ends are what a focused human seller reports after a year; an agent crew with a distracted human will land below the middle.

What the simulator itself predicts for one listing at quality 0.8 in an unsaturated niche (from `KIND_ECONOMICS` and `expectedDailySales`, [Certain] as a statement about the model):

| Kind | Expected sales per listing per month | Days between sales for one listing | Net margin per listing per month |
|---|---|---|---|
| pod-store | 0.17 | 174 | $1.06 |
| game-assets | 0.86 | 35 | $7.77 |
| thumbnail-service | 0.23 orders | 130 | $3.34 |
| affiliate-blog | 0.18 conversions (after a 28-day indexing ramp) | 163 | $1.11 |
| software-templates | 0.15 | 195 | $2.55 |
| music-packs | 0.12 | 244 | $1.27 |

Two things follow. First, a single listing is worth about a dollar a month. Volume matters. Second, volume in one niche does not work: `saturationK` for pod-store is 20, so 60 tees in the same niche each get a quarter of the traffic. Revenue scales with distinct niches times quality squared, not with listing count. In sim mode `SIM_DEMAND_MULTIPLIER` (default 25) inflates impressions so you see sales in minutes; the HUD labels it. Divide anything the sim shows you by 25 before believing it.

## 3. What it costs to run

### 3.1 Token prices in the code

`MODEL_PRICES` in `packages/core/src/economics.ts`, per million tokens [Certain]:

| Model | Input | Output | Used for |
|---|---|---|---|
| claude-opus-5 | $5.00 | $25.00 | HERMES overseer epoch (`OVERSEER_MODEL`) |
| claude-sonnet-5 | $2.00 | $10.00 | All workers (`WORKER_MODEL`) |
| claude-haiku-4-5 | $1.00 | $5.00 | Available, not used by default |
| scripted | $0 | $0 | Sim mode |

### 3.2 Cost per task and per production cycle

From `TASK_TOKEN_PROFILES` and `estimateTaskCostCents`, Sonnet 5 workers [Certain as the model's estimate]:

| Task | Tokens | Cents | Task | Tokens | Cents |
|---|---|---|---|---|---|
| research-niche | 4,500 | 2 | write-listing | 6,000 | 4 |
| analyse-competitors | 4,500 | 2 | publish-listing | 1,000 | 1 |
| design-artwork | 10,500 | 6 | review-output | 3,000 | 2 |
| create-mockups | 6,000 | 3 | promote | 6,000 | 4 |
| create-asset-pack | 12,000 | 7 | fulfil-order | 8,000 | 5 |
| design-thumbnail | 8,000 | 5 | optimise-listing | 6,000 | 3 |
| write-article | 12,000 | 8 | build-template | 15,000 | 9 |
| compose-track | 9,000 | 5 | overseer-epoch (Opus 5) | 20,000 | 18 |

One production cycle, as wired by `packages/core/src/playbooks.ts`:

| Kind | Tasks per cycle | Units per cycle | Estimated cycle cost | Per unit |
|---|---|---|---|---|
| pod-store | 17 | 3 listings | $0.54 | $0.18 |
| game-assets | 6 | 1 pack | $0.20 | $0.20 |
| thumbnail-service | 6 | 1 gig | $0.18 | $0.18, plus $0.05 tokens and ~$1.50 tooling per order |
| affiliate-blog | 9 | 2 articles | $0.30 | $0.15 |
| software-templates | 6 | 1 template | $0.22 | $0.22 |
| music-packs | 10 | 2 packs | $0.30 | $0.15 |

HERMES costs about $0.18 per epoch at the estimate, one epoch per simulated day, about $5.40 a month.

### 3.3 The honest multiplier

Those profiles are midpoints for a clean run. Real agentic runs read files, retry, think, and call tools in loops. Expect 3x to 8x the estimate in live mode [Likely]. On top of tokens:

- Artwork, thumbnails and pixel art need an image model. A language model writing SVG is fine for the sim and weak for a product people pay for. Budget $0.04 to $0.10 per generated image and 5 to 10 images per design [Likely].
- Music needs an audio model or a human. `compose-track` in live mode produces specs and MIDI-like descriptions, not a mastered WAV.
- Etsy listing fees: $0.20 per listing, renewed every four months.
- Hosting for the blog: $5 to $15 a month. DistroKid if you use it: about $23 a year.

Realistic all-in monthly cost to keep one venture producing at a sane pace (30 to 60 units a month):

| Kind | Model estimate | Realistic | Confidence |
|---|---|---|---|
| pod-store | $5 | $25 to $60 | [Likely] |
| game-assets | $1 | $10 to $40 | [Likely] |
| thumbnail-service | $1 plus per order | $5 to $30 | [Likely] |
| affiliate-blog | $3 | $15 to $40 plus hosting | [Likely] |
| software-templates | $1 | $20 to $80 | [Guessing], builds are long runs |
| music-packs | $1 | $10 to $40 with audio generation | [Guessing] |

The default `DAILY_TOKEN_BUDGET_CENTS=2000` caps the whole station at $20 a day, $600 a month. With eight ventures that is $2.50 a day each. The cap is the single most important safety number in the system. Read the note in `05-runbook.md` about `TICK_HZ` before you trust it in live mode: the budget resets every simulated day, and a simulated day is 12 real seconds at the default clock.

## 4. Break-even per venture

Sales needed to cover token burn, using the code's unit margins. The first column is the general rule; the second is at the default per-venture share of $2.50 a day.

| Kind | Sales per day to cover $1/day | Sales per day to cover $2.50/day | Per month | Listings needed at model demand (q=0.8, unsaturated) |
|---|---|---|---|---|
| pod-store | 0.16 | 0.41 | 12 | ~70 across at least 4 niches |
| game-assets | 0.11 | 0.28 | 8 | ~10 packs |
| thumbnail-service | 0.07 | 0.17 | 5 | Fiverr caps new sellers at 7 gigs; you need reviews, not gigs |
| affiliate-blog | 0.17 | 0.42 conversions | 13 | ~70 indexed posts |
| software-templates | 0.06 | 0.15 | 5 | ~30 templates |
| music-packs | 0.10 | 0.24 | 7 | ~60 packs |

The real break-even is against the realistic cost row in 3.3, so multiply the sales column by three to eight. A pod-store needs roughly 30 to 90 tee sales a month to be worth the tokens and images that produced it. That is a real shop, not a side effect of an agent loop.

Two ways to make break-even easier, both built into the allocator (`packages/core/src/allocation.ts`):

1. Kill fast. A venture past `graceTicks` (72 ticks, three sim days) with trailing ROI below -0.5, or no sale in 240 ticks, is killed and its share goes to the survivors. Killed budget is the cheapest budget you have.
2. Concentrate. A venture at trailing ROI 0.5 or better is promoted to `scaling` and gets the largest softmax share. Winners are rare; when one shows up, feed it.

## 5. The trillion-dollar mirror

Add up every marketplace the station can publish to:

| Marketplace | Yearly GMV | Confidence |
|---|---|---|
| Etsy (consolidated) | $11.9B | [Certain] |
| Fiverr | $1.1B | [Certain] |
| Gumroad | ~$0.2B | [Guessing] |
| itch.io | ~$0.03B | [Guessing] |
| Total | ~$13.2B | |

If you captured every dollar spent on all four platforms, with no fees, no base costs and no tokens, one trillion dollars takes 76 years. A seller doing $13M a year, which would put you among the largest sellers on each platform simultaneously, takes 76,000 years. The HUD computes the ETA the same way `computeTreasury` does: remaining target times 24 ticks divided by trailing daily profit, and it prints "never at current velocity" whenever daily profit is zero or negative. Expect to see that string a lot.

So why is the target in the system at all?

- It is a velocity gauge. An ETA measured in centuries that drops to decades is the cleanest possible signal that daily profit went up by an order of magnitude. The absolute number is meaningless; the derivative is the whole dashboard.
- It keeps HERMES ruthless. The Overseer prompt says it in one line: prefer killing losers over motivating them. A target that can never be reached by patience removes the temptation to extend grace to a thesis that "sounds promising".
- It is honest. The alternative is a dashboard that says "on track" because someone set a target the system could hit. This one never lies to you about how far away the number is.

Set `TARGET_CENTS` to something you care about if you want a gauge that can actually fill. $10,000 in lifetime revenue is a serious first target; the milestone ladder in `DEFAULT_MILESTONES` already marks $1, $100, $1k, $10k on the way.

## 6. What a good outcome looks like

Whole station, one technical founder spending ten minutes a day at the Airlock plus an hour a week reviewing. Revenue is gross; profit after platform fees, base costs and tokens runs 30% to 50% of it for physical goods and 60% to 80% for digital.

| Horizon | Gross revenue per month | What you should see | Confidence |
|---|---|---|---|
| 3 months | $50 to $500 | Two to four ventures killed, one with repeat sales, first Etsy or itch payout received | [Guessing] |
| 6 months | $300 to $2,500 | One venture in `scaling`, a second niche spawned from its playbook, blog starting to index | [Guessing] |
| 12 months | $1,000 to $8,000 | Two or three profitable ventures, the rest killed, and a clear answer about whether to hire a human | [Guessing] |

Three things move the number, in order of leverage:

1. Distribution. Every kind in section 2 is traffic-limited, not production-limited. Pinterest pins, a small email list, a YouTube devlog for the asset packs, and Etsy's own search each multiply impressions by more than any amount of extra production. The `promote` task exists for this and is the one most worth spending real money on (`spend` approvals in the Airlock).
2. Kill speed. Every day a dead venture keeps its exploration floor is a day the winner does not get it. Do not override HERMES kills unless you have information the ledger does not.
3. Human approval throughput. Nothing goes live without you. If the Airlock has 40 pending publishes, production has been wasted. Ten minutes a day, every day, beats an hour on Sunday.

## 7. The biggest risks, in order

1. Platform bans. Etsy suspends shops over trademark hits and undisclosed AI content; Fiverr bans for account sharing and automation, and freezes the balance. One suspension erases a venture's whole ledger. `04-platform-constraints.md` has the rules per platform. Nothing in this system publishes without you reading it first; keep it that way.
2. Saturation from other AI sellers. Every niche in the playbooks is being hit by other people running the same tools. The market model's `saturationK` values are the sim's guess at how fast that hurts. Treat trailing ROI as the truth and thesis quality as the variable you control.
3. Token burn with no revenue. A station that produces 400 listings a week in a niche with no demand loses money quietly. The daily budget cap, the per-venture share, and the kill rule exist for this. Never raise `DAILY_TOKEN_BUDGET_CENTS` until lifetime revenue exceeds lifetime cost.
4. The human bottleneck at the Airlock. Publishing, payouts, tax forms, customer replies and disputes are yours. If you cannot spend ten minutes a day on it, run fewer ventures. `maxVentures` in the policy is a lever for your time, not for the agents' capacity.

## Sources checked 2026-09-23

- Etsy FY2025 results: https://investors.etsy.com/news-events/press-releases/detail/218/etsy-inc-reports-fourth-quarter-and-full-year-2025-results
- Etsy fee breakdown: https://craftybase.com/blog/the-complete-guide-to-etsy-fees and https://www.gelato.com/blog/the-real-cost-of-selling-on-etsy
- Etsy conversion benchmarks: https://www.gelato.com/blog/etsy-conversion-rate and https://merchize.com/what-is-a-good-conversion-rate-on-etsy/
- Fiverr FY2025 results: https://investors.fiverr.com/news-releases/news-release-details/fiverr-announces-fourth-quarter-and-full-year-2025-results
- Printify Bella+Canvas 3001 pricing: https://www.sellermockups.com/blog/bella-canvas-3001-guide and https://podvector.ai/articles/printify/costs-and-charges/printify-bella-canvas-3001-base-cost-2025-full-breakdown-for-pod-sellers
- Printify mugs: https://printify.com/app/products/home-and-living/mugs
- Gumroad fees: https://checkoutpage.com/blog/how-gumroad-pricing-works-and-a-cheaper-alternative and https://www.swell.is/content/gumroad-pricing
- Gumroad scale: https://sacra.com/research/gumroad-at-21m/ and https://insightraider.com/en/state-of-gumroad-2026
- itch.io payments and revenue share: https://itch.io/docs/creators/payments (finances post at https://itch.io/blog/1137874/2025-finances was not reachable from this network)
- Amazon Associates rates: https://azonpress.com/amazon-affiliate-commission-rates/
