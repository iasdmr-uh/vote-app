if (!process.env.TEST_DATABASE_URL) {
  console.error('Set TEST_DATABASE_URL to a disposable PostgreSQL database with migrations applied.')
  process.exit(1)
}
