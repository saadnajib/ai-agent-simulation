# 04. Platform Constraints

What each platform lets a program do, what its terms forbid, what you must do personally, and how the Airlock maps to it. Checked 2026-09-23. The capability flags below match what `packages/adapters` reports through `GET /api/capabilities`; if the two ever disagree, the code is what actually runs and this document needs updating.

## 1. Summary table

| Platform | Seller API | Adapter in this repo | Create listing | Read sales | ToS on automation | Human must |
|---|---|---|---|---|---|---|
| Etsy | Yes, Open API v3, app approval required | real (draft-only without keys) | yes when connected | yes | Seller of record is a human; AI disclosure required; multi-shop rules | Open shop, KYC, tax, disclosures, disputes, messages |
| Printify | Yes, open REST | real | yes (products, publish to Etsy) | orders | Automation allowed | Connect store, pay base costs, handle reprints |
| Printful | Yes, REST v2 | profile only, draft-only | no | no | Automation allowed | Same as Printify |
| Fiverr | None | manual | no | no | No account sharing or automation, ever | Everything: gigs, orders, messages, delivery |
| itch.io | butler CLI for files; server API for stats | real (draft-only without key) | files only; page by hand | aggregate only | AI content must be tagged | Create project pages, payouts |
| Gumroad | Partial: sales, licences, enable/disable | real (draft-only without token) | no | yes | Automation of reads allowed | Create every product, payouts |
| Lemon Squeezy | Orders, licences, checkouts | profile only, draft-only | no | no | Merchant of record rules | Create products, acceptable-use compliance |
| WordPress (self-hosted) | REST API with application passwords | real (draft-only without creds) | yes (posts) | n/a | Unrestricted; affiliate networks are not | Hosting, disclosures, Search Console |
| Amazon Associates | No reporting API for new associates | profile only | n/a | no (you enter it) | Disclosure, no cloaking, 180-day rule | Application, tax interview, manual revenue entry |
| Pinterest | Yes, Trial then Standard access with video review | real (draft-only without token) | pins when connected | n/a | Anti-spam; affiliate disclosure | App approval, board setup |
| X | Paid API tiers | profile only, draft-only | no | n/a | No automated engagement | Post by hand |
| DistroKid | None | manual | no | no | No automation; AI disclosure field mandatory | Every upload, royalties |
| Unity Asset Store | None (Publisher Portal) | profile only | no | no | Human review; AI disclosure | Submissions |

"Draft-only" means the adapter returns `manual: { instructions, payload }` and the Airlock shows you a copy-paste-ready package. Approving the request records the listing as live once you have done the work (paste the public URL into the approval note and the listing keeps it).

## 2. Per platform

### Etsy

