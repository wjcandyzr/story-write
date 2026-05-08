import { Logger, UseGuards } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  WsException,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { ChapterOrchestrator } from '../../agents/orchestrator/chapter.orchestrator';
import { JwtPayload } from '../../auth/application/jwt.strategy';

interface GeneratePayload {
  novelId: string;
  chapterId: string;
  threadId?: string;
  extraInstructions?: string;
}

/**
 * Streaming chapter generation over Socket.IO.
 *
 * Client flow:
 *   1. connect with `auth: { token: <JWT> }`
 *   2. emit "chapter:generate" with payload
 *   3. receive a stream of "chapter:token" events, then "chapter:done" or "chapter:error"
 *   4. emit "chapter:cancel" to abort
 */
@WebSocketGateway({ cors: true, namespace: '/ws' })
export class ChapterGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(ChapterGateway.name);
  private readonly aborts = new Map<string, AbortController>();

  @WebSocketServer() server!: Server;

  constructor(
    private readonly orchestrator: ChapterOrchestrator,
    private readonly jwt: JwtService,
  ) {}

  handleConnection(socket: Socket) {
    try {
      const token = (socket.handshake.auth?.token ?? socket.handshake.query?.token) as
        | string
        | undefined;
      if (!token) throw new Error('Missing auth token');
      const payload = this.jwt.verify<JwtPayload>(token);
      (socket.data as { user?: JwtPayload }).user = payload;
      this.logger.log(`socket connected: user=${payload.username}`);
    } catch (e) {
      this.logger.warn(`socket auth failed: ${(e as Error).message}`);
      socket.emit('chapter:error', { message: 'unauthorized' });
      socket.disconnect(true);
    }
  }

  handleDisconnect(socket: Socket) {
    const ctrl = this.aborts.get(socket.id);
    if (ctrl) {
      ctrl.abort();
      this.aborts.delete(socket.id);
    }
  }

  @SubscribeMessage('chapter:cancel')
  cancel(@ConnectedSocket() socket: Socket) {
    const ctrl = this.aborts.get(socket.id);
    if (ctrl) {
      ctrl.abort();
      this.aborts.delete(socket.id);
      socket.emit('chapter:cancelled');
    }
  }

  @SubscribeMessage('chapter:generate')
  async generate(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: GeneratePayload,
  ) {
    const user = (socket.data as { user?: JwtPayload }).user;
    if (!user) throw new WsException('unauthorized');

    if (!body?.novelId || !body?.chapterId) {
      socket.emit('chapter:error', { message: 'novelId and chapterId required' });
      return;
    }

    this.logger.log(
      `chapter:generate received · user=${user.username} novel=${body.novelId} chapter=${body.chapterId}`,
    );

    const ctrl = new AbortController();
    this.aborts.set(socket.id, ctrl);

    try {
      socket.emit('chapter:start', {
        novelId: body.novelId,
        chapterId: body.chapterId,
      });

      let total = '';
      for await (const evt of this.orchestrator.streamChapter(
        {
          novelId: body.novelId,
          chapterId: body.chapterId,
          ownerId: user.sub,
          threadId: body.threadId,
          extraInstructions: body.extraInstructions,
        },
        ctrl.signal,
      )) {
        if (evt.type === 'token') {
          total += evt.value;
          socket.emit('chapter:token', { value: evt.value });
        } else if (evt.type === 'phase') {
          socket.emit('chapter:phase', { phase: evt.phase, detail: evt.detail });
        } else if (evt.type === 'continuity') {
          socket.emit('chapter:continuity', evt.payload);
        }
      }

      // 用户已经按了中断:不要再覆盖发 done(已经发过 cancelled),
      // 也不让前端误以为这是一次完整生成。
      if (ctrl.signal.aborted) {
        socket.emit('chapter:cancelled');
      } else {
        socket.emit('chapter:done', { content: total });
      }
    } catch (e) {
      // 区分一下 abort 与真错:abort 不算错。
      if (ctrl.signal.aborted) {
        this.logger.log('generate aborted by user');
        socket.emit('chapter:cancelled');
      } else {
        this.logger.error(`generate failed: ${(e as Error).message}`, (e as Error).stack);
        socket.emit('chapter:error', { message: (e as Error).message });
      }
    } finally {
      this.aborts.delete(socket.id);
    }
  }
}
