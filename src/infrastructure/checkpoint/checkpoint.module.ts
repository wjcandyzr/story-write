import { Global, Module, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';

export const LANGGRAPH_CHECKPOINTER = 'LANGGRAPH_CHECKPOINTER';

@Global()
@Module({
  providers: [
    {
      provide: LANGGRAPH_CHECKPOINTER,
      inject: [ConfigService],
      useFactory: async (cfg: ConfigService) => {
        const url = cfg.get<string>('CHECKPOINT_PG_URL');
        if (!url) throw new Error('CHECKPOINT_PG_URL is required for LangGraph checkpointing');
        const saver = PostgresSaver.fromConnString(url);
        await saver.setup();
        return saver;
      },
    },
  ],
  exports: [LANGGRAPH_CHECKPOINTER],
})
export class CheckpointModule implements OnModuleInit {
  async onModuleInit() {}
}