API. Open API v3 with three tiers: a Seller App (your own shop only, approved in minutes), a Personal App (deeper review, limited scale), and Commercial Access (serving other sellers, manual review). This station needs a Seller App. OAuth 2.0 with PKCE; access tokens expire after one hour and the server refreshes them with a 90-day refresh token. Env: `ETSY_API_KEY`, `ETSY_ACCESS_TOKEN`, `ETSY_SHOP_ID`. Sources: [Etsy developer docs](https://developers.etsy.com/documentation/), [tiers summary](https://vorplabs.com/agent-tools/etsy-api).

ToS constraints the adapter records in `tosNotes`:

- The seller of record is a human who owns the shop; the station is a tool acting on their behalf.
- AI-assisted designs must be disclosed under the Creativity Standards; you state your role (designer, producer, sourcer). Human creative input must be central. Source: [Creativity Standards guide](https://iscompliant.app/Blog/etsy-creativity-standards-pod-sellers-guide).
- Multiple shops are allowed with a unique email each, a listing of your other shops in each public profile, and no duplicated listings. Never let an agent open a shop. Source: [Etsy Help: second shop](https://help.etsy.com/hc/en-us/articles/360017604474-How-to-Open-a-Second-Shop-on-Etsy).
- Trademarked or celebrity content gets listings removed and shops suspended.
- Fees: $0.20 per listing, 6.5% transaction, ~3% + $0.25 payment processing (US), Offsite Ads 15% (12% above $10k trailing revenue, where enrolment is mandatory).

You must personally: open the shop, complete identity verification and the tax interview, choose Etsy Payments, write the About page including AI disclosure, respond to every customer message (Etsy tracks response rate), handle cases and refunds, and read the monthly statement.

Airlock: `publish` (medium risk when connected, low when draft-only), `customer` for any buyer reply the writer drafts, `spend` for Etsy Ads. Recommended: reject any listing whose title you would not type into Etsy search yourself.

### Printify and Printful

API. Both are open REST APIs; Printify's is implemented (`PRINTIFY_API_TOKEN`, `PRINTIFY_SHOP_ID`) and can create products, upload artwork, and publish to a connected Etsy shop. Printful is profile-only in this repo and runs draft-only.

ToS: automation of product creation and order handling is explicitly allowed. The storefront's rules still apply to what you publish. Artwork must be yours to use commercially. Base cost is charged when an order is placed, so the listing price must clear base plus shipping plus channel fees.

You must personally: connect the Printify store to Etsy once (OAuth in the browser), keep a payment method on file for base costs, handle reprint requests and damaged-in-transit claims, and order samples.

Airlock: `publish` (the same request covers the Printify product and the Etsy listing); `spend` for sample orders.

### Fiverr

API. None for sellers. The adapter is manual: `hasApi: false`, every capability false.

ToS: the account holder must be the only person operating the account; assistants and partners are named as violations. Automation of the seller account is forbidden and detected automation leads to a permanent ban with funds frozen. AI is permitted across categories when the client's expectations are clear and the delivery is tailored and reflects your effort; Fiverr's own inbox assistant must disclose that it is an AI. New sellers are capped at seven active gigs and rated on response and delivery times. Sources: [Using AI on Fiverr](https://help.fiverr.com/hc/en-us/articles/34998793899665-Using-AI-on-Fiverr-Guidelines-for-freelancers-and-clients), [Community Standards](https://help.fiverr.com/hc/en-us/articles/32242973123985-Our-Community-Standards).

You must personally: create the profile and gigs, pass identity verification, answer every message, accept and deliver every order, request reviews, handle revisions and cancellations, and withdraw funds.

Airlock: every gig is a draft-only `publish` with the gig text and portfolio files; every order reply is a `customer` request with drafted text. Nothing in this repository sends anything to Fiverr, and it must stay that way.

### itch.io

API. The `butler` CLI pushes files to a channel on an existing project and is documented and encouraged by itch.io; a server API key (`ITCH_API_KEY`) reads per-game aggregate counters. There is no API to create a project page. Source: [butler pushing docs](https://itch.io/docs/butler/pushing.html).

ToS: AI-generated content must be tagged as such; packs must state their licence; revenue share is creator-set with a 10% default; payouts go to a verified account. Sales are not available per order through the API, so the ledger sees aggregate deltas.

You must personally: create each project page (title, description, cover, pricing, tags including the AI tag), set up payouts, and answer community comments.

Airlock: `publish` is split: the page is a manual step in the instructions, the files are pushed by the adapter after approval when connected.

### Gumroad

API. OAuth token (`GUMROAD_ACCESS_TOKEN`) reads sales and licences and can enable or disable existing products. There is no public endpoint to create or edit products; rate limits exist and return 429 but are not published. Sources: [Gumroad API](https://gumroad.com/api), [community notes on limits](https://github.com/antiwork/gumroad-cli/pull/222).

ToS: 10% + $0.50 on direct sales, 30% through Discover; AI content allowed if it does not infringe; buyers can refund within the policy window; payouts require a verified account.

You must personally: create every product in the dashboard from the Airlock payload, upload files, set the price and licence, and handle refund requests.

Airlock: `publish` is always draft-only with a complete payload; sales are read automatically once connected.

### Lemon Squeezy

Profile only. Merchant of record (handles VAT and sales tax) at 5% + $0.50. API covers orders, licences and checkouts; product creation is dashboard-only. You must personally create products and comply with its acceptable-use policy, which is stricter than Gumroad's for anything financial.

### WordPress (self-hosted) and Amazon Associates

API. WordPress REST (`POST /wp-json/wp/v2/posts`) authenticated with an application password (`WORDPRESS_URL`, `WORDPRESS_USER`, `WORDPRESS_APP_PASSWORD`). The adapter creates posts as drafts or published per the approval. Source: [Application Passwords guide](https://make.wordpress.org/core/2020/11/05/application-passwords-integration-guide/).

ToS that bind the blog:

- Amazon Associates: a visible disclosure on every page with affiliate links, no cloaked links, no links in email or PDFs, no stale prices, and the account closes without three qualifying sales in 180 days. No reporting API for new associates; you enter commissions by hand.
- FTC Endorsement Guides (2023 revision): clear and conspicuous disclosure before or near the link; material AI generation of review content may itself need disclosure; up to $53,088 per violation in 2026. Source: [FTC disclosure guide](https://blog.promise.legal/startup-central/ftc-ai-disclosure-rules-creators-2026/).
- Google: scaled content abuse (many pages generated mainly to rank) is a spam policy; the March 2026 core update hit unreviewed AI sites hard. Source: [scaled content abuse](https://www.digitalapplied.com/blog/scaled-content-abuse-google-march-update-ai-pages-decimated).

You must personally: buy the domain and hosting, apply to Associates after the site has content, complete the tax interview, add the site-wide disclosure, verify Search Console, read every article before it goes live, and enter revenue.

Airlock: `publish` for each article (connected: posts via REST; draft-only: paste). Treat every approval as an editorial sign-off; that is the one thing Google is checking for.

### Pinterest

API. Real, with Trial access (pins visible only to you) and Standard access after a review that includes a video of your app performing the action. `PINTEREST_ACCESS_TOKEN` when approved. Source: [Pinterest access tiers](https://developers.pinterest.com/docs/getting-started/access-tiers/).

ToS: spammy or repetitive pins get accounts limited; affiliate links are allowed with disclosure and without cloaking. Pinterest is a traffic source, not a store; revenue is attributed to the linked listing.

You must personally: create the business account and boards, apply for API access, and post by hand until Standard access lands.

Airlock: `promote` outputs become draft-only `publish` requests with pin text and image until connected.

### X

Posting requires a paid API tier. Profile only in this repo; promotion drafts are handed to you. Automated engagement is against the rules.

### DistroKid

No API. Automated account operation and bulk upload scripts violate the terms and risk withheld royalties. Every upload has a mandatory AI disclosure field and passes automated screening; artificial streaming leads to catalogue-wide takedowns. DistroKid keeps 0% on the yearly plan; the stores keep roughly 30% and pay per stream. You must personally do every upload and own every rights declaration. Airlock: draft-only `publish` with the release metadata and file list.

### Unity Asset Store

No publishing API; submissions go through the Publisher Portal and human review. Unity keeps 30% and requires AI disclosure in the submission. Profile only here.

## 3. What only you can do, across every platform

| Task | Why the station cannot | Where it shows up |
|---|---|---|
| Create accounts and shops | Every platform requires a human seller of record; several forbid delegated account operation | `account` approvals, always manual |
| Identity verification and KYC | Government ID, selfie checks, bank verification | Before live mode, once per platform |
| Tax forms (W-9 / W-8BEN, VAT registration where you sell) | Legal identity | Before the first payout |
| Payouts | Bank ownership | `payout` approvals if a brain ever proposes one; do them in the platform |
| Disputes, cases, chargebacks | Platforms require the account holder to respond | `customer` approvals carry drafted replies |
| Customer messages | Fiverr and Etsy rate you on it and forbid bots that do not disclose | `customer` approvals |
| Reading and pasting Associates and itch revenue | No per-order API | `adjustment` ledger entries you add |
| Reading every listing before it goes live | Trademark, disclosure and quality liability is yours | Every `publish` approval |

## 4. How the Airlock maps to platforms

| Approval kind | Risk in live mode | Platforms that produce it | What approving does |
|---|---|---|---|
| publish | medium when the adapter will act, low when you will act | all | Connected: adapter creates the listing. Draft-only: records the listing as live; put the URL in the note |
| spend | medium or high depending on amount | Etsy Ads, Printify samples, hosting, Pinterest ads | Records the intent; you make the payment |
| account | high | any new platform | Nothing automatic; it is a reminder that you must do it |
| payout | high | Etsy, Fiverr, Gumroad, itch | Nothing automatic |
| customer | medium | Fiverr, Etsy | You paste the drafted reply |
| kill | medium | HERMES, when sunk cost is above threshold | Kills the venture |
| hire | low | HERMES or a brain, beyond `maxCrewPerVenture` or `MAX_CREW` | Hires the agent |

In sim mode every request is low risk and auto-approves after six ticks unless `AUTO_APPROVE=false`. In live mode nothing auto-approves. `approval.decide-all` with `maxRisk: low` is the "approve every draft-only paste job I have already done" button; never use it on medium or high without reading each item.
