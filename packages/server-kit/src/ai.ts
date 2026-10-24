/**
 * AI text drafting (D-092; providers D-110). Server only: the keys are read from the root `.env`
 * here and never returned, logged, audited or sent to a browser. Providers are tried in order —
 * Groq, Gemini, OpenRouter — each only when both its key and its model are set (no default model,
 * no fake draft); a failure (quota, outage, timeout, bad output) moves on to the next one.
 * Groq and OpenRouter take the OpenAI Chat Completions format, Gemini its own generateContent;
 * all three are asked for JSON matching the schema, which the caller validates again.
 * A PDF (score sheets, owner answer 6) goes only to providers that read files (not Groq).
 * Shared by every app (`@elevate/server-kit/ai`, D-111); each caller masks names first, checks
 * its own permission and limits, audits the request and validates the answer.
 */
import { InternalError } from '@elevate/shared-contracts';

export const AI_NOT_SET_UP = 'AI drafting is not set up.';
export const AI_FAILED = "AI drafting didn't respond. Try again or write it yourself.";

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
  /** A PDF sent with the text (base64, no data: prefix). */
  file?: { name: string; base64: string };
  /** Default 2000 output tokens and AI_TIMEOUT_MS (20 s) per provider. */
  maxOutputTokens?: number;
  timeoutMs?: number;
}

export interface AiAssist {
  readonly status: 'configured' | 'not_configured';
  /** The parsed JSON answer; throws AiDraftError on timeout, an upstream error or bad output. */
  draft(req: AiRequest): Promise<unknown>;
}

type Call = { url: string; headers: Record<string, string>; body: unknown };
type Provider = {
  env: string;
  base: string;
  files: boolean;
  call(base: string, key: string, model: string, req: AiRequest): Call;
  /** The answer text, or undefined when it is missing, refused or cut off. */
  text(body: unknown): string | undefined;
};

const chat = (base: string, key: string, model: string, req: AiRequest, extra = {}): Call => ({
  url: `${base}/chat/completions`,
  headers: { authorization: `Bearer ${key}` },
  body: {
    model,
    max_tokens: req.maxOutputTokens ?? 2000,
    messages: [
      { role: 'system', content: req.instructions },
      {
        role: 'user',
        content: req.file
          ? [
              {
                type: 'file',
                file: {
                  filename: req.file.name,
                  file_data: `data:application/pdf;base64,${req.file.base64}`,
                },
              },
              { type: 'text', text: req.input },
            ]
          : req.input,
      },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: req.name, schema: req.schema, strict: true },
    },
    ...extra,
  },
});
type ChatBody = { choices?: { finish_reason?: string; message?: { content?: string | null } }[] };
const chatText = (body: unknown) => {
  const c = (body as ChatBody).choices?.[0];
  return c?.finish_reason === 'stop' ? (c.message?.content ?? undefined) : undefined;
};

const PROVIDERS: Provider[] = [
  {
    env: 'GROQ',
    base: 'https://api.groq.com/openai/v1',
    files: false,
    call: chat,
    text: chatText,
  },
  {
    env: 'GEMINI',
    base: 'https://generativelanguage.googleapis.com/v1beta',
    files: true,
    call: (base, key, model, req) => ({
      url: `${base}/models/${encodeURIComponent(model)}:generateContent`,
      headers: { 'x-goog-api-key': key },
      body: {
        systemInstruction: { parts: [{ text: req.instructions }] },
        contents: [
          {
            role: 'user',
            parts: [
              ...(req.file
                ? [{ inline_data: { mime_type: 'application/pdf', data: req.file.base64 } }]
                : []),
              { text: req.input },
            ],
          },
        ],
        generationConfig: {
          maxOutputTokens: req.maxOutputTokens ?? 2000,
          responseMimeType: 'application/json',
          responseJsonSchema: req.schema,
        },
      },
    }),
    text: (body) => {
      const c = (
        body as {
          candidates?: { finishReason?: string; content?: { parts?: { text?: string }[] } }[];
        }
      ).candidates?.[0];
      return c?.finishReason === 'STOP'
        ? c.content?.parts?.map((p) => p.text ?? '').join('') || undefined
        : undefined;
    },
  },
  {
    env: 'OPENROUTER',
    base: 'https://openrouter.ai/api/v1',
    files: true,
    // The free text parser reads PDFs for any model (the default engine is paid OCR).
    call: (base, key, model, req) =>
      chat(base, key, model, req, {
        ...(req.file && { plugins: [{ id: 'file-parser', pdf: { engine: 'pdf-text' } }] }),
      }),
    text: chatText,
  },
];

// The key is only ever sent over https (plain http only to this machine, for local testing).
const SAFE = /^https:\/\/|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/;

async function attempt(p: Provider, c: Call, timeoutMs: number): Promise<unknown> {
  let body: unknown;
  try {
    const res = await fetch(c.url, {
      method: 'POST',
      headers: { ...c.headers, 'content-type': 'application/json' },
      body: JSON.stringify(c.body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new AiDraftError('upstream_error');
    body = await res.json();
  } catch (e) {
    if (e instanceof AiDraftError) throw e;
    throw new AiDraftError(
      e instanceof DOMException && e.name === 'TimeoutError' ? 'timeout' : 'upstream_error',
    );
  }
  // Some models wrap JSON in a ```json fence despite the schema.
  const text = p.text(body)?.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, '');
  if (!text) throw new AiDraftError('invalid_output');
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AiDraftError('invalid_output');
  }
}

export function aiAssist(env: Record<string, string | undefined> = process.env): AiAssist {
  const ready = PROVIDERS.flatMap((p) => {
    const key = env[`${p.env}_API_KEY`]?.trim();
    const model = env[`${p.env}_MODEL`]?.trim();
    const base = (env[`${p.env}_BASE_URL`]?.trim() || p.base).replace(/\/+$/, '');
    return key && model && SAFE.test(base) ? [{ p, key, model, base }] : [];
  });
  const timeout = Number(env.AI_TIMEOUT_MS) || 20_000;
  return {
    status: ready.length ? 'configured' : 'not_configured',
    async draft(req) {
      let last = new AiDraftError('upstream_error');
      for (const { p, key, model, base } of ready.filter((r) => !req.file || r.p.files)) {
        try {
          return await attempt(p, p.call(base, key, model, req), req.timeoutMs ?? timeout);
        } catch (e) {
          if (!(e instanceof AiDraftError)) throw e;
          last = e;
        }
      }
      throw last;
    },
  };
}
