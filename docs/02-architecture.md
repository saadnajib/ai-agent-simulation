# 02. Architecture

Eternity Station is three processes and one contract. The contract is `packages/core/src/types.ts` plus `docs/architecture/CONTRACTS.md`; this document explains how the pieces move. Everything below is read from the code as of this commit; where behaviour is configurable the env variable is named.

## 1. Packages

```
apps/station        Vite + Canvas 2D game client. Renders StationState, sends StationCommand.
packages/server     Node 22. Clock, orchestrator, brains, Overseer, Airlock, SQLite, REST + WS.
packages/adapters   PlatformAdapter per marketplace. Mock in sim; real or draft-only in live.
packages/core       Pure TypeScript, no IO: types, map, RNG, economics, market, ledger, allocation, playbooks.
```

Dependency direction is strictly downward: station and server import core; server imports adapters; adapters import core. Core never touches the file system, the network or timers, which is what makes the sim reproducible from `SEED`.

## 2. The station map

56 by 36 tiles, one tile per agent. Room rectangles come from `ROOM_LAYOUT` in `packages/core/src/stationMap.ts`; `buildStationMap()` derives walls, doors, floors, workstations and corridors, and the test suite proves every door reaches every other door.

```
x:  0    5    10   15   20   25   30   35   40   45   50   55
y0  ################################################ hull ######
    #                                                          #
y2  # OBSERVATORY  #  PRINT FOUNDRY # PIXEL FORGE  # THUMBNAIL #
    # scouts       #  designers     # pixel-artists# BAY       #
    # research     #  writers       # reviewers    # thumbnail #
    # 12x9         #  reviewers 12x9# 12x9         # artists   #
y10 ###############  ###############  ############## 10x9 #####
    ............corridor.....................................
y13 # AIRLOCK    # QUARTERS  #                     # REACTOR  #
    # human      # idle crew #   ##############    # treasury #
y14 # approvals  # 8x10      #   # CORE  (eye) #    # + token  #
    # 10x10      #           #   # HERMES  8x8 #    # budget   #
    #            #           #   ##############    # 10x10    #
y22 #############  ###########      (y14..21)       ###########
    ............corridor.....................................
y25 # SCRIPTORIUM # PROTOTYPE LAB  # SOUND DECK   # BROADCAST #
    # writers     # engineers      # composers    # TOWER     #
    # affiliate   # templates      # music packs  # marketers #
    # blog 12x9   # 12x9           # 12x9         # 10x9      #
y33 ##############################################################
```

Exact rectangles (x, y, w, h, walls included):

| Room | Rect | Produces | Roles |
|---|---|---|---|
| observatory | 2, 2, 12, 9 | research for every venture | scout |
| print-foundry | 16, 2, 12, 9 | pod-store | designer, writer, reviewer |
| pixel-forge | 30, 2, 12, 9 | game-assets | pixel-artist, reviewer |
| thumbnail-bay | 44, 2, 10, 9 | thumbnail-service | thumbnail-artist, reviewer |
| airlock | 2, 13, 10, 10 | human approvals | none |
| quarters | 14, 13, 8, 10 | idle and resting crew | none |
| core | 24, 14, 8, 8 | HERMES | overseer |
| reactor | 44, 13, 10, 10 | treasury display | none |
| scriptorium | 2, 25, 12, 9 | affiliate-blog | writer, reviewer |
| prototype-lab | 16, 25, 12, 9 | software-templates | engineer, reviewer |
| sound-deck | 30, 25, 12, 9 | music-packs | composer, reviewer |
| broadcast-tower | 44, 25, 10, 9 | promotion for every venture | marketer |

Scouts and marketers are shared roles (`SHARED_ROLES` in `dispatch.ts`); they serve every venture and never count toward a venture's crew cap.

## 3. Time

One tick is one simulated hour. `TICKS_PER_DAY = 24`. The wall clock fires a tick every `1000 / (TICK_HZ * speed)` milliseconds (`StationClock` in `clock.ts`), never overlapping: if a tick is still processing, the next waits. `TICK_HZ` defaults to 2 and `speed` is 1, 4, 16 or 64, so at the default a simulated day passes in 12 real seconds at 1x and in under 0.2 seconds at 64x. That is right for the sim and wrong for live mode; see `05-runbook.md` section 4 before switching.

## 4. The tick loop

`Station.step()` in `packages/server/src/station.ts`, in order:

```
tick += 1
if tick % 24 == 0        -> onNewDay(): wake budget-rested crew, log the budget reset
work.wakeRested()        -> crew whose restUntil has passed go idle
moveAgents()             -> every walking agent advances one tile; arrivals start their task
collectRevenue()         -> sim: market.simulateTick over live listings -> ledger entries + sale events
                            live: every 60 ticks poll adapters.readSales(since)
airlock.tick()           -> sim only: low-risk requests older than 6 ticks auto-approve (AUTO_APPROVE)
work.resolveWaiters()    -> brains waiting on waitTicks(n) resume
await settle()           -> let async brain completions land
ensureCycles()           -> every funded venture with no open work gets a new playbook cycle
dispatch()               -> if daily budget remains: for each queued task whose deps are done,
                            find or hire an idle agent with the role, walk it to a workstation,
                            run the brain (bounded concurrency: 32 scripted, 4 Claude)
                            else: rest the idle crew and let HERMES say so once
returnIdleToQuarters()
if tick % epochTicks==0  -> engine.runEpoch()   (epochTicks = 24)
elif tick % 6 == 0       -> refreshMetrics()
publishTreasury()        -> recompute Treasury, announce new milestones, emit treasury.updated
emit tick
world.flush()            -> dirty entities to SQLite in one transaction
```

