/**
 * OpenAI text drafting (owner request 23 Oct 2026, D-014). Server only: the key is read from the
 * root `.env` here and never returned, logged, audited or sent to a browser. Without
 * OPENAI_API_KEY and OPENAI_MODEL the adapter is `not_configured` and drafts nothing — there is
 * no default model and no fake draft. One call to the Responses API (POST /responses) with a
 * strict JSON schema; `store: false` so OpenAI does not keep the response for later retrieval.
 */
import { InternalError } from '@elevate/shared-contracts';
import { AI_FAILED } from '../../domain/ai-assist';

export type AiFailure = 'timeout' | 'upstream_error' | 'invalid_output';

/** Shown to the person as AI_FAILED; `reason` goes to the audit row (never the upstream text). */
export class AiDraftError extends InternalError {
  constructor(readonly reason: AiFailure) {
    super(AI_FAILED);
  }
}

export interface AiRequest {
  /** Schema name (letters, digits, `_`). */
  name: string;
  instructions: string;
  input: string;
  /** JSON schema of the answer (strict: every property required, no extra properties). */
  schema: Record<string, unknown>;
}

export interface AiAssist {
  readonly status: 'configured' | 'not_configured';
  /** The parsed JSON answer; throws AiDraftError on timeout, an upstream error or bad output. */
  draft(req: AiRequest): Promise<unknown>;
}

type ResponsesBody = {
  status?: string;
  output?: { type: string; content?: { type: string; text?: string }[] }[];
};

export function aiAssist(env: Record<string, string | undefined> = process.env): AiAssist {
  const key = env.OPENAI_API_KEY?.trim();
  const model = env.OPENAI_MODEL?.trim();
  const base = (env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1').replace(/\/+$/, '');
  // The key is only ever sent over https (plain http only to this machine, for local testing).
  const safe = /^https:\/\/|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(base);
  if (!key || !model || !safe)
    return {
      status: 'not_configured',
      draft: () => Promise.reject(new AiDraftError('upstream_error')),
    };
  const timeout = Number(env.OPENAI_TIMEOUT_MS) || 20_000;
  return {
    status: 'configured',
    async draft(req) {
      let body: ResponsesBody;
      try {
        const res = await fetch(`${base}/responses`, {
          method: 'POST',
          headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            model,
            instructions: req.instructions,
            input: req.input,
            store: false,
            max_output_tokens: 2000,
            text: {
              format: { type: 'json_schema', name: req.name, schema: req.schema, strict: true },
            },
          }),
          signal: AbortSignal.timeout(timeout),
        });
        if (!res.ok) throw new AiDraftError('upstream_error');
        body = (await res.json()) as ResponsesBody;
      } catch (e) {
        if (e instanceof AiDraftError) throw e;
        throw new AiDraftError(
          e instanceof DOMException && e.name === 'TimeoutError' ? 'timeout' : 'upstream_error',
        );
      }
      // A refusal or a cut-off answer has no complete output_text.
      const text = body.output
        ?.find((o) => o.type === 'message')
        ?.content?.find((c) => c.type === 'output_text')?.text;
      if (body.status !== 'completed' || !text) throw new AiDraftError('invalid_output');
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new AiDraftError('invalid_output');
      }
    },
  };
}
