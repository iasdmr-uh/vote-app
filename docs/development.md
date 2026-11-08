# Desarrollo local

## Requisitos

- Node.js 22.22.3 o posterior de la rama 22 para desarrollo; Node.js 24 LTS para despliegue, npm 10 o posterior.
- Docker Engine y Docker Compose.

## Inicio

1. Copia `.env.example` a `.env` y cambia los valores locales si es necesario. `.env` está excluido de Git.
2. Inicia PostgreSQL: `docker compose up -d postgres`.
3. Instala dependencias desde la raíz: `npm install`.
4. Genera el cliente Prisma: `npm run db:generate --workspace @asdmr/api`.
5. Aplica la migración local: `npm run db:migrate --workspace @asdmr/api`.
6. En una terminal, ejecuta `npm run dev:api`.
7. En otra, ejecuta `npm run dev` y abre `http://localhost:5173`.
8. Comprueba la API en `http://localhost:3000/api/v1/health`.

## Estado de verificación

Registro reproducible más reciente: 2026-10-01. En Node.js 22.22.1/npm 11.13.0, `npm run typecheck` y `npm run build` terminaron correctamente. `npm run test:e2e` pasó 6/6 pruebas (Chromium de escritorio y móvil); Playwright intercepta la API con datos sintéticos, por lo que no valida el recorrido integrado contra API y PostgreSQL. La primera ejecución E2E dentro del sandbox no pudo abrir `127.0.0.1:5173` (`EPERM`); al autorizar el servidor local, la misma suite pasó.

La suite integrada real se ejecuta por separado con `npm run test:e2e:integration` (requiere Docker o las herramientas locales de PostgreSQL y Chromium de Playwright). Instrucciones y formato de evidencia: [e2e-real-postgres.md](e2e-real-postgres.md).


Docker 28.0.4 estaba instalado, pero su daemon no estaba disponible. Se usó PostgreSQL local 15.15 para crear un clúster nuevo y desechable en `/private/tmp`, escuchando solo en `127.0.0.1:55432`, con una base vacía `asdmr_integration`; no se conectó a la base local habitual ni a datos reales. `prisma migrate deploy` aplicó `20261001000000_initial`; `TEST_DATABASE_URL=... npm run test --workspace @asdmr/api` pasó 11/11, incluido el caso de concurrencia, cierre y publicación que antes se omitía. El clúster de prueba se detuvo después de la corrida. La repetición limpia requiere los comandos de abajo.

`k6` no está instalado (`k6 version`: comando no encontrado en la última verificación), por lo que no hay resultado de rendimiento. `tests/load/voting.js` ofrece tres modos (`join`, `vote-retry`, `closed-vote`) que crean Asamblea, participantes y papeleta sintéticos en un staging declarado. Requiere credencial de moderación de staging, etiqueta de corrida y umbrales P95/tasa de error acordados. No ejecutar hasta tener k6 y el staging autorizado; consultar `docs/plan/phase-05-verification-plan.md` para comandos y evidencia requerida. Los ensayos presenciales siguen pendientes.

Pendiente: repetir integración de forma independiente cuando cambie la migración o la lógica de persistencia, ejecutar carga real con k6 y completar ensayos operativos. Consultar `docs/plan/phase-05-verification-plan.md` para dependencias, procedimientos y matriz completa. La comprobación de sintaxis k6 no equivale a ejecutar la carga.

### Repetir integración con una base desechable (PostgreSQL local)

Si Docker no está disponible pero `initdb`, `pg_ctl` y `createdb` existen, estos pasos crean un clúster temporal aislado. Ajusta el puerto si `55432` ya está ocupado. Ejecuta desde la raíz; el usuario local de PostgreSQL debe coincidir con `id -un`.

```sh
TEST_PG_DIR="$(mktemp -d /private/tmp/asdmr-pg-test.XXXXXX)"
initdb -D "$TEST_PG_DIR/data" --auth-local=trust --auth-host=trust --no-instructions
pg_ctl -D "$TEST_PG_DIR/data" -l "$TEST_PG_DIR/postgres.log" \
  -o "-h 127.0.0.1 -p 55432" -w start
createdb -h 127.0.0.1 -p 55432 asdmr_integration
DATABASE_URL="postgresql://$(id -un)@127.0.0.1:55432/asdmr_integration?schema=public" \
  npm run db:deploy --workspace @asdmr/api
TEST_DATABASE_URL="postgresql://$(id -un)@127.0.0.1:55432/asdmr_integration?schema=public" \
  npm run test --workspace @asdmr/api
pg_ctl -D "$TEST_PG_DIR/data" -m fast -w stop
```

