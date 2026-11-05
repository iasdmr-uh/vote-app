# Fase 02 — Decisiones y límites de la implementación

## Comportamiento disponible

- NestJS valida variables requeridas al iniciar, restringe CORS al origen configurado, limita JSON a 16 KiB, aplica cabeceras Helmet, validación estricta de DTO y una cota básica de 300 solicitudes por minuto/IP en una instancia.
- Moderación usa una sola credencial secreta de entorno, de al menos 32 caracteres, comparada en tiempo constante. Los participantes reciben un token aleatorio de 256 bits; PostgreSQL guarda solo su SHA-256. El código de sala se guarda hasheado y se devuelve una vez al crear Asamblea.
- Crear Asamblea abre el lobby de inmediato y limita a una Asamblea activa para la Unión configurada. Se admite join solo mientras el lobby esté abierto. La reapertura se rechaza explícitamente hasta validar esa política.
- Una ronda es un cargo (`single_choice`, 1 puesto), una comisión (`multiple_choice`, `memberCount` puestos) o una decisión (`category: "decision"`), con opciones de etiquetas únicas.
- Resultados automáticos (noviembre 2026): al cerrar, `settleElection` aplica `results-engine.ts` sobre la base de participantes habilitados congelada en `eligible_count` (inhabilitados y quienes no votaron incluidos). Mayoría = más de la mitad de la base. Electo = dentro de los N primeros y con mayoría; un empate en el corte va a desempate entre los empatados. Con puestos abiertos, el servidor prepara el desempate como borrador con `electionSeats` = puestos abiertos: los N primeros sin mayoría y los empatados en el corte, más el siguiente (y sus empatados) si no superan los puestos abiertos. La mesa lo abre; se repite hasta llenar los puestos. La mesa no declara resultados ni elige ganadores; solo abre, cierra, publica y anula.
- En comisiones y desempates se marcan exactamente `electionSeats ?? memberCount` nombres; el servidor rechaza otra cantidad.
- Decisiones: `decisionFormat` `boolean` («A favor» / «En contra», escritas por el servidor) u `options`; `approvalRule` `simple` (> 1/2) o `three_quarters` (≥ 3/4, redondeo hacia arriba). Sin abstención. Una booleana no aprobada no se repite; con opciones, sin umbral se repite entre las 2 primeras y empatadas.
- El voto bloquea la fila de ronda, comprueba el estado y registra Participación más Voto anónimo en una única transacción. El índice único `(round_id, participant_session_id)` evita duplicados concurrentes. Cierre también bloquea la fila; si voto gana el lock, queda registrado antes del cierre, y si cierre gana, voto se rechaza.
- Solo la vista del moderador lista participantes activos. El proyector recibe cantidad activa, estado y resultados solo tras `published`; nunca lista nombres ni respuestas previas a publicación. El snapshot del participante recupera el estado de su ronda más reciente y si su propia participación fue registrada, sin exponer selección.
- Acciones administrativas relevantes se auditan como `shared_moderator_credential`, sin token, opción, payload de solicitud ni vínculo participante-opción.
- Migraciones de noviembre 2026: `20261102004200_decision_rounds` (decisiones), `20261102004300_participant_voting_disabled` (inhabilitar) y `20261102004400_ballot_option_is_new` (candidato nuevo).

## Contrato de moderación local

Usa `Authorization: Bearer <MODERATOR_ACCESS_TOKEN>` en `/api/v1/moderator/*`. `POST /api/v1/moderator/assemblies` acepta `{ "name": "..." }` y devuelve `assemblyId`, `joinCode`, `joinUrl` y `status`. `POST /api/v1/moderator/assemblies/:id/rounds` acepta `title`, `format`, `category` (`office` / `committee` / `decision`), `memberCount` (comisión), `decisionFormat` y `approvalRule` (decisión) y `options: [{"label":"..."}]`; `countingRule` se acepta por compatibilidad y se ignora (se guarda `{ "kind": "automatic", "rule": ... }`). Desde la 3.ª votación de una elección, `POST /api/v1/moderator/rounds/:id/candidates` agrega un candidato nuevo al borrador del desempate y `DELETE .../candidates/:optionId` lo quita. `POST /api/v1/moderator/participants/:id/disable-voting` / `enable-voting` inhabilita o habilita: sigue en la base, no recibe papeletas y su voto se rechaza con `403`; un voto ya emitido se conserva. Las opciones se crean junto a la ronda; cambios de configuración quedan bloqueados al abrirla. El contador por opción se muestra solo en las respuestas de la operación publicar y consultas posteriores a una ronda publicada.

El ingreso responde con `participantSessionToken` (única entrega del secreto), el nombre propio y snapshot. `/api/v1/participant/me` devuelve la papeleta actual/última y el estado de participación propia; si la ronda ya está publicada, añade resultados agregados, `outcome`, `recordedCount` y `eligibleCount` («no votaron» = base − votos emitidos). `/api/v1/assemblies/:code/public-state` solo muestra conteo de sesiones activas, estado y resultados publicados.

## Decisiones de negocio que bloquean uso oficial

- Credencial compartida no identifica a operadores individuales; requiere validar responsable, distribución y rotación antes del uso oficial.
- Las reglas de mayoría, desempate y decisiones son las confirmadas el 2 de noviembre de 2026 (`docs/scope.md`, sección 8). Quórum y elegibilidad de cada delegado siguen fuera del software.
- Retención/eliminación automática no está implementada hasta aprobación de política.
- Reapertura de lobby está deshabilitada; la lista de nombres pública tampoco se envía.
- Configuración de red, Wi-Fi, dominio, HTTPS, respaldo/restauración y contingencia física dependen de la operación del evento.

No se habilita una votación oficial con estos puntos pendientes. La base no prueba anonimato criptográfico ante acceso privilegiado ni “una persona = un voto”.
