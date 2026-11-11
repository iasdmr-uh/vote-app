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

Transiciones: `preparing → lobby_open → lobby_closed → in_progress → completed`. La Asamblea decide las llegadas tarde y la mesa reabre el ingreso (`docs/scope.md`, regla 2 y sección 18). La reapertura pasa de `lobby_closed` o `in_progress` a `lobby_open` y queda en la bitácora como `lobby.reopened`. El servidor la rechaza mientras hay una papeleta abierta o si la Asamblea está `completed`. Reabrir un ingreso ya abierto no tiene efecto. Al cerrar de nuevo el ingreso, la Asamblea vuelve a `lobby_closed` y pasa a `in_progress` con la siguiente papeleta. No inferir quién declara la Asamblea completada ni reglas de quórum.

## Ronda

| Estado | Significado |
|---|---|
| `draft` | Configuración editable; no recibe votos. |
| `open` | Configuración congelada; acepta una participación válida por sesión. |
| `closed` | No acepta votos; resultado calculado (y desempate preparado como `draft` si quedan puestos). Nadie ve conteos mientras se separan los votos. |
| `published` | Votos separados; resultados agregados visibles a la vez en teléfonos, proyector y mesa. |
| `cancelled` | Estado reservado; su uso requiere decisión institucional. |

Transiciones: `draft → open → closed → published`. `open → cancelled` y `closed → cancelled` quedan bloqueadas hasta definir anulación. `published` no vuelve a `open`. Una ronda `open` no cambia título, formato, opciones ni orden. `closed → published` ocurre sola cuando la separación de votos termina, al cerrar, al reintentar la limpieza o al arrancar la API. No existe una acción de publicar. Un cierre repetido no produce efectos adicionales.

## Resultado oficial

Cada elección tiene a lo sumo un resultado oficial, ligado a su primera votación.

- La votación que deja la elección resuelta queda como `settled_round_id`. Una decisión guarda además `approved`.
- Anular esa votación borra `settled_round_id`.
- **Agregar a oficiales** fija `registered_at` cuando la votación resuelta está `published`. Repetirlo no cambia nada.
- Con `registered_at` fijo, la base de datos rechaza cambiar el resultado, sus opciones o anular una votación de la elección. «Borrar datos» sí lo elimina.
- Otra elección no abre mientras la última votación de una elección esté `closed` o `published` sin resultado agregado. Su propio desempate sí abre, y una última votación anulada no bloquea.
- No se anula una votación cuando ya se abrió la siguiente de su elección.

## Invariantes de dominio

- Solo una ronda abierta recibe votos; la política de múltiples rondas abiertas debe permanecer deshabilitada en V1 salvo aprobación explícita.
- Voto confirmado es inmutable. Solicitudes duplicadas no cambian la primera respuesta ni crean otra participación.
- La base de datos impone unicidad `(round_id, participant_session_id)` en Participación.
- El cierre impide nuevos votos a partir de la transacción que confirma el cierre.
- No se devuelven conteos por opción antes de `published`, tampoco a la mesa.
- Elegibilidad y quórum son determinaciones humanas/institucionales. Desde noviembre de 2026, mayoría, desempate y aprobación se calculan al cerrar (`results-engine.ts`); la mesa no elige ganadores.
