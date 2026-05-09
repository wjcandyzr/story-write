import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

/** 段落切分:超长段二次切到 200 字以内,空段过滤。 */
function chunkByParagraphs(text: string, maxLen = 200): string[] {
  const out: string[] = [];
  for (const para of text.split(/(\n+)/)) {
    if (!para) continue;
    if (para.length <= maxLen) out.push(para);
    else {
      for (let i = 0; i < para.length; i += maxLen) out.push(para.slice(i, i + maxLen));
    }
  }
  return out;
}

export interface LlmInvokeOptions {
  temperature?: number;
  model?: string;
  maxTokens?: number;
  /** Total timeout (ms) for non-streaming calls. Defaults to env LLM_TIMEOUT_MS. */
  timeout?: number;
  /** External cancellation — passed through to the SDK as { signal }. */
  signal?: AbortSignal;
}

/**
 * 流式调用的 chunk:既可能是正文 token,也可能是模型的"思考过程"。
 * thinking 模型会把推理放在 delta.reasoning_content,正文在 delta.content。
 */
export type LlmStreamChunk =
  | { kind: 'content'; value: string }
  | { kind: 'reasoning'; value: string };

export interface LlmCompleteResult {
  content: string;
  reasoning?: string;
}

/**
 * 直接用 openai 官方 SDK,等同于:
 *
 *   curl https://api.deepseek.com/chat/completions \
 *     -H "Authorization: Bearer ..." \
 *     -d '{ "model":"deepseek-v4-flash", "messages":[...], "thinking":{"type":"disabled"}, "stream":true }'
 *
 * `thinking` / `reasoning_effort` 这种非标准字段通过 extraBody() 直接拼到 body 里,
 * 没有 LangChain 这一层在中间转译。
 */
@Injectable()
export class LlmService implements OnModuleInit {
  private readonly logger = new Logger(LlmService.name);
  private client!: OpenAI;

  constructor(private readonly cfg: ConfigService) {}

  onModuleInit() {
    this.client = new OpenAI({
      apiKey: this.cfg.get<string>('OPENAI_API_KEY'),
      baseURL: this.cfg.get<string>('OPENAI_BASE_URL'),
      timeout: this.defaultTimeout,
      maxRetries: 1,
    });
    this.logger.log(
      `LLM client ready · base=${this.cfg.get('OPENAI_BASE_URL')} model=${this.cfg.get('LLM_MODEL')}`,
    );
  }

  private get defaultTimeout(): number {
    return Number(this.cfg.get('LLM_TIMEOUT_MS') ?? 60_000);
  }

  private get streamStallMs(): number {
    return Number(this.cfg.get('LLM_STREAM_STALL_MS') ?? 45_000);
  }

  /**
   * 把 thinking / reasoning_effort 等非标准 body 字段拼在一起。
   * 跟 curl 例子里的字段名 / 位置完全一致。
   */
  private extraBody(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    const thinking = this.cfg.get<string>('LLM_THINKING');
    if (thinking === 'disabled' || thinking === 'enabled') {
      out.thinking = { type: thinking };
    }
    const effort = this.cfg.get<string>('LLM_REASONING_EFFORT');
    if (effort) out.reasoning_effort = effort;
    return out;
  }

  /** 非流式调用 — 等价 curl + stream:false。返回 content 字符串(reasoning 丢弃)。 */
  async complete(system: string, user: string, opts?: LlmInvokeOptions): Promise<string> {
    const r = await this.completeFull(system, user, opts);
    return r.content;
  }

  /**
   * 同 complete(),但同时带回 reasoning_content(若模型支持思考模式)。
   * fakeStream() 用它来在非流式路径上也能把思考过程展示给用户。
   */
  async completeFull(
    system: string,
    user: string,
    opts?: LlmInvokeOptions,
  ): Promise<LlmCompleteResult> {
    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ];
    const body = {
      model: opts?.model ?? this.cfg.get<string>('LLM_MODEL', 'gpt-4o-mini'),
      messages,
      temperature: opts?.temperature ?? this.cfg.get<number>('LLM_TEMPERATURE', 0.8),
      max_tokens: opts?.maxTokens,
      stream: false,
      ...this.extraBody(),
    } as unknown as Parameters<OpenAI['chat']['completions']['create']>[0];

