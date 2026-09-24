# 05. Runbook

How to operate the station day to day. Written for one person. If a step takes longer than the time next to it, the station has more ventures than you have attention; lower `maxVentures` before anything else.

## 1. The daily ten minutes at the Airlock

Open http://localhost:5173, Airlock tab. The amber light on the airlock room means items are waiting.

| Minute | Do | Rule |
|---|---|---|
| 0 to 1 | Read the Core tab: balance, daily profit, ETA, HERMES's last rationale | If daily profit went negative and stayed there for three days, go to section 3 before approving anything |
| 1 to 7 | Work the publish queue, oldest first. Read title, tags, price, quality score, and open the assets | Approve only what you would buy and could defend to the platform. Reject with a one-line note; the note is what the reviewer sees next time |
| 7 to 8 | Draft-only items: do the paste job on the platform, then approve with the public URL in the note | The URL is stored on the listing and shown in the Ventures tab |
| 8 to 9 | `customer` items: paste the reply on the platform, then approve | Never let a reply go out that mentions the customer's data back to them beyond what they wrote |
| 9 to 10 | Anything `spend`, `account`, `payout`: decide, or leave pending; they do not block production | Pending high-risk items are fine for days. Pending publishes are not; production is wasted while they wait |

Do not use "Approve all low-risk" in live mode unless every low-risk item is a draft-only job you have already done by hand.

## 2. The weekly review (one hour)

1. Ventures tab, sorted by trailing ROI. For each venture write one line: revenue, cost, units sold, what changed. Five minutes.
2. Confirm every HERMES kill from the week's directives. If you disagree with one, the burden is on you to say why in `overseer.instruct` with a number; do not resurrect on instinct (you cannot anyway: killed is terminal, you would spawn a fresh venture with the same thesis).
3. Reconcile the ledger with the platforms: Etsy statement, Printify invoices, Gumroad sales, itch analytics, Associates dashboard. Add `adjustment` entries for anything the adapters did not see (manual revenue, refunds, listing renewals, hosting). The sim's numbers are worthless if the live ledger is not reconciled.
4. Check platform health: Etsy shop stats and any policy notices, Fiverr response rate and rating, Search Console impressions, Gumroad refund rate. A warning from a platform outranks everything else in this document.
5. Distribution: did every published item get at least one `promote` action executed by you? If not, that is your homework for the week, not the agents'.
6. Budget: lifetime revenue versus lifetime cost in the Core tab. Raise `DAILY_TOKEN_BUDGET_CENTS` only when revenue exceeds cost and the Airlock queue is empty most mornings. Lower it the moment daily profit is negative for a week.
7. Write down one hypothesis for next week and give it to HERMES with `overseer.instruct` (for example, "concentrate the pod-store share on the sweatshirt niche; the tee niche has 400 views and no sale"). Instructions are applied at the next epoch and cleared.

## 3. Kill criteria

HERMES applies the policy automatically after the grace period:

| Signal | Threshold (default policy) |
|---|---|
| Trailing ROI over 168 ticks | below -0.5 |
| Ticks since last sale | more than 240 |
| Grace before either rule applies | 72 ticks from spawn |

You apply these by hand, at the weekly review, in real calendar time:

| Kill it when | Because |
|---|---|
| A platform sends a policy warning about it | One more strike costs the whole shop, not just the venture |
| Views or impressions are flat for three consecutive weeks with new listings going live | Production is not the constraint; the thesis is |
| Refund or cancellation rate above 10% | Quality failure that the reviewer is not catching |
| You have not personally done the promotion for two weeks | The venture is not being run; it is being produced |
| Realistic all-in cost (tokens, images, fees, your time at whatever rate you value it) exceeds gross revenue for eight weeks after launch | The code's token estimate is a floor, not the bill |

Pause, do not kill, when the platform is the problem and the thesis is not (Google update, Etsy search change, API outage). Paused ventures hold zero budget share and resume with their listings intact.

## 4. Live-mode checklist

Do these in order. Skipping the clock step will spend real money at simulation speed.

### 4.1 Before switching `MODE=live`

