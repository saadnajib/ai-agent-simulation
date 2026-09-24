/**
 * ClaudeBrain: live-mode worker. Drives `client.beta.messages.toolRunner`
 * with confined file tools and a structured `submit_output` tool. The client
 * is constructed once in index.ts; this module never reads process.env.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import type { AgentRole, Task, TaskKind, TaskOutput } from '@eternity/core';
import { BrainError, TaskOutputSchema, type Brain, type BrainContext } from './types.js';

export interface ClaudeBrainOptions {
  model: string;
  allowWebSearch: boolean;
  maxIterations?: number;
  maxTokens?: number;
}

const DEFAULT_MAX_ITERATIONS = 24;
const DEFAULT_MAX_TOKENS = 16_000;
const RATE_LIMIT_REST_TICKS = 12;
const MAX_TOOL_CONTENT = 200_000;
const MAX_LISTING = 60;

/** Expected `data` shape per task kind, quoted to the model from CONTRACTS.md. */
export const DATA_SHAPES: Record<TaskKind, string> = {
  'research-niche': '{ niche: string; demandScore: 0..1; competition: 0..1; keywords: string[]; suggestedPriceCents: number; rationale: string }',
  'analyse-competitors': '{ niche: string; competitors: { name: string; priceCents: number; strengths: string[] }[]; gap: string }',
  'design-artwork': '{ title: string; description: string; niche: string; files: string[]; specs: Record<string, unknown> }',
  'design-thumbnail': '{ title: string; description: string; niche: string; files: string[]; specs: Record<string, unknown> }',
  'create-asset-pack': '{ title: string; description: string; niche: string; files: string[]; specs: Record<string, unknown> }',
  'compose-track': '{ title: string; description: string; niche: string; files: string[]; specs: Record<string, unknown> }',
  'build-template': '{ title: string; description: string; niche: string; files: string[]; specs: Record<string, unknown> }',
  'create-mockups': "{ productType: string; files: string[]; provider: 'printify' | 'printful' | 'mock' }",
  'write-article': '{ title: string; slug: string; wordCount: number; affiliateLinks: { product: string; url: string }[]; files: string[] }',
  'write-listing': '{ listing: { ventureId, storefrontId, platform, title, description, tags: string[], priceCents, unitCostCents, quality, niche, kind, assets: string[] } }',
  'review-output': '{ quality: 0..1; approved: boolean; notes: string[]; targetTaskId: string }',
  'publish-listing': '{ listingId: string }',
  'optimise-listing': '{ listingId: string; changes: Record<string, unknown> }',
  promote: '{ channel: string; posts: { text: string; url?: string }[] }',
  'fulfil-order': '{ orderId: string; deliverables: string[] }',
  'overseer-epoch': '{ directiveId: string }',
};

const PROMPT_FILES: Record<AgentRole, string> = {
  overseer: 'reviewer.md',
  scout: 'scout.md',
  designer: 'designer.md',
  'pixel-artist': 'pixel-artist.md',
  'thumbnail-artist': 'thumbnail-artist.md',
  writer: 'writer.md',
  engineer: 'engineer.md',
  composer: 'composer.md',
  marketer: 'marketer.md',
  reviewer: 'reviewer.md',
};

function loadPrompt(file: string): string {
  return readFileSync(fileURLToPath(new URL(`./prompts/${file}`, import.meta.url)), 'utf8').trim();
}

export class ClaudeBrain implements Brain {
  readonly name: string;
  private readonly prompts = new Map<AgentRole, string>();
  private readonly common: string;

  constructor(
    private readonly client: Anthropic,
    private readonly opts: ClaudeBrainOptions,
  ) {
    this.name = opts.model;
    this.common = loadPrompt('common.md');
  }

  systemPrompt(role: AgentRole): string {
    let prompt = this.prompts.get(role);
    if (prompt === undefined) {
      prompt = `${this.common}\n\n${loadPrompt(PROMPT_FILES[role])}`;
      this.prompts.set(role, prompt);
    }
    return prompt;
  }

  async run(task: Task, ctx: BrainContext): Promise<TaskOutput> {
    let submitted: TaskOutput | null = null;
    const tools = this.buildTools(ctx, (output) => {
      submitted = output;
    });
    const runner = this.client.beta.messages.toolRunner({
      model: this.opts.model,
      max_tokens: this.opts.maxTokens ?? DEFAULT_MAX_TOKENS,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
      system: [{ type: 'text', text: this.systemPrompt(ctx.agent.role), cache_control: { type: 'ephemeral' } }],
      tools,
      messages: [{ role: 'user', content: buildBrief(task, ctx) }],
      max_iterations: this.opts.maxIterations ?? DEFAULT_MAX_ITERATIONS,
    });

    let tokensIn = 0;
    let tokensOut = 0;
    const report = () => ctx.reportUsage({ model: this.opts.model, tokensIn, tokensOut });

    try {
      for await (const message of runner) {
        tokensIn += message.usage.input_tokens + (message.usage.cache_creation_input_tokens ?? 0) + (message.usage.cache_read_input_tokens ?? 0);
        tokensOut += message.usage.output_tokens;
        if (message.stop_reason === 'refusal') {
          report();
          throw new BrainError(`Model refused task ${task.kind}`, { retryable: false });
        }
        if (message.stop_reason === 'pause_turn') {
          runner.pushMessages({ role: 'assistant', content: message.content });
          continue;
        }
        if (submitted !== null) break;
        if (message.stop_reason === 'max_tokens') {
          ctx.log('warn', `Turn hit max_tokens on ${task.kind}; continuing`);
        }
      }
    } catch (error) {
      report();
      throw translateError(error, task);
    }
    report();
    if (submitted === null) {
      throw new BrainError(`Task ${task.kind} ended without submit_output`, { retryable: true });
    }
    return submitted;
  }

