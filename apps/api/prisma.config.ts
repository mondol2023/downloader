import { config } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'prisma/config';

// Prisma stops auto-loading .env once a config file exists, so load the root one explicitly.
const here = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(here, '../../.env') });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    seed: 'tsx prisma/seed.ts',
  },
});
