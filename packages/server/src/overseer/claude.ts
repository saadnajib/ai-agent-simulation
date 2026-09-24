/**
 * ClaudeOverseer: live-mode advisor to the deterministic allocator. It reads
 * the metrics summary plus any human instructions and proposes structured
 * actions; the engine validates them against policy before applying.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import type { OverseerAction } from '@eternity/core';

const ventureStatus = z.enum(['incubating', 'active', 'scaling', 'paused', 'killed']);
const ventureKind = z.enum(['pod-store', 'game-assets', 'thumbnail-service', 'affiliate-blog', 'software-templates', 'music-packs']);
const agentRole = z.enum(['overseer', 'scout', 'designer', 'pixel-artist', 'thumbnail-artist', 'writer', 'engineer', 'composer', 'marketer', 'reviewer']);

/**
 * Structured-output schema. `enqueue-task` and `assign-agent` are deliberately
 * excluded: the Overseer allocates capital, it does not micromanage crews.
 */
export const OverseerActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('set-budget-share'), ventureId: z.string(), share: z.number().min(0).max(1) }),
  z.object({ type: z.literal('set-status'), ventureId: z.string(), status: ventureStatus, reason: z.string().max(300) }),
  z.object({ type: z.literal('spawn-venture'), kind: ventureKind, thesis: z.string().min(3).max(300), name: z.string().min(1).max(80) }),
  z.object({ type: z.literal('hire'), role: agentRole, ventureId: z.string().optional() }),
  z.object({ type: z.literal('broadcast'), message: z.string().min(1).max(500) }),
]);

export const OverseerProposalSchema = z.object({
  rationale: z.string().min(1).max(4000),
  actions: z.array(OverseerActionSchema).max(24),
});

export type OverseerProposal = z.infer<typeof OverseerProposalSchema>;

export interface OverseerInput {
  tick: number;
  summary: string;
  deterministicActions: OverseerAction[];
  instructions: string[];
  policyText: string;
}

export interface ClaudeOverseerOptions {
  model: string;
  maxTokens?: number;
}

export class ClaudeOverseer {
  readonly model: string;
  private readonly system: string;
  private readonly maxTokens: number;

  constructor(
    private readonly client: Anthropic,
    opts: ClaudeOverseerOptions,
  ) {
    this.model = opts.model;
    this.maxTokens = opts.maxTokens ?? 16_000;
    this.system = readFileSync(fileURLToPath(new URL('./prompt.md', import.meta.url)), 'utf8').trim();
  }

  /** Returns null when the model refuses, fails to parse, or the API is unavailable. */
  async propose(input: OverseerInput): Promise<{ proposal: OverseerProposal | null; tokensIn: number; tokensOut: number; error?: string }> {
    try {
      const response = await this.client.messages.parse({
        model: this.model,
        max_tokens: this.maxTokens,
        thinking: { type: 'adaptive' },
        output_config: { effort: 'high', format: zodOutputFormat(OverseerProposalSchema) },
        system: [{ type: 'text', text: this.system, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: buildOverseerBrief(input) }],
      });
      const tokensIn = response.usage.input_tokens + (response.usage.cache_creation_input_tokens ?? 0) + (response.usage.cache_read_input_tokens ?? 0);
      const tokensOut = response.usage.output_tokens;
      if (response.stop_reason === 'refusal') {
        return { proposal: null, tokensIn, tokensOut, error: 'refusal' };
      }
      if (response.parsed_output === null) {
        return { proposal: null, tokensIn, tokensOut, error: `unparseable (${response.stop_reason ?? 'unknown'})` };
      }
      return { proposal: response.parsed_output, tokensIn, tokensOut };
    } catch (error) {
      return { proposal: null, tokensIn: 0, tokensOut: 0, error: describeError(error) };
    }
  }
}

function buildOverseerBrief(input: OverseerInput): string {
  const instructions = input.instructions.length > 0 ? input.instructions.map((t, i) => `${i + 1}. ${t}`).join('\n') : '(none)';
  return [
    `Epoch at tick ${input.tick}.`,
    ``,
    `Policy:`,
    input.policyText,
    ``,
    `Station metrics:`,
    input.summary,
    ``,
    `Deterministic plan already computed (apply unless you have a metric-grounded reason to adjust):`,
    JSON.stringify(input.deterministicActions, null, 2),
    ``,
    `Operator instructions pending:`,
    instructions,
    ``,
    `Return your adjustments. Emit only actions that differ from or add to the plan.`,
  ].join('\n');
}

function describeError(error: unknown): string {
  if (error instanceof Anthropic.RateLimitError) return 'rate limited';
  if (error instanceof Anthropic.AuthenticationError) return 'authentication failed';
  if (error instanceof Anthropic.APIConnectionError) return 'connection failed';
  if (error instanceof Anthropic.APIError) return `api error ${error.status ?? ''}: ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}
