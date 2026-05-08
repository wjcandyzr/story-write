import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ChapterEntity } from './infrastructure/chapter.entity';
import { ChapterService } from './application/chapter.service';
import { ChapterController } from './interfaces/chapter.controller';
import { ChapterGateway } from './interfaces/chapter.gateway';
import { NovelModule } from '../novel/novel.module';
import { AgentsModule } from '../agents/agents.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ChapterEntity]),
    NovelModule,
    forwardRef(() => AgentsModule),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        secret: cfg.get<string>('JWT_SECRET', 'dev-secret'),
        signOptions: { expiresIn: cfg.get<string>('JWT_EXPIRES_IN', '7d') },
      }),
    }),
  ],
  providers: [ChapterService, ChapterGateway],
  controllers: [ChapterController],
  exports: [ChapterService],
})
export class ChapterModule {}
