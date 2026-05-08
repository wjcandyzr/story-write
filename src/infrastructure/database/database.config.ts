import { TypeOrmModuleAsyncOptions } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';

export const databaseConfig: TypeOrmModuleAsyncOptions = {
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (cfg: ConfigService) => ({
    type: 'postgres',
    host: cfg.get<string>('DB_HOST', 'localhost'),
    port: cfg.get<number>('DB_PORT', 5432),
    username: cfg.get<string>('DB_USER', 'novel'),
    password: cfg.get<string>('DB_PASSWORD', 'novel_pass'),
    database: cfg.get<string>('DB_NAME', 'ai_novel'),
    autoLoadEntities: true,
    synchronize: cfg.get<string>('DB_SYNC', 'false') === 'true',
    logging: cfg.get<string>('NODE_ENV') === 'development' ? ['error', 'warn'] : ['error'],
  }),
};
