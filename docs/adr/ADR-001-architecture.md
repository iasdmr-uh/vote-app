# ADR-001: Initial architecture

- **Status:** Accepted as the technical base. Pending institutional decisions stay open.
- **Date:** 2026-10-01
- **Context:** V1 serves one in-person Assembly of the Unión Hondureña, for about 50 to 70 people. It must offer a mobile web client, a moderation panel and a projector view. It does not validate official credentials.

## Decision

- Keep one npm workspaces repository with `apps/web` and `apps/api`, as one modular application and one logical deployment.
- Web: Vue 3, TypeScript 6 and Vite 8.1.
- API: NestJS 12, TypeScript 6 and Socket.IO as the event transport once Phase 03 is implemented.
- Persistence: PostgreSQL 17 and Prisma ORM 7.10, for its PostgreSQL support, transactions and unique constraints. The stable line is preferred over Prisma 8, which was still a release candidate in the official documentation at review time.
- Local environment: Docker Compose for PostgreSQL. The client and API run with npm.
- Target runtime: Node.js 24 LTS. Development also accepts Node.js 22.22.1+ while it stays supported and satisfies NestJS. Preparation and deployment move to Node.js 24.
- Keep HTTP as the source of operations and PostgreSQL as the source of truth. Socket.IO notifies changes, and clients recover state through an HTTP snapshot.
- Secrets come from environment variables. The local example is not a production credential. Production requires HTTPS, restricted CORS and secrets managed outside the repository.

## Consequences

- The skeleton creates work routes and a health check. It does not implement Assembly rules, authentication, persistence or sockets.
- Phase 02 defines the tables and migrations, following the logical model in `docs/foundation/data-model.md`.
- V1 adds no microservices, Redis, queues, clusters, Kubernetes or multiple active organizations.
- The selection and the participation status are stored separately. This reduces accidental linking, but it does not guarantee cryptographic anonymity against privileged administrators, timing traces or collusion.

## Version references consulted

- [Node.js releases](https://nodejs.org/en/about/previous-releases)
- [NestJS migration guide](https://docs.nestjs.com/migration-guide)
- [Vite release notes](https://vite.dev/blog)
- [Prisma ORM 7 setup](https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/introduction)
- [Prisma transactions](https://www.prisma.io/docs/orm/fundamentals/transactions)
