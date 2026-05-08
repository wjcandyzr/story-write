import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { join } from 'path';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { cors: true });
  const config = app.get(ConfigService);

  // Serve the demo page at "/". Resolved relative to project root regardless
  // of whether we boot from `src/` (ts-node) or `dist/` (compiled).
  const demoDir = join(process.cwd(), 'demo');
  app.useStaticAssets(demoDir);

  // Global prefix for the REST API; static + Swagger live outside it
  // (static middleware runs before route resolution, so `/` still hits demo).
  app.setGlobalPrefix('api');

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new TransformInterceptor());

  const swagger = new DocumentBuilder()
    .setTitle('AI Novel Platform')
    .setDescription('LangGraph-powered long-form novel generation')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swagger));

  const port = config.get<number>('PORT', 3000);
  await app.listen(port);
  Logger.log(`AI Novel Platform listening on :${port}`, 'Bootstrap');
  Logger.log(`Demo UI    : http://localhost:${port}/`, 'Bootstrap');
  Logger.log(`Swagger UI : http://localhost:${port}/docs`, 'Bootstrap');
  Logger.log(`API base   : http://localhost:${port}/api`, 'Bootstrap');
}

bootstrap();
