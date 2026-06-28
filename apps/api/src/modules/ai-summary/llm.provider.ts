/**
 * LLM provider abstraction. Default is Anthropic Claude Sonnet 4.6.
 * Other providers (OpenAI, local) implement the same interface so we can
 * swap per workspace plan or per workspace-level preference.
 *
 * All providers MUST return structured output that conforms to
 * AiSummaryPayload — the service validates the response with Zod before
 * persisting.
 */
import { Injectable } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { env } from '@vsp/config';
import { AiSummaryPayload, type AiSummaryPayloadDto } from '@vsp/contracts';
import { createLogger } from '@vsp/logger';

const log = createLogger('llm');

export type LlmCommentInput = {
  id: string;
  timeMs: number;
  body: string;
  authorName: string | null;
};

export type LlmResult = {
  payload: AiSummaryPayloadDto;
  tokensIn: number;
  tokensOut: number;
  costCents: number;
  model: string;
  provider: string;
};

const SYSTEM_PROMPT = `You are a senior video post-production lead. You will receive a chronological list of client review comments on a video cut. Group them into editing categories (voiceover, color, editing, graphics, audio, pacing, other), assess priority (high|medium|low) per category, and identify clusters of comments that all suggest the same fix.

Be terse. Output exactly the JSON schema requested via the provided tool. Do not include filler text.`;

const TOOL = {
  name: 'submit_review_summary',
  description: 'Submit the structured review summary.',
  input_schema: {
    type: 'object' as const,
    properties: {
      categories: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', enum: ['voiceover', 'color', 'editing', 'graphics', 'audio', 'pacing', 'other'] },
            priority: { type: 'string', enum: ['high', 'medium', 'low'] },
            issues: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  summary: { type: 'string' },
                  timestamps: { type: 'array', items: { type: 'string' } },
                  commentIds: { type: 'array', items: { type: 'string' } },
                },
                required: ['summary', 'timestamps', 'commentIds'],
              },
            },
          },
          required: ['name', 'priority', 'issues'],
        },
      },
      topPriority: { type: 'string' },
      duplicateClusters: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            commentIds: { type: 'array', items: { type: 'string' } },
            theme: { type: 'string' },
          },
          required: ['commentIds', 'theme'],
        },
      },
    },
    required: ['categories', 'topPriority'],
  },
};

@Injectable()
export class LlmProvider {
  private readonly anthropic: Anthropic | null;

  constructor() {
    this.anthropic = env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }) : null;
  }

  async summarize(comments: LlmCommentInput[]): Promise<LlmResult> {
    if (!this.anthropic) throw new Error('LLM provider not configured (ANTHROPIC_API_KEY)');

    const formatTime = (ms: number) => {
      const s = Math.floor(ms / 1000);
      const m = Math.floor(s / 60);
      return `${m}:${String(s % 60).padStart(2, '0')}`;
    };

    const transcript = comments
      .map((c) => `[id=${c.id}] [${formatTime(c.timeMs)}] ${c.authorName ?? 'Reviewer'}: ${c.body}`)
      .join('\n');

    const r = await this.anthropic.messages.create({
      model: env.AI_DEFAULT_MODEL,
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      tools: [TOOL],
      tool_choice: { type: 'tool', name: 'submit_review_summary' },
      messages: [{ role: 'user', content: `Comments:\n${transcript}` }],
    });

    const toolUse = r.content.find((c): c is Anthropic.ToolUseBlock => c.type === 'tool_use');
    if (!toolUse) throw new Error('LLM did not call submit_review_summary');

    const parsed = AiSummaryPayload.parse(toolUse.input);

    // Sonnet 4.6 rough cost: $3/M input, $15/M output (illustrative — actuals via billing API).
    const tokensIn = r.usage.input_tokens;
    const tokensOut = r.usage.output_tokens;
    const costCents = Math.ceil((tokensIn * 0.3) / 1000 + (tokensOut * 1.5) / 1000);

    log.info({ tokensIn, tokensOut, costCents }, 'ai summary generated');

    return {
      payload: parsed,
      tokensIn,
      tokensOut,
      costCents,
      model: env.AI_DEFAULT_MODEL,
      provider: env.AI_PROVIDER,
    };
  }
}