- [ ] Run the sim for at least a simulated month (`pnpm sim`, speed 64) and read the directives. If you do not understand why HERMES killed something in the sim, you are not ready to pay for it live.
- [ ] Create every account yourself: Etsy shop, Printify, itch.io, Gumroad, WordPress hosting, Pinterest business. Complete KYC and tax forms. Nothing here is automated and nothing should be.
- [ ] Put credentials in `.env` only (`cp .env.example .env`). Never in code, never in the workspace, never in a prompt. The server reads `process.env` once in `config.ts` and passes an `AdapterEnv` down; brains never see it.
- [ ] Set `ANTHROPIC_API_KEY` or use a logged-in profile. Set a hard spend limit on the key in the Anthropic console; that cap is outside this program and cannot be raised by anything in it.
- [ ] `AUTO_APPROVE` is ignored in live mode (auto-approval is sim-only in `airlock.ts`); confirm you understand that every publish will wait for you.

### 4.2 Set the clock so a simulated day is a real day

One tick is one simulated hour. The wall clock fires a tick every `1000 / (TICK_HZ * speed)` ms. `DAILY_TOKEN_BUDGET_CENTS` resets every 24 ticks and HERMES runs (an Opus call) every 24 ticks. At the default `TICK_HZ=2` that is every 12 real seconds. [Certain, from `clock.ts` and `station.ts`.]

| TICK_HZ | Real time per tick | Real time per sim day | Budget resets per real day | `DAILY_TOKEN_BUDGET_CENTS` for a $20 real-day cap | Sales poll interval (60 ticks) |
|---|---|---|---|---|---|
| 2 (default) | 0.5 s | 12 s | 7,200 | do not run live at this setting | 30 s |
| 0.0167 | 1 min | 24 min | 60 | 33 | 1 h |
| 0.00278 | 6 min | 2.4 h | 10 | 200 | 6 h |
| 0.000278 | 1 h | 24 h | 1 | 2000 | 60 h |

Recommended: `TICK_HZ=0.00278` and `DAILY_TOKEN_BUDGET_CENTS=200`. That gives ten HERMES epochs a day (about $2 of Opus at the estimate), a sales poll every six hours, and a per-reset budget small enough that a runaway loop costs $2, not $20. Leave the speed control at 1x in live mode; 64x turns a 6-minute tick into 6 seconds and multiplies everything above by 64.

Kill and grace thresholds are in ticks, so at 6-minute ticks the 72-tick grace is 7.2 real hours and the 240-tick no-sale rule is one real day. That is far too fast for real marketplaces. The policy is persisted in the SQLite `meta` table under the key `policy` and merged over `DEFAULT_POLICY` on boot; there is no env variable or command to change it yet, so raising `graceTicks` and `killNoSaleTicks` means editing that row before starting. In live mode `overseer.instruct` ("do not kill anything younger than 30 days") lets the Claude layer replace a deterministic kill with an `active` status for a named venture, one epoch at a time. Otherwise accept that HERMES will kill and respawn quickly and treat live ventures as short experiments. The affiliate blog cannot survive default thresholds at any clock setting; instruct HERMES explicitly.

### 4.3 Then

- [ ] `MODE=live pnpm start` with `--reset` if you want a clean ledger, then `pnpm dev` for the client.
- [ ] Check `GET /api/capabilities`: every platform you expect should say `connected: true`; the rest are draft-only and will hand you paste jobs.
- [ ] Watch one full cycle end to end before leaving it running: research, production, review, Airlock, publish, listing live.
- [ ] Set a calendar reminder for the daily ten minutes. The station does nothing useful without it.

## 5. Security

Keys and secrets

- API keys live in `.env` and in your platform dashboards, nowhere else. `.env` is git-ignored; check with `git status` before every commit.
- Rotate any key that has ever been printed to a terminal or a log. The server never logs env values, but you might.
- Etsy tokens expire hourly and refresh automatically; the refresh token is the secret that matters.
- Give each platform token the narrowest scope offered (Etsy: listings and transactions for your shop only; Gumroad: view sales; WordPress: a dedicated author user with an application password, not your admin account).

Spend caps, in layers

1. Anthropic console spend limit on the key (outside this program).
2. `DAILY_TOKEN_BUDGET_CENTS`, sized per section 4.2. When it hits zero the crew rests and HERMES logs it.
3. Per-venture `budgetShare`, enforced at dispatch: a venture cannot spend beyond its share of the day's budget.
4. `BRAIN_CONCURRENCY` (default 4 in live mode) bounds how many Claude calls run at once.
5. `MAX_CREW` (default 40) and `maxCrewPerVenture` (3) bound how many agents exist to spend.

Workspace confinement