Si falla antes de `pg_ctl ... stop`, detén explícitamente el clúster con el mismo comando de parada y revisa su log en `$TEST_PG_DIR/postgres.log`. Este procedimiento no debe apuntar a una base que contenga datos existentes.

La API implementa el flujo esencial de Asamblea, sesiones, rondas, votos, cierre y publicación. La conexión en tiempo real es una capa separada; no usar datos personales reales en desarrollo.

Para unit tests y suite de Socket.IO: `npm run test --workspace @asdmr/api`. El test de concurrencia/voto/cierre/publicación se ejecuta cuando `TEST_DATABASE_URL` apunta a una base PostgreSQL desechable con la migración aplicada; usa esa base únicamente para pruebas.

## Variables

Consulta `.env.example`. `POSTGRES_PASSWORD`, `DATABASE_URL` y `MODERATOR_ACCESS_TOKEN` son solo para desarrollo local. Configura el token de moderación con al menos 32 caracteres aleatorios. En cada llamada `/api/v1/moderator/*`, envía `Authorization: Bearer <MODERATOR_ACCESS_TOKEN>`; el QR/código de Asamblea nunca autoriza moderación.

La credencial compartida habilita el MVP técnico, pero no identifica a cada operador individual. No desplegarla para una Asamblea oficial hasta que Secretaría/mesa valide quién modera, cómo se entrega y cómo se rota. Producción requiere secretos administrados por el entorno, HTTPS y una lista CORS específica.

Para la Asamblea en red local (una laptop como servidor en el Wi-Fi de Starlink, panel de la mesa solo en esa laptop y borrado de datos al final), consulta la guía del técnico [lan-assembly.md](lan-assembly.md).

Para preparar una instalación candidata reproducible con Caddy/HTTPS, servicios aislados, migraciones, healthchecks y verificación de backups, consulta [candidate-environment.md](candidate-environment.md). Requiere un host y DNS de prueba autorizados; no uses datos personales reales.

`WEB_ORIGIN` acepta una lista de orígenes exactos separados por comas. Para probar desde un teléfono, agrega el origen LAN del equipo que sirve Vite (por ejemplo, `http://192.168.1.20:5173`) y configura `VITE_API_URL` en `apps/web/.env.local` hacia la API en esa misma IP. Mantén solo los orígenes locales necesarios y reinicia ambos servidores después de cambiar `.env`.

## API implementada

- Delegado: `POST /api/v1/assemblies/:assemblyCode/join`, `GET /api/v1/participant/me` y `POST /api/v1/participant/rounds/:roundId/vote`.
- Proyector: `GET /api/v1/assemblies/:assemblyCode/public-state`; durante el ingreso abierto expone nombres y total de participantes. Cuando inicia una papeleta, oculta la lista y expone solo progreso agregado; los resultados por opción aparecen después de su publicación.
- Moderador: crear/consultar Asamblea, cerrar lobby, corregir/retirar participante, preparar/abrir/cerrar ronda (cargo, comisión o decisión) y publicar resultados bajo `/api/v1/moderator/*`.
- Recuperación: `GET /api/v1/moderator/assemblies/active` permite retomar la Asamblea activa desde otra pestaña o equipo; `POST /api/v1/moderator/assemblies/:id/join-code` genera un nuevo código/QR (el anterior deja de funcionar); `POST /api/v1/moderator/participants/:id/resume-code` emite un QR de reconexión de un solo uso (10 minutos) que el delegado canjea con `POST /api/v1/assemblies/resume`. La reconexión conserva la participación registrada, por lo que no habilita un segundo voto.
- `PATCH /api/v1/moderator/assemblies/:id/lobby` con `lobby_open` reabre el ingreso solo si no hay papeleta abierta, y queda registrado como `lobby.reopened`.
- Inhabilitar / Habilitar: `POST /api/v1/moderator/participants/:id/disable-voting` y `.../enable-voting`. Un inhabilitado sigue en la sala, en la lista y en la base de mayoría, pero no recibe papeletas y el servidor rechaza su voto (`403`); un voto ya emitido se conserva. Inhabilitar a quien salió lo devuelve a la lista. Queda auditado.
- Candidato nuevo: `POST /api/v1/moderator/rounds/:roundId/candidates` (`{ "label": "..." }`) y `DELETE /api/v1/moderator/rounds/:roundId/candidates/:optionId`. Solo en el borrador de un desempate desde la 3.ª votación de una elección (nunca en el primer desempate ni en decisiones); «Quitar» solo retira candidatos agregados por la mesa (`is_new`).
- `POST /api/v1/moderator/rounds/:roundId/annul` anula; `POST .../repeat` solo repite una papeleta anulada.

