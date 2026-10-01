import 'reflect-metadata'
import dotenv from 'dotenv'
import { resolve } from 'node:path'
import { NestFactory } from '@nestjs/core'
import helmet from 'helmet'
import { ValidationPipe } from '@nestjs/common'
import { json } from 'express'
import { AppModule } from './app.module.js'
import { validateEnvironment } from './config/environment.js'

dotenv.config({ path: resolve(process.cwd(), '../../.env') })

async function bootstrap() {
  validateEnvironment()
  const app = await NestFactory.create(AppModule, { bodyParser: false })
  app.setGlobalPrefix('api/v1')
  app.use(helmet())
  app.use(json({ limit: '16kb' }))
  app.enableCors({ origin: process.env.WEB_ORIGIN!.split(',').map((origin) => origin.trim()), credentials: false })
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  app.enableShutdownHooks()
  await app.listen(Number(process.env.API_PORT ?? 3000))
}

void bootstrap()
