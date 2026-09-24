# 00. Start Here

## What this is

Eternity Station is a 2D space station rendered as a game. In the centre sits HERMES, an Overseer whose only power is to move a token budget between crews. Each crew is a small team of AI agents running one micro-business in a themed room: print-on-demand tees on Etsy, 2D game asset packs on itch.io, paid thumbnail gigs, an affiliate blog, software templates, music packs. Every task costs tokens and every sale earns revenue, and both land in one ledger. Once per epoch HERMES measures trailing ROI per venture, cuts the losers, feeds the winners, and spawns the next experiment.

Nothing touches money, accounts or the public internet without passing the Airlock, which is you. The treasury target is configurable and defaults to one trillion dollars, and the HUD shows the honest ETA at current velocity. That ETA will usually say "never at current velocity". That is the point of the display; read `01-economics-reality-check.md` for why.

## What it is not

It is not a money printer. The combined yearly sales of every marketplace it can publish to is about thirteen billion dollars. A well-run venture earns between nothing and a few thousand dollars a month after a year, and the human at the Airlock is the bottleneck, not the agents. The system's real value is that it makes killing bad ventures automatic and cheap, and makes you look at the numbers every day.

## Run it: sim first

Run each line on its own (Windows PowerShell 5.1 does not accept `&&`):

```
pnpm install
pnpm dev          # server + game together; sim mode by default, no keys, no network
```

`pnpm sim` starts only the server for headless runs. Do not run it alongside `pnpm dev`, both use port 8787.

Open http://localhost:5173. Press `3` for 16x speed. Within a simulated week you will see the first floating `+$x.xx` over the Print Foundry. Sim demand is inflated by `SIM_DEMAND_MULTIPLIER` (default 25) so you see sales in minutes; the HUD says so.

Useful flags: `pnpm sim --reset` wipes the SQLite file and workspaces; `--seed 7` changes the deterministic run; `AUTO_APPROVE=false` makes even the sim wait for you at the Airlock.

Let it run for a simulated month. Watch HERMES kill things. Read its rationale in the Core tab. If you disagree with a kill, type why into the HERMES instruction box and see what it does at the next epoch.

## Then live

Live mode swaps scripted brains for Claude workers (`WORKER_MODEL`, default claude-sonnet-5) and gives HERMES a Claude advisor (`OVERSEER_MODEL`, default claude-opus-5) on top of the deterministic allocator. Every publish waits for you. Platforms without credentials run draft-only and hand you copy-paste payloads.

Do not switch until you have read `05-runbook.md` section 4, especially the clock setting. At the default `TICK_HZ` a simulated day is 12 real seconds, which means the daily token budget resets every 12 seconds and HERMES calls Opus every 12 seconds.

## The one-screen tour

```
┌──────────────────────────────────────────────────────┬───────────────┐
│ Observatory  Print Foundry  Pixel Forge  Thumbnail   │ Core          │
│ (scouts)     (pod-store)    (game-assets) Bay        │  directives   │
│                                                      │  treasury     │
│ Airlock   Quarters   [ CORE: HERMES ]     Reactor    │  ETA          │
│ (amber =  (idle      (red eye pulses     (glow =     │ Airlock       │
│  pending)  crew)      each epoch)         profit)    │  approve /    │
│                                                      │  reject       │
│ Scriptorium  Prototype Lab  Sound Deck   Broadcast   │ Ventures      │
│ (blog)       (templates)    (music)      Tower       │ Crew          │
│                                          (marketers) │ Log           │
├──────────────────────────────────────────────────────┴───────────────┤
│ pause  1x 4x 16x 64x   clock   SIM/LIVE   connected                  │
└──────────────────────────────────────────────────────────────────────┘
```

- Hover a room for its purpose and live venture. Click a room to filter the Ventures tab. Click an agent to follow it.
- Core tab: HERMES's rationale each epoch, treasury, milestone ladder ($1 to $1T), ETA in honest units.
- Airlock tab: pending approvals with a risk badge; manual instructions expand for draft-only platforms. This is where you spend your ten minutes a day.
- Ventures tab: per-venture P&L, trailing ROI, budget share bar, status, and kill/pause/resume.
- Crew tab: each agent, current task, tokens spent, revenue attributed.
- Bottom bar: Space pauses, `1` to `4` set speed, the mode badge says SIM or LIVE.

## Read next

1. `01-economics-reality-check.md`: the numbers. Read it before anything else.
2. `02-architecture.md`: map, tick loop, data model, HERMES's two layers, the Airlock state machine.
3. `03-venture-playbooks.md`: per kind, what sells, what gets you banned, first 30 days, kill criteria.
4. `04-platform-constraints.md`: APIs, terms of service, what only you can do.
5. `05-runbook.md`: the daily routine, the weekly review, live-mode checklist, security, troubleshooting.
6. `architecture/CONTRACTS.md`: the module contracts, for anyone changing code.
