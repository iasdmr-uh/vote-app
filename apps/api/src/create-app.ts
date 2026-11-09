import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import helmet from 'helmet'
import { type NestApplicationOptions, ValidationPipe } from '@nestjs/common'
import { json } from 'express'
import { AppModule } from './app.module.js'
import { validateEnvironment } from './config/environment.js'

export async function createApp(options: NestApplicationOptions = {}): Promise<NestExpressApplication> {
  validateEnvironment()
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { ...options, bodyParser: false })
  const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS ?? 0)
  if (trustProxyHops > 0) app.set('trust proxy', trustProxyHops)
  app.setGlobalPrefix('api/v1')
  app.use(helmet())
  app.use(json({ limit: '16kb' }))
  app.enableCors({ origin: process.env.WEB_ORIGIN!.split(',').map((origin) => origin.trim()), credentials: false })
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  return app
}
