# Borrador de contrato HTTP y Socket.IO

Contrato funcional inicial; schemas/DTO concretos, códigos detallados y mecanismo de autenticación del moderador se cierran al implementar Fase 02. Todas las respuestas con estado de Asamblea se derivan del servidor.

## HTTP

Prefijo local `/api/v1`. `assemblyCode` es aleatorio y da acceso solo al flujo de ingreso mientras el lobby está abierto; no autoriza operaciones de moderación.

| Método y ruta | Audiencia | Propósito / datos mínimos |
|---|---|---|
| `POST /assemblies/:assemblyCode/join` | Delegado | Entrada `{firstName,lastName}`; crea sesión y devuelve `participantSessionToken` una sola vez y estado de sala. No eco de datos innecesarios. |
| `GET /participant/me` | Sesión participante | Estado propio, papeleta actual/última y participación propia; resultados agregados solo si esa ronda ya fue publicada. Nunca lista ajena ni selección. |
| `POST /participant/rounds/:roundId/vote` | Sesión participante | `{optionId, confirmation:true}`; respuesta genérica `{accepted:true, participationStatus:"recorded"}`. No devuelve conteos. |
| `GET /assemblies/:assemblyCode/public-state` | Público/proyector | Estado, QR/URL de sala y datos públicos permitidos por etapa; sin credenciales ni selecciones. Lista de nombres sujeta a decisión pendiente. |
| `GET /moderator/assemblies/:assemblyId` | Moderador autorizado | Estado administrativo, lista operativa e indicadores agregados permitidos; sin selecciones/conteos por opción antes de publicar. |
| `POST /moderator/assemblies` | Moderador autorizado | Crear/abrir Asamblea; devuelve identificador y código aleatorio de ingreso. |
| `PATCH /moderator/assemblies/:assemblyId/lobby` | Moderador autorizado | Abrir/cerrar lobby; cada transición registra auditoría. Reapertura condicionada a validación. |
| `PATCH /moderator/participants/:participantId` | Moderador autorizado | Corregir o retirar nombre/sesión según política aprobada; auditar acción mínima. |
| `POST /moderator/assemblies/:assemblyId/rounds` | Moderador autorizado | Crear borrador con título, formato, opciones y regla configurada explícitamente. |
| `POST /moderator/rounds/:roundId/open` | Moderador autorizado | Congelar opciones y abrir papeleta. |
| `POST /moderator/rounds/:roundId/close` | Moderador autorizado | Cerrar de forma idempotente y calcular internamente; no publica. |
| `POST /moderator/rounds/:roundId/publish` | Moderador autorizado | Publicación explícita, autorizada y auditada de los resultados agregados permitidos. |

Errores previsibles: `400` validación, `401` sesión no autenticada, `403` rol/acción no autorizada, `404` recurso desconocido, `409` estado incompatible o participación duplicada, `429` límite de frecuencia. Respuestas de error no deben incluir payloads de voto ni secretos. Las acciones administrativas requieren autorización en cada llamada; el QR público no concede privilegios.

## Socket.IO

La base de datos y el snapshot HTTP son fuente de verdad. Canal de conexión público no significa autorización para habitaciones privadas. Validar token al conectar y al suscribirse; proteger canales moderadores con mecanismo separado. Nunca aceptar el nombre de una room como credencial.

| Sala/audiencia | Eventos entrantes | Eventos salientes mínimos |
|---|---|---|
| `assembly:{id}:public` proyector/público | Ninguno que otorgue rol | `lobby.state`, `assembly.state`, `round.state`, `participation.count`, `results.published`; nombres solo si se valida la lista pública. |
| `assembly:{id}:moderators` moderadores autorizados | Acciones se hacen por HTTP; no duplicar comandos | `participant.joined`, `participant.updated`, `lobby.state`, `round.state`, `participation.count`, auditoría mínima. Lista de quién participó requiere decisión de acceso. |
| `participant:{sessionId}` sesión propia | Ninguno necesario | `participant.state`, `round.opened`, `round.closed`, `results.published` autorizado. Solo estado y papeleta propia; sin actividad individual ajena. |

Los eventos no contienen conjuntamente identidad y selección; no se emite selección individual. Los conteos de participación son agregados, sin totales por opción antes de publicar. Tras reconexión el cliente solicita snapshot HTTP y luego retoma eventos; no confía en eventos perdidos ni marca un voto confirmado sin respuesta del servidor. Reintentos no producen segunda participación.

## Privacidad del transporte

La solicitud HTTP de voto contiene una sesión autenticada y una opción, por lo que el servidor la ve temporalmente. No guardar su cuerpo en logs, auditoría, analítica ni trazas de error. Guardar por separado Participación y Voto dentro de la operación transaccional, sin clave de correlación compartida. Se conserva el límite documentado frente a administradores privilegiados y correlación temporal.
