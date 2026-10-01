# Estados y transiciones

Este es el modelo técnico inicial para guiar Fase 02. Toda transición sensible debe ser validada en servidor y tener una acción idempotente cuando repetir la misma solicitud sea seguro.

## Asamblea y lobby

| Estado | Significado |
|---|---|
| `preparing` | Asamblea creada; ingreso aún no disponible. |
| `lobby_open` | El QR permite incorporar participantes; se pueden revisar nombres. |
| `lobby_closed` | No se aceptan ingresos nuevos. |
| `in_progress` | Hay o hubo rondas operativas; el ingreso no se reabre automáticamente. |
| `completed` | Asamblea concluida por acción autorizada. |

Transiciones previstas: `preparing → lobby_open → lobby_closed → in_progress → completed`. Reapertura de lobby sería `lobby_closed → lobby_open`, explícita, auditada y condicionada a la decisión pendiente indicada en `decisions-pending.md`. No inferir quién declara la Asamblea completada ni reglas de quórum.

## Ronda

| Estado | Significado |
|---|---|
| `draft` | Configuración editable; no recibe votos. |
| `open` | Configuración congelada; acepta una participación válida por sesión. |
| `closed` | No acepta votos; resultados aún ocultos. |
| `published` | Resultados agregados autorizados visibles. |
| `cancelled` | Estado reservado; su uso requiere decisión institucional. |

Transiciones: `draft → open → closed → published`. `open → cancelled` y `closed → cancelled` quedan bloqueadas hasta definir anulación. `published` no vuelve a `open`. Una ronda `open` no cambia título, formato, opciones ni orden. Cierre y publicación son acciones distintas; cierre repetido y publicación repetida no deben producir efectos adicionales.

## Invariantes de dominio

- Solo una ronda abierta recibe votos; la política de múltiples rondas abiertas debe permanecer deshabilitada en V1 salvo aprobación explícita.
- Voto confirmado es inmutable. Solicitudes duplicadas no cambian la primera respuesta ni crean otra participación.
- La base de datos impone unicidad `(round_id, participant_session_id)` en Participación.
- El cierre impide nuevos votos a partir de la transacción que confirma el cierre.
- No se devuelven conteos por opción antes de `published`.
- Elegibilidad, quórum, mayoría, empate y proclamación son determinaciones humanas/institucionales.
