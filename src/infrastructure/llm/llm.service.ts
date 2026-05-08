import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';
import { BaseMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';

export interface LlmInvokeOptions {
  temperature?: number;
  model?: string;
  maxTokens?: number;
}

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);

  constructor(private readonly cfg: ConfigService) {}

  /** Build a fresh chat model — wrappers may want their own temp/model. */
  buildChat(opts: LlmInvokeOptions = {}): ChatOpenAI {
    return new ChatOpenAI({
      apiKey: this.cfg.get<string>('OPENAI_API_KEY'),
      configuration: { baseURL: this.cfg.get<string>('OPENAI_BASE_URL') },
      model: opts.model ?? this.cfg.get<string>('LLM_MODEL', 'gpt-4o-mini'),
      temperature: opts.temperature ?? this.cfg.get<number>('LLM_TEMPERATURE', 0.8),
      maxTokens: opts.maxTokens,
      streaming: false,
    });
  }

  /** Plain text completion against a system + user prompt. */
  async complete(system: string, user: string, opts?: LlmInvokeOptions): Promise<string> {
    const chat = this.buildChat(opts);
    const messages: BaseMessage[] = [new SystemMessage(system), new HumanMessage(user)];
    const res = await chat.invoke(messages);
    return typeof res.content === 'string' ? res.content : JSON.stringify(res.content);
  }

  /** Streaming completion; yields token chunks. */
  async *stream(system: string, user: string, opts?: LlmInvokeOptions): AsyncGenerator<string> {
    const chat = this.buildChat({ ...opts });
    const messages: BaseMessage[] = [new SystemMessage(system), new HumanMessage(user)];
    const it = await chat.stream(messages);
    for await (const chunk of it) {
      const c = chunk.content;
      if (typeof c === 'string' && c.length > 0) yield c;
      else if (Array.isArray(c)) {
        for (const part of c) {
          if (typeof part === 'string') yield part;
          else if ('text' in part && typeof part.text === 'string') yield part.text;
        }
      }
    }
  }
}
