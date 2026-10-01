# ADR-001 — Arquitectura inicial

- **Estado:** aceptada como base técnica; las decisiones institucionales pendientes quedan abiertas.
- **Fecha:** 2026-10-01.
- **Contexto:** V1 es una sola Asamblea presencial de la Unión Hondureña, para unas 50–70 personas. Debe ofrecer web móvil, panel de moderación y proyector; no valida credenciales oficiales.

## Decisión

- Mantener un repositorio npm workspaces con `apps/web` y `apps/api`; una aplicación modular y un despliegue lógico.
- Web: Vue 3, TypeScript 6 y Vite 8.1.
- API: NestJS 12, TypeScript 6 y Socket.IO como transporte de eventos cuando se implemente Fase 03.
- Persistencia: PostgreSQL 17; ORM: Prisma ORM 7.10, por soporte PostgreSQL, transacciones y restricciones únicas. Se prefiere la línea estable a Prisma 8, que al revisar su documentación oficial sigue como release candidate.
- Entorno local: Docker Compose para PostgreSQL; cliente/API se ejecutan con npm.
- Runtime objetivo: Node.js 24 LTS. Para desarrollo se admite Node.js 22.22.1+ mientras siga soportado y satisfaga NestJS; subir a Node.js 24 para preparación/despliegue.
- Mantener HTTP como fuente de operaciones y PostgreSQL como fuente de verdad. Socket.IO notifica cambios; los clientes recuperarán estado por snapshot HTTP.
- Secretos mediante variables de entorno. El ejemplo local no es una credencial de producción. Producción requiere HTTPS, CORS acotado y secretos administrados fuera del repositorio.

## Consecuencias

- El esqueleto crea rutas de trabajo y una comprobación de salud; no implementa reglas de Asamblea, autenticación, persistencia ni sockets.
- Las tablas y migraciones se concretan en Fase 02, respetando el modelo lógico en `data-model.md`.
- No se añaden microservicios, Redis, colas, clúster, Kubernetes ni múltiples organizaciones activas en V1.
- La selección y el estado de participación se guardan por separado. Esto reduce la asociación accidental, pero no garantiza anonimato criptográfico frente a administradores privilegiados, trazas temporales o colusión.

## Referencias de versión consultadas

- [Node.js releases](https://nodejs.org/en/about/previous-releases)
- [NestJS migration guide](https://docs.nestjs.com/migration-guide)
- [Vite release notes](https://vite.dev/blog)
- [Prisma ORM 7 setup](https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/introduction)
- [Prisma transactions](https://www.prisma.io/docs/orm/fundamentals/transactions)