## Resultados automáticos (noviembre 2026)

La mesa abre, cierra, publica y puede anular; nunca elige ganadores. No existen endpoints de declaración manual. Al cerrar, `settleElection` (`apps/api/src/voting/voting.service.ts`) aplica `apps/api/src/voting/results-engine.ts` (funciones puras, probadas en `test/results-engine.spec.ts`):

- Base: participantes habilitados al abrir la votación, congelada en `rounds.eligible_count`; inhabilitados y quienes no votaron cuentan. Mayoría = más de la mitad (38 → 20; la mitad exacta no alcanza).
- Elecciones (`electionOutcome`): cargo = 1 puesto, comisión = `electionSeats` puestos. Electo = dentro de los N primeros y con mayoría. Un empate en el corte va a desempate solo entre los empatados. Si los puestos quedan abiertos, el servidor crea el desempate como borrador (`committee_root_round_id` = primera votación, `electionSeats` = puestos abiertos) con los N primeros sin mayoría y los empatados en el corte; si eso no supera los puestos abiertos, se agrega el siguiente (y sus empatados). La mesa lo abre; se repite hasta llenar los puestos. Los electos se acumulan en `official_results` de la primera votación (`declaredBy: results_engine`).
- Selección exacta: en comisiones y desempates cada delegado marca exactamente `electionSeats ?? memberCount` nombres; el servidor rechaza otra cantidad (`422`).
- Decisiones (`category: "decision"`, `decisionOutcome`): `decisionFormat` `boolean` (el servidor escribe «A favor» / «En contra») u `options`; `approvalRule` `simple` (> 1/2) o `three_quarters` (≥ 3/4, redondeo hacia arriba: 38 → 29). Booleana: aprobada si «A favor» alcanza el umbral; si no, no aprobada y no se repite. Con opciones, sin umbral se repite entre las 2 primeras y empatadas.
- Publicado: `recordedCount` y `eligibleCount`; «no votaron» = base − votos emitidos. `outcome` trae `threshold`, `elected`, `runoff` y `openSeats`; `voteNumber` y `runoff` indican la votación de la cadena.
- `countingRule` ya no elige la regla: al crear se guarda `{ kind: "automatic", rule }` y el contenido que envíe el cliente se ignora. Los desempates y repeticiones guardan `reason: "runoff" | "repeat"` y `sourceRoundId` (con `kind: "count_only"` heredado como marcador interno).

Migraciones: `20261102004200_decision_rounds` (categoría `decision`, `decision_format`, `approval_rule`), `20261102004300_participant_voting_disabled` (`participant_sessions.voting_disabled`) y `20261102004400_ballot_option_is_new` (`ballot_options.is_new`).

E2E real: `npm run test:e2e:integration`; si 3300 o 4174 están ocupados, `E2E_API_PORT=… E2E_WEB_PORT=… npm run test:e2e:integration` ([e2e-real-postgres.md](e2e-real-postgres.md)).

## Documentos de fundamento

- `docs/foundation/ADR-001-architecture.md`: decisiones técnicas iniciales.
- `docs/foundation/decisions-pending.md`: confirmaciones y pendientes institucionales.
- `docs/foundation/state-transitions.md`: estados e invariantes.
- `docs/foundation/data-model.md`: modelo lógico.
- `docs/foundation/api-and-events.md`: borrador HTTP y Socket.IO.

Las decisiones pendientes requieren validación de Secretaría/mesa o del responsable institucional indicado; no deben convertirse en reglas implícitas del software.
