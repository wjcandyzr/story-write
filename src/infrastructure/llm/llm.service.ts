import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

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

  /** 非流式调用 — 等价 curl + stream:false */
  async complete(system: string, user: string, opts?: LlmInvokeOptions): Promise<string> {
    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ];
    // SDK 的 create() 是个泛型重载:stream:false 返回 ChatCompletion,stream:true 返回
    // Stream<ChatCompletionChunk>。两边的字段(choices[].message vs choices[].delta)
    // 完全不同,TS 必须看到 stream 字面量才能正确收敛重载。我们这里用 any 绕过去,
    // 因为还需要塞 thinking / reasoning_effort 这些非标准字段(SDK 类型也不认)。
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
      })) as { choices: { message: { content: string | null } }[] };

      const content = res.choices?.[0]?.message?.content;
      return typeof content === 'string' ? content : '';
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
  async *stream(system: string, user: string, opts?: LlmInvokeOptions): AsyncGenerator<string> {
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
      })) as AsyncIterable<{ choices: { delta: { content?: string | null } }[] }>;

      this.logger.debug(`LLM stream opened after ${Date.now() - t0}ms`);

      for await (const chunk of stream) {
        armStall();
        chunkCount++;
        const delta = chunk.choices?.[0]?.delta?.content;
        if (typeof delta === 'string' && delta.length > 0) {
          if (!firstChunkLogged) {
            this.logger.log(`LLM first content chunk after ${Date.now() - t0}ms`);
            firstChunkLogged = true;
          }
          yield delta;
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
   * 模拟流式:一次拉完整文本,按段落分批 yield 给上层。适用于不支持 SSE 的模型。
   */
  private async *fakeStream(
    system: string,
    user: string,
    opts?: LlmInvokeOptions,
  ): AsyncGenerator<string> {
    const t0 = Date.now();
    this.logger.log('LLM fake-stream: invoking complete()');
    const text = await this.complete(system, user, opts);
    this.logger.log(`LLM fake-stream: got ${text.length} chars in ${Date.now() - t0}ms`);

    const chunks: string[] = [];
    for (const para of text.split(/(\n+)/)) {
      if (!para) continue;
      if (para.length <= 200) chunks.push(para);
      else {
        for (let i = 0; i < para.length; i += 200) chunks.push(para.slice(i, i + 200));
      }
    }
    for (const c of chunks) {
      if (opts?.signal?.aborted) return;
      yield c;
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
