import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../generated/prisma/client.js'

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name)

  constructor() {
    const connectionString = process.env.DATABASE_URL
    if (!connectionString) throw new Error('DATABASE_URL is required')
    super({ adapter: new PrismaPg({ connectionString }) })
  }

  async onModuleInit(): Promise<void> {
    await this.$connect()
    await this.warnIfStatementsAreLogged()
  }

  /**
   * Logged INSERT parameters would pair each participation receipt with its vote, defeating
   * the separation between the two tables. See docs/foundation/data-model.md.
   */
  private async warnIfStatementsAreLogged(): Promise<void> {
    const [statement] = await this.$queryRaw<Array<{ log_statement: string }>>`SHOW log_statement`
    const [duration] = await this.$queryRaw<Array<{ log_min_duration_statement: string }>>`SHOW log_min_duration_statement`
    if (statement?.log_statement !== 'none' && statement?.log_statement !== 'ddl') {
      this.logger.warn(`PostgreSQL log_statement=${statement?.log_statement}: logged vote inserts can reveal how each delegate voted. Set log_statement=none.`)
    }
    if (duration?.log_min_duration_statement !== '-1') {
      this.logger.warn(`PostgreSQL log_min_duration_statement=${duration?.log_min_duration_statement}: slow vote inserts would be logged with their parameters. Set it to -1.`)
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect()
  }
}
