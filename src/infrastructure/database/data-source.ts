import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { config as loadEnv } from 'dotenv';

loadEnv();

export default new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5432),
  username: process.env.DB_USER ?? 'novel',
  password: process.env.DB_PASSWORD ?? 'novel_pass',
  database: process.env.DB_NAME ?? 'ai_novel',
  entities: ['src/**/*.entity.ts'],
  migrations: ['src/infrastructure/database/migrations/*.ts'],
});