Money flow per tick: `simulateSales` books `revenue` (positive), `platform-fee`, `fulfilment-cost` and `refund` (negative) entries, updates listing stats, attributes net revenue to the agent whose task produced the listing, and emits a `sale` event the client floats over the room. Task completion books `token-cost` from real usage in live mode or `estimateTaskCostCents` in sim mode.

## 5. Data model

Every entity is a JSON document keyed by id, persisted in `node:sqlite` with one table per entity (`id, json, updated_tick`) plus indexed columns where queried (`tasks.status`, `ledger.tick`, `ledger.seq`). Boot restores the whole world from the snapshot; a crash mid-task requeues in-flight tasks (`WorkRunner.recover`).

```
Venture ──< Storefront (platform, connected?)
   │  ──< Listing (status, quality, niche, price, unitCost, stats)
   │  ──< Task (kind, role, dependsOn[], estimateCents, costCents, output)
   │  ──< CrewAgent (role, position, brain, stats)
   │  ──< LedgerEntry (signed cents, kind, tick)
   └── VentureMetrics (recomputed from ledger + listings each epoch)

ApprovalRequest (kind, risk, payload, manualInstructions?) ── Task ── Listing
OverseerDirective (rationale, actions[])
Treasury (derived from ledger: balance, daily P&L, budget remaining, runway, ETA)
```

Key invariants, all enforced in code:

- Money is integer cents, signed. Revenue is positive; every cost is negative. `computeTreasury` never sees a float.
- `budgetShare` across funded ventures sums to 1 after every epoch (`renormaliseShares`). Killed and paused ventures hold 0.
- A task runs only when every id in `dependsOn` is `done`. A failed or cancelled task cancels its dependents.
- A listing's `quality` is set by the reviewer and drives simulated demand as quality squared.
- Workspace paths are confined per venture: `..`, absolute paths and symlink escapes throw `WorkspaceError`.

## 6. HERMES: two layers

```
                ┌─────────────────────────────────────────────┐
  StationState  │ Layer 1: planEpoch(state, rng)   [always]   │
  ─────────────>│  deterministic, pure, tested                │
                │  1 score ventures by trailing ROI (softmax) │
                │  2 shares = floor + (1 - n*floor) * softmax │
                │  3 kill: roi < -0.5 or no sale > 240 ticks  │
                │  4 scale: roi >= 0.5 ; demote below         │
                │  5 spawn if alive < maxVentures (best kind) │
                │  6 one broadcast                            │
                └───────────────┬─────────────────────────────┘
                                │ deterministic actions
                ┌───────────────▼─────────────────────────────┐
  live mode     │ Layer 2: ClaudeOverseer.propose  [optional] │
  only          │  claude-opus-5, adaptive thinking, effort   │
                │  high, zod-parsed OverseerDirective         │
                │  input: metrics summary, deterministic plan,│
                │  pending operator instructions, policy text │
                └───────────────┬─────────────────────────────┘
                                │ proposal
                ┌───────────────▼─────────────────────────────┐
                │ merge(): validate every proposed action      │
                │  shares clamped to [floor, 1]                │
                │  no kill inside graceTicks                   │
                │  no spawn above maxVentures                  │
                │  no hire above MAX_CREW, never 'overseer'    │
                │  unknown ventures dropped                    │
                └───────────────┬─────────────────────────────┘
                                │ applied actions
                    applyOverseerAction -> renormaliseShares -> directive
```

If the Claude call fails, the deterministic plan applies unchanged and the log says so. HERMES cannot publish, spend, create accounts or contact anyone; the only outputs it has are the seven `OverseerAction` variants, and none of them leave the station.

Default policy (`DEFAULT_POLICY`): epoch 24 ticks, window 168, exploration floor 0.05, grace 72, kill ROI -0.5, kill no-sale 240 ticks, scale ROI 0.5, max 8 ventures, max 3 crew per venture.

## 7. The Airlock

Anything that publishes, spends, creates an account, moves money, talks to a customer, kills a venture with sunk cost, or hires beyond the cap becomes an `ApprovalRequest`. The requester parks; a human decides.

### 7.1 Approval request states

```
             request()
                │
                ▼
            ┌────────┐   decide(approved)    ┌──────────┐
            │pending │ ────────────────────> │ approved │ -> waiter resumes, effect runs
            │        │                       └──────────┘
            │        │   decide(rejected)    ┌──────────┐
            │        │ ────────────────────> │ rejected │ -> task rejected, dependents cancelled
            └────────┘                       └──────────┘
                │  sim mode, risk=low, age >= 6 ticks, AUTO_APPROVE=true
                └──────────────────────────> approved (by 'auto')
```

