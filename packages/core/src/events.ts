/**
 * Wire protocol between the station server and the game client.
 *
 * Server -> client: StationEvent (JSON over WebSocket). The first message on
 * every connection is a full `snapshot`; everything after is incremental.
 *
 * Client -> server: StationCommand. Validated with zod on the server; anything
 * that fails validation is answered with a `command.rejected` event.
 */
import { z } from 'zod';
import type {
  ApprovalRequest,
  CrewAgent,
  GridPosition,
  LedgerEntry,
  Listing,
  OverseerDirective,
  RoomId,
  StationState,
  Task,
  Treasury,
  Venture,
  VentureStatus,
  AgentRole,
} from './types.js';

// ---------------------------------------------------------------------------
// Server -> client
// ---------------------------------------------------------------------------

export type StationEvent =
  | { type: 'snapshot'; state: StationState }
  | { type: 'tick'; tick: number; simTime: string; paused: boolean; speed: number }
  | { type: 'treasury.updated'; treasury: Treasury }
  | { type: 'venture.upserted'; venture: Venture }
  | { type: 'venture.removed'; ventureId: string }
  | { type: 'agent.upserted'; agent: CrewAgent }
  | { type: 'agent.moved'; agentId: string; from: GridPosition; to: GridPosition; roomId: RoomId }
  | { type: 'agent.speech'; agentId: string; text: string; ttlTicks: number }
  | { type: 'task.upserted'; task: Task }
  | { type: 'listing.upserted'; listing: Listing }
  | { type: 'approval.requested'; approval: ApprovalRequest }
  | { type: 'approval.decided'; approval: ApprovalRequest }
  | { type: 'ledger.entry'; entry: LedgerEntry }
  | {
      type: 'sale';
      ventureId: string;
      listingId: string;
      platform: string;
      grossCents: number;
      netCents: number;
      itemTitle: string;
      tick: number;
    }
  | { type: 'overseer.directive'; directive: OverseerDirective }
  | { type: 'overseer.thinking'; text: string }
  | { type: 'milestone.reached'; label: string; cents: number; tick: number }
  | { type: 'log'; level: 'debug' | 'info' | 'warn' | 'error'; message: string; agentId?: string; tick: number }
  | { type: 'command.rejected'; reason: string; command?: unknown }
  | { type: 'command.ok'; commandType: string };

export type StationEventType = StationEvent['type'];

// ---------------------------------------------------------------------------
// Client -> server
// ---------------------------------------------------------------------------

const ventureStatus = z.enum(['incubating', 'active', 'scaling', 'paused', 'killed']);
const agentRole = z.enum([
  'overseer',
  'scout',
  'designer',
  'pixel-artist',
  'thumbnail-artist',
  'writer',
  'engineer',
  'composer',
  'marketer',
  'reviewer',
]);

export const StationCommandSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('approval.decide'),
    approvalId: z.string().min(1),
    decision: z.enum(['approved', 'rejected']),
    note: z.string().max(2000).optional(),
  }),
  z.object({
    type: z.literal('approval.decide-all'),
    decision: z.enum(['approved', 'rejected']),
    /** Only decide requests at or below this risk level. */
    maxRisk: z.enum(['low', 'medium', 'high']).default('low'),
  }),
  z.object({
    type: z.literal('venture.set-status'),
    ventureId: z.string().min(1),
    status: ventureStatus,
    reason: z.string().max(500).optional(),
  }),
  z.object({
    type: z.literal('venture.spawn'),
    kind: z.enum([
      'pod-store',
      'game-assets',
      'thumbnail-service',
      'affiliate-blog',
      'software-templates',
      'music-packs',
    ]),
    thesis: z.string().min(3).max(300),
    name: z.string().min(1).max(80).optional(),
  }),
  z.object({
    type: z.literal('overseer.instruct'),
    text: z.string().min(1).max(4000),
  }),
  z.object({
    type: z.literal('agent.hire'),
    role: agentRole,
    ventureId: z.string().optional(),
  }),
  z.object({
    type: z.literal('agent.dismiss'),
    agentId: z.string().min(1),
  }),
  z.object({ type: z.literal('clock.pause') }),
  z.object({ type: z.literal('clock.resume') }),
  z.object({
    type: z.literal('clock.speed'),
    speed: z.union([z.literal(1), z.literal(4), z.literal(16), z.literal(64)]),
  }),
  z.object({
    type: z.literal('treasury.set-target'),
    targetCents: z.number().int().positive(),
  }),
  z.object({ type: z.literal('snapshot.request') }),
]);

export type StationCommand = z.infer<typeof StationCommandSchema>;
export type StationCommandType = StationCommand['type'];

/** Narrow helper for exhaustive switches in the client. */
export type EventOf<T extends StationEventType> = Extract<StationEvent, { type: T }>;

// Re-exported so the client can type-check role/status literals without importing zod schemas.
export type { AgentRole, VentureStatus };
