import dotenv from 'dotenv'
import { resolve } from 'node:path'
import { createApp } from './create-app.js'

dotenv.config({ path: resolve(process.cwd(), '../../.env') })

async function bootstrap() {
  const app = await createApp()
  app.enableShutdownHooks()
  await app.listen(Number(process.env.API_PORT ?? 3000))
}

void bootstrap()
