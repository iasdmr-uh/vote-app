import { PrismaService } from '../../src/prisma/prisma.service.js'

const testDatabaseUrl = process.env.TEST_DATABASE_URL

if (!testDatabaseUrl) throw new Error('Set TEST_DATABASE_URL to a disposable PostgreSQL database with migrations applied.')

export async function connectDatabase() {
  process.env.DATABASE_URL = testDatabaseUrl
  process.env.PUBLIC_APP_URL ??= 'http://localhost:5173'
  const prisma = new PrismaService()
  await prisma.$connect()
  return prisma
}