    try {
      const res = (await this.client.chat.completions.create(body, {
        signal: opts?.signal,
        timeout: opts?.timeout ?? this.defaultTimeout,
      })) as {
        choices: {
          message: {
            content: string | null;
            reasoning_content?: string | null;
          };
        }[];
      };

      const msg = res.choices?.[0]?.message ?? { content: '' };
      return {
        content: typeof msg.content === 'string' ? msg.content : '',
        reasoning:
          typeof msg.reasoning_content === 'string' && msg.reasoning_content.length > 0
            ? msg.reasoning_content
            : undefined,
      };
    } catch (e) {
      this.classifyAndRethrow(e, 'LLM complete');
    }
  }

  /**
   * 流式调用 — 等价 curl + stream:true。
   *  - 透传外部 signal(用户中断)
   *  - 内置 stall 看门狗:N 毫秒没新 token 就 abort 上游
   *  - LLM_FAKE_STREAM=true 时改走非流式 + 段落分批 emit(对不支持 SSE 的模型)
   */
  async *stream(
    system: string,
    user: string,
    opts?: LlmInvokeOptions,
  ): AsyncGenerator<LlmStreamChunk> {
    if (this.cfg.get('LLM_FAKE_STREAM') === 'true') {
      yield* this.fakeStream(system, user, opts);
      return;
    }

    const stallMs = this.streamStallMs;
    const ctrl = new AbortController();
    const onExternalAbort = () => ctrl.abort(opts?.signal?.reason);
    if (opts?.signal) {
      if (opts.signal.aborted) ctrl.abort(opts.signal.reason);
      else opts.signal.addEventListener('abort', onExternalAbort, { once: true });
    }

    let stallTimer: NodeJS.Timeout | null = null;
    const armStall = () => {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        this.logger.warn(`LLM stream stalled > ${stallMs}ms, aborting`);
        ctrl.abort(new Error(`LLM stream stalled > ${stallMs}ms`));
      }, stallMs);
    };
    const disarm = () => {
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = null;
      opts?.signal?.removeEventListener('abort', onExternalAbort);
    };

    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ];

    const t0 = Date.now();
    let firstChunkLogged = false;
    let chunkCount = 0;

    const body = {
      model: opts?.model ?? this.cfg.get<string>('LLM_MODEL', 'gpt-4o-mini'),
      messages,
      temperature: opts?.temperature ?? this.cfg.get<number>('LLM_TEMPERATURE', 0.8),
      max_tokens: opts?.maxTokens,
      stream: true,
      ...this.extraBody(),
    } as unknown as Parameters<OpenAI['chat']['completions']['create']>[0];

    try {
      armStall();
      const stream = (await this.client.chat.completions.create(body, {
        signal: ctrl.signal,
        timeout: 0,
      })) as AsyncIterable<{
        choices: {
          delta: {
            content?: string | null;
            // 思考模式:DeepSeek / GPT-O 系列把 reasoning 放在这里。
            reasoning_content?: string | null;
          };
        }[];
      }>;

      this.logger.debug(`LLM stream opened after ${Date.now() - t0}ms`);

      for await (const chunk of stream) {
        armStall();
        chunkCount++;
        const delta = chunk.choices?.[0]?.delta;
        if (!delta) continue;

        // 思考链 token —— 早于正文出现,先 yield 出去给 UI 显示
        if (typeof delta.reasoning_content === 'string' && delta.reasoning_content.length > 0) {
          yield { kind: 'reasoning', value: delta.reasoning_content };
        }
        // 正文 token
        if (typeof delta.content === 'string' && delta.content.length > 0) {
          if (!firstChunkLogged) {
            this.logger.log(`LLM first content chunk after ${Date.now() - t0}ms`);
            firstChunkLogged = true;
          }
          yield { kind: 'content', value: delta.content };
        }
      }
      this.logger.debug(`LLM stream done after ${Date.now() - t0}ms, ${chunkCount} chunks`);
    } catch (e) {
      this.logger.warn(
        `LLM stream failed at ${Date.now() - t0}ms (chunks=${chunkCount}, firstChunk=${firstChunkLogged})`,
      );
      this.classifyAndRethrow(e, 'LLM stream');
    } finally {
      disarm();
    }
  }

  /**
   * 模拟流式:一次拉完整文本,按段落分批 yield 给上层。
   * 拿到 reasoning_content 时,先把 reasoning 段落 yield 出去,再 yield 正文。
   * 这样即使走非流式,前端也能拿到分阶段呈现的"思考过程 → 正文"序列。
   */
  private async *fakeStream(
    system: string,
    user: string,
    opts?: LlmInvokeOptions,
  ): AsyncGenerator<LlmStreamChunk> {
    const t0 = Date.now();
    this.logger.log('LLM fake-stream: invoking completeFull()');
    const { content, reasoning } = await this.completeFull(system, user, opts);
    this.logger.log(
      `LLM fake-stream: got ${content.length} chars content` +
        (reasoning ? `, ${reasoning.length} chars reasoning` : '') +
        ` in ${Date.now() - t0}ms`,
    );

    if (reasoning) {
      for (const r of chunkByParagraphs(reasoning)) {
        if (opts?.signal?.aborted) return;
        yield { kind: 'reasoning', value: r };
      }
    }
    for (const c of chunkByParagraphs(content)) {
      if (opts?.signal?.aborted) return;
      yield { kind: 'content', value: c };
    }
  }

  /**
   * 把 SDK 抛出来的各种错码翻译成给前端能直接看的中文,堆栈仍打到日志。
   */
  private classifyAndRethrow(e: unknown, scope: string): never {
    const err = e as Error & { code?: string; status?: number };
    const code = err?.code ?? '';
    const status = err?.status ?? 0;

    let label = `${scope} failed`;
    if (code === 'ECONNREFUSED' || code === 'ENOTFOUND') {
      label = `${scope}: 无法连接到 LLM 服务 (${code}) — 检查网络 / OPENAI_BASE_URL`;
    } else if (code === 'ETIMEDOUT' || /timeout/i.test(err?.message ?? '')) {
      label = `${scope}: 调用超时,LLM 长时间无响应`;
    } else if (status === 401 || status === 403) {
      label = `${scope}: API key 无效或权限不足 (HTTP ${status})`;
    } else if (status === 404) {
      label = `${scope}: 模型不存在 (HTTP 404) — 检查 LLM_MODEL`;
    } else if (status === 429) {
      label = `${scope}: 触发速率限制 (HTTP 429)`;
    } else if (err?.message) {
      label = `${scope}: ${err.message}`;
    }

    this.logger.error(label, err?.stack);
    const out = new Error(label);
    (out as Error & { cause?: unknown }).cause = e;
    throw out;
  }
}