  private buildTools(ctx: BrainContext, onSubmit: (output: TaskOutput) => void) {
    const writeFile = betaZodTool({
      name: 'write_file',
      description: 'Write a UTF-8 text file inside the venture workspace. Relative paths only; parent folders are created.',
      inputSchema: z.object({ path: z.string().min(1).max(512), content: z.string().max(MAX_TOOL_CONTENT) }),
      run: ({ path, content }) => {
        const rel = ctx.workspace.write(path, content);
        return `wrote ${rel} (${Buffer.byteLength(content)} bytes)`;
      },
    });
    const readFile = betaZodTool({
      name: 'read_file',
      description: 'Read a UTF-8 text file from the venture workspace by relative path.',
      inputSchema: z.object({ path: z.string().min(1).max(512) }),
      run: ({ path }) => {
        const text = ctx.workspace.read(path);
        return text.length > MAX_TOOL_CONTENT ? `${text.slice(0, MAX_TOOL_CONTENT)}\n[truncated]` : text;
      },
    });
    const listFiles = betaZodTool({
      name: 'list_files',
      description: 'List every file in the venture workspace as relative paths.',
      inputSchema: z.object({ prefix: z.string().max(256).optional().describe('Only list paths starting with this prefix.') }),
      run: ({ prefix }) => {
        const files = ctx.workspace.list().filter((f) => (prefix ? f.startsWith(prefix) : true));
        return files.length === 0 ? '(no files)' : files.slice(0, 500).join('\n');
      },
    });
    const submitOutput = betaZodTool({
      name: 'submit_output',
      description: 'Record the finished task output. Call exactly once when the work is complete; this ends the task.',
      inputSchema: TaskOutputSchema,
      run: (args) => {
        const output: TaskOutput = { summary: args.summary, files: args.files, data: args.data };
        if (args.quality !== undefined) output.quality = args.quality;
        onSubmit(output);
        return 'recorded';
      },
    });
    const tools: Parameters<Anthropic['beta']['messages']['toolRunner']>[0]['tools'] = [writeFile, readFile, listFiles, submitOutput];
    if (this.opts.allowWebSearch && ctx.agent.role === 'scout') {
      tools.push({ type: 'web_search_20260209', name: 'web_search', max_uses: 5 });
    }
    return tools;
  }
}

function buildBrief(task: Task, ctx: BrainContext): string {
  const deps = Object.entries(ctx.deps).map(([id, output]) => ({ taskId: id, summary: output.summary, files: output.files, data: output.data }));
  const files = ctx.workspace.list();
  const brief = {
    tick: ctx.tick,
    mode: ctx.mode,
    agent: { name: ctx.agent.name, role: ctx.agent.role },
    venture: {
      id: ctx.venture.id,
      name: ctx.venture.name,
      kind: ctx.venture.kind,
      thesis: ctx.venture.thesis,
      status: ctx.venture.status,
      storefronts: ctx.venture.storefronts.map((s) => ({ id: s.id, platform: s.platform, connected: s.connected })),
    },
    task: { id: task.id, kind: task.kind, title: task.title, input: task.input, dependsOn: task.dependsOn },
    upstream: deps,
    workspaceFiles: files.length > MAX_LISTING ? [...files.slice(0, MAX_LISTING), `... ${files.length - MAX_LISTING} more`] : files,
  };
  return [
    `Task brief (JSON):`,
    JSON.stringify(brief, null, 2),
    ``,
    `Expected \`data\` shape for ${task.kind}: ${DATA_SHAPES[task.kind]}`,
    `When done, call submit_output once. Files must be the relative paths you wrote.`,
  ].join('\n');
}

function translateError(error: unknown, task: Task): Error {
  if (error instanceof BrainError) return error;
  if (error instanceof Anthropic.RateLimitError) {
    return new BrainError(`Rate limited while running ${task.kind}`, { retryable: true, restTicks: RATE_LIMIT_REST_TICKS, cause: error });
  }
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    return new BrainError(`Credentials rejected (${error.status}) while running ${task.kind}`, { retryable: false, cause: error });
  }
  if (error instanceof Anthropic.BadRequestError || error instanceof Anthropic.UnprocessableEntityError) {
    return new BrainError(`Bad request (${error.status}) while running ${task.kind}: ${error.message}`, { retryable: false, cause: error });
  }
  if (error instanceof Anthropic.APIConnectionError || error instanceof Anthropic.InternalServerError) {
    return new BrainError(`Transient API failure while running ${task.kind}: ${error.message}`, { retryable: true, restTicks: 3, cause: error });
  }
  if (error instanceof Anthropic.APIError) {
    return new BrainError(`API error ${error.status ?? ''} while running ${task.kind}: ${error.message}`, { retryable: true, cause: error });
  }
  const message = error instanceof Error ? error.message : String(error);
  return new BrainError(`Brain failed on ${task.kind}: ${message}`, { retryable: true, cause: error });
}
