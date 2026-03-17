import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

const databaseUrl = process.env.DATABASE_URL ?? 'postgresql://gwpm:gwpm@localhost:5432/gwpm';

export const dbClient = postgres(databaseUrl, {
  max: 10,
  idle_timeout: 30,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

export const db = drizzle(dbClient);

export async function closeDbConnection(): Promise<void> {
  await dbClient.end({ timeout: 5 });
}
