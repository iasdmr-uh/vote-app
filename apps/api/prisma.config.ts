import dotenv from 'dotenv'
import { resolve } from 'node:path'
import { defineConfig } from 'prisma/config'

dotenv.config({ path: resolve(process.cwd(), '../../.env') })

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env.DATABASE_URL ?? 'postgresql://asdmr_voting:local_only_change_me@localhost:5432/asdmr_voting' },
})