`expired` exists in the type and is reserved for a future sweep; nothing sets it today. A decision on a non-pending request is refused with a reason.

Risk assignment for publishes (`publishRisk` in `effects.ts`): sim mode is always `low`; live mode is `medium` when the adapter is connected and will act, `low` when the adapter is draft-only and the human will do the work by hand. In live mode nothing auto-approves regardless of risk.

### 7.2 The publish path, end to end

```
publish-listing task dispatched
  -> beginPublish: adapter not connected? ask it for manual instructions
  -> listing.status = awaiting-approval ; task.status = awaiting-approval ; agent blocked
  -> ApprovalRequest{kind: publish, payload: title/description/tags/price/assets/connected}
  human approves
  -> completePublish: connected ? adapter.createListing : record manual (URL from the note if present)
  -> listing.status = live, publishedAtTick = now ; venture incubating -> active
  -> task done ; dependents (promote) unblock
  human rejects
  -> listing.status = rejected ; task rejected ; dependents cancelled
```

### 7.3 Task and listing lifecycles

```
Task:     queued -> assigned -> in-progress -> done
                                  │            failed (after 3 attempts, or non-retryable)
                                  │            cancelled (upstream failed, venture killed/paused)
                                  └-> awaiting-approval -> approved -> done
                                                        -> rejected
Listing:  draft -> awaiting-approval -> live -> delisted
                                     -> rejected
Venture:  incubating -> active <-> scaling
          any live   -> paused (human) -> active/scaling (human)
          any live   -> killed (HERMES or human; terminal, cannot be revived)
Agent:    idle -> walking -> working -> idle
                             working -> blocked (awaiting approval) -> idle
          idle -> resting (budget exhausted, or restTicks after a failure) -> idle
```

## 8. Brains

`Brain.run(task, ctx)` returns a `TaskOutput` (`summary`, `files`, `data`, optional `quality`) validated with zod. The context gives a brain a confined workspace, the outputs of its dependencies, a logger, `speak()`, `waitTicks()`, `reportUsage()` and `requestApproval()`.

- `ScriptedBrain` (sim): instant, deterministic, writes SVG artwork, markdown articles and JSON specs, emits speech lines. Costs `estimateTaskCostCents`.
- `ClaudeBrain` (live): `client.beta.messages.toolRunner` with `write_file`, `read_file`, `list_files`, `submit_output`, and `web_search` for scouts when `ALLOW_WEB_SEARCH=true`. Model from `WORKER_MODEL`, adaptive thinking, medium effort, 16k max tokens. Real `usage` is billed to the ledger and the agent's stats.

## 9. Wire protocol

Server to client: `snapshot` first, then incremental `StationEvent`s (`tick`, `treasury.updated`, `venture.upserted`, `agent.moved`, `agent.speech`, `task.upserted`, `listing.upserted`, `approval.requested`, `approval.decided`, `ledger.entry`, `sale`, `overseer.directive`, `overseer.thinking`, `milestone.reached`, `log`, `command.ok`, `command.rejected`).

Client to server: `StationCommand`, validated with `StationCommandSchema`: approve or reject one or all approvals up to a risk level, set venture status, spawn a venture, instruct HERMES, hire or dismiss, pause, resume, set speed, set target, request a snapshot.

REST: `GET /api/health`, `GET /api/state`, `GET /api/capabilities`, `GET /api/ledger?sinceTick=&limit=`, `POST /api/command`, `GET /ws`.

## 10. Failure modes and what the system does

| Failure | Behaviour | Where |
|---|---|---|
| Brain throws a retryable error | Task requeued, up to 3 attempts; agent rests 4 ticks (or the error's `restTicks` for rate limits) | `work.ts` |
| Brain fails permanently | Task `failed`, dependents cancelled with a reason, venture keeps running its next cycle | `work.ts` |
| Brain returns malformed output | Treated as retryable `BrainError` | `brains/types.ts` |
| Claude Overseer errors or times out | Deterministic plan applied, warning logged | `overseer/engine.ts` |
| Adapter rejects a listing after approval | Task fails retryable, listing stays `awaiting-approval` | `effects.ts` |
| Sales poll fails (live) | Warning logged, retried next interval | `station.ts` |
| Daily token budget exhausted | Idle crew rest until the next sim day; HERMES logs once per day | `station.ts` |
| Crash mid-task | On boot, `assigned` and `in-progress` tasks requeue; blocked agents waiting on approvals stay blocked | `work.ts recover()` |
| Path escape attempt | `WorkspaceError`, task fails | `workspace.ts` |
| Invalid command from the client | `command.rejected` with the zod message | `api.ts` |
| Human tries to revive a killed venture | Refused: killed is terminal | `station.ts` |
| Client disconnects | Exponential reconnect, `snapshot.request` on reconnect; server owns all positions | `apps/station/src/net.ts` |

What the system does not protect you from: a platform ban, a niche with no demand, and approving things you did not read. Those are covered in `04-platform-constraints.md` and `05-runbook.md`.
