import type { Config } from 'drizzle-kit';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is not set. Use --env-file=../.env or set it before running drizzle-kit.');
}

export default {
  schema: './src/infrastructure/db/schema.ts',
  out: './drizzle',
  dialect: 'mysql',
  dbCredentials: { url: databaseUrl },
  verbose: true,
  strict: true,
} satisfies Config;
