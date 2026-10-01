# Fase 02 — Decisiones y límites de la implementación

## Comportamiento disponible

- NestJS valida variables requeridas al iniciar, restringe CORS al origen configurado, limita JSON a 16 KiB, aplica cabeceras Helmet, validación estricta de DTO y una cota básica de 300 solicitudes por minuto/IP en una instancia.
- Moderación usa una sola credencial secreta de entorno, de al menos 32 caracteres, comparada en tiempo constante. Los participantes reciben un token aleatorio de 256 bits; PostgreSQL guarda solo su SHA-256. El código de sala se guarda hasheado y se devuelve una vez al crear Asamblea.
- Crear Asamblea abre el lobby de inmediato y limita a una Asamblea activa para la Unión configurada. Se admite join solo mientras el lobby esté abierto. La reapertura se rechaza explícitamente hasta validar esa política.
- Ronda V1 admite `single_choice`, opciones con etiquetas únicas y configuración `countingRule: {"kind":"count_only"}`. No calcula ni proclama un ganador.
- El voto bloquea la fila de ronda, comprueba el estado y registra Participación más Voto anónimo en una única transacción. El índice único `(round_id, participant_session_id)` evita duplicados concurrentes. Cierre también bloquea la fila; si voto gana el lock, queda registrado antes del cierre, y si cierre gana, voto se rechaza.
- Solo la vista del moderador lista participantes activos. El proyector recibe cantidad activa, estado y resultados solo tras `published`; nunca lista nombres ni respuestas previas a publicación. El snapshot del participante recupera el estado de su ronda más reciente y si su propia participación fue registrada, sin exponer selección.
- Acciones administrativas relevantes se auditan como `shared_moderator_credential`, sin token, opción, payload de solicitud ni vínculo participante-opción.

## Contrato de moderación local

Usa `Authorization: Bearer <MODERATOR_ACCESS_TOKEN>` en `/api/v1/moderator/*`. `POST /api/v1/moderator/assemblies` acepta `{ "name": "..." }` y devuelve `assemblyId`, `joinCode`, `joinUrl` y `status`. `POST /api/v1/moderator/assemblies/:id/rounds` acepta `title`, `format: "single_choice"`, `options: [{"label":"..."}]` y `countingRule: {"kind":"count_only"}`. Las opciones se crean junto a la ronda; cambios de configuración quedan bloqueados al abrirla. El contador por opción se muestra solo en las respuestas de la operación publicar y consultas posteriores a una ronda publicada.

El ingreso responde con `participantSessionToken` (única entrega del secreto), el nombre propio y snapshot. `/api/v1/participant/me` devuelve la papeleta actual/última y el estado de participación propia; si la ronda ya está publicada, añade resultados agregados. `/api/v1/assemblies/:code/public-state` solo muestra conteo de sesiones activas, estado y resultados publicados.

## Decisiones de negocio que bloquean uso oficial

- Credencial compartida no identifica a operadores individuales; requiere validar responsable, distribución y rotación antes del uso oficial.
- Mayorías, abstenciones, nulidad, empate, repetición, anulación y proclamación no se interpretan por software. `count_only` publica totales por opción; la autoridad decide su efecto reglamentario.
- Retención/eliminación automática no está implementada hasta aprobación de política.
- Reapertura de lobby está deshabilitada; la lista de nombres pública tampoco se envía.
- Configuración de red, Wi-Fi, dominio, HTTPS, respaldo/restauración y contingencia física dependen de la operación del evento.

No se habilita una votación oficial con estos puntos pendientes. La base no prueba anonimato criptográfico ante acceso privilegiado ni “una persona = un voto”.