- Every brain writes only under `WORKSPACE_ROOT/<ventureId>`. Paths with `..`, absolute paths, or symlinks that escape are rejected with `WorkspaceError`. Do not disable this and do not point `WORKSPACE_ROOT` at anything shared.
- The ClaudeBrain's tools are `write_file`, `read_file`, `list_files`, `submit_output`, and `web_search` for scouts only when `ALLOW_WEB_SEARCH=true`. There is no shell tool and there should not be.

Customer data

- Never paste customer PII (names, addresses, emails, order numbers with names) into an `overseer.instruct` message, a task input, or a workspace file. `customer` approvals are drafted from the order context you type in; keep that to the question, not the person.
- Order data from Printify and Etsy stays in those dashboards. The ledger stores amounts and listing ids, not buyers.
- If a platform asks about your use of AI or automation, answer truthfully: agents draft, a human publishes and communicates.

Network

- Bind to localhost unless you have a reason not to (`HOST=127.0.0.1`). The REST and WS endpoints have no authentication; anyone who can reach the port can approve the Airlock.
- In production (`NODE_ENV=production`) the server serves the built client; put it behind something that authenticates you if it is reachable from outside your machine.

## 6. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Nothing moves, clock shows paused | You pressed Space, or a `clock.pause` command | Space again, or the resume button |
| Agents walk to quarters and stay; HERMES says "Budget is spent" | `dailyTokenBudgetRemainingCents` is 0 | Wait for the sim day boundary, or raise `DAILY_TOKEN_BUDGET_CENTS` and restart. In live mode read section 4.2 first |
| Sim shows no sales after a simulated week at 16x | A listing never went live: Airlock has pending items and `AUTO_APPROVE=false`, or every listing was rejected by the reviewer | Airlock tab; check the Log for "rejected"; approve or lower expectations on quality |
| Sales look huge in sim | `SIM_DEMAND_MULTIPLIER` (default 25) is on | It is labelled in the HUD; divide by 25. Set it to 1 for honest sim numbers |
| ETA says "never at current velocity" | Daily profit is zero or negative | This is correct. Read `01-economics-reality-check.md` section 5 |
| `command.rejected: Venture ... is killed and cannot be revived` | Killed is terminal | Spawn a new venture with the same kind and thesis if you really want it back |
| Approval stuck in pending in live mode | Nobody decided it; nothing auto-approves live | Decide it |
| `Approval ... is already approved` | Double click or a reconnect replayed the command | Harmless |
| Publish approved but the listing is still awaiting-approval | Connected adapter rejected the listing (see the Log for the adapter error); the task will retry | Fix the cause (missing asset, bad price, expired token) and it retries up to 3 times |
| Etsy adapter says unauthorised | Access token expired and refresh failed, or the app was not approved | Re-authorise in the Etsy developer portal, update `.env`, restart |
| WordPress publish fails with 401 | Application password revoked or user lacks the author role | Regenerate the password for a dedicated author user |
| Gumroad or itch sales never appear | Both are read as aggregates; Gumroad needs the token, itch needs `ITCH_API_KEY`; the poll runs every 60 ticks | Check capabilities; adjust `TICK_HZ` or wait; reconcile weekly by hand |
| `Sales poll failed` in the log | Network or rate limit | Retries next interval; if persistent check the token |
| Claude worker fails with a rate limit | `BrainError` with `restTicks` | The agent rests and the task requeues; lower `BRAIN_CONCURRENCY` if it repeats |
| `HERMES advisor unavailable` | Overseer Claude call failed | Deterministic plan applied; check the API key and the console spend limit |
| Server refuses to start: `Invalid environment` | zod rejected `.env` | The message names the variable; fix it |
| `Path escapes the workspace` in the log | A brain tried to write outside its venture folder | Task fails as designed; if it recurs in live mode, read the prompt that produced it |
| Client shows "reconnecting" forever | Server down, or `PORT` changed without updating the Vite proxy | Start the server on 8787 or update `apps/station/vite.config.ts` |
| Everything reset after a restart | You ran with `--reset`, or `DB_PATH` moved | Point `DB_PATH` at the old file; there is no undo for `--reset` |
| A venture spends but never publishes | Its cycles keep failing at review (quality below threshold) | Ventures tab: units produced versus published. Reject the thesis, not the reviewer |

If you hit something not in this table, the Log tab with level `warn` and above almost always names the module. The server's log lines carry the agent id; the Crew tab maps ids to names.
