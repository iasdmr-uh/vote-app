# Modelo lógico y diccionario inicial

El modelo es conceptual para Fase 01; nombres y tipos físicos quedan para migraciones de Fase 02.

| Entidad | Campos conceptuales | Restricciones y divulgación |
|---|---|---|
| Organización | id, nombre, tipo (`union`/`association`), estado | En V1 se configura Unión Hondureña; asociaciones no se habilitan como producto. |
| Asamblea | id, organization_id, nombre, fecha, estado, código/URL de sala aleatorio, timestamps operativos | No aceptar códigos enumerables. Las reglas oficiales no se derivan del estado. |
| Sesión participante | id aleatorio, assembly_id, nombre, apellido, credencial de sesión protegida, ingresó_en, estado | Sin cuenta. El secreto/token no se muestra ni se registra en logs; el nombre se divulga solo a vistas autorizadas. |
| Ronda | id, assembly_id, título, formato, configuración explícita, estado, abierta_en, cerrada_en, publicada_en | Configuración congelada al abrir. No codificar regla de conteo universal. |
| Opción | id, round_id, etiqueta, orden | No cambia después de abrir la ronda. |
| Participación | id, round_id, participant_session_id, estado, emitida_en | Unicidad por ronda/sesión. No contiene selección. Acceso operativo restringido. |
| Voto anónimo | id, round_id, option_id, emitido_en | No contiene participant_id, nombre, token ni FK a Participación. `round_id` y opción solo permiten agregación por ronda después del cierre. |
| Evento administrativo | id, assembly_id, round_id opcional, actor administrativo, acción, fecha/hora, metadatos mínimos | Nunca cuerpos HTTP, secretos, opción elegida ni vínculo identidad-selección. Evitar metadatos que creen correlación evitable. |

## Relación conceptual

`Organización 1—N Asamblea 1—N Ronda 1—N Opción`.
`Asamblea 1—N Sesión participante`; `Sesión participante 1—N Participación`; `Ronda 1—N Participación`.
`Ronda 1—N Voto anónimo`; `Opción 1—N Voto anónimo`.

Voto y Participación solo comparten el identificador de ronda. No crear una tabla de enlace, vista administrativa ni log que asocie participante y opción. El servidor necesariamente procesa temporalmente la solicitud autenticada y la selección; reducir persistencia y trazas no elimina la posibilidad de correlación privilegiada.

### Desvinculación física al cerrar la ronda

Voto y Participación se insertan en la misma transacción para garantizar un único voto. Mientras la ronda está abierta, PostgreSQL permite enlazarlos por el identificador de transacción (`xmin`) y por el orden físico de inserción. Al cerrar la ronda, el servidor vuelve a insertar los votos de esa ronda en orden aleatorio dentro de la transacción de cierre y ejecuta `VACUUM FULL anonymous_votes` para eliminar las versiones antiguas. Solo cuando `VACUUM FULL` termina se registra `rounds.votes_unlinked_at`; si falla, la ronda queda cerrada (no acepta votos), el panel de moderación muestra un aviso persistente con «Reintentar limpieza», y se rechazan la publicación de resultados y la finalización de la Asamblea hasta completarla. Al iniciar, la API completa la limpieza pendiente de todas las asambleas, incluidas rondas publicadas antes de esta protección; si no puede, se niega a arrancar salvo que `ALLOW_START_WITH_PENDING_VOTE_CLEANUP=true` se configure como decisión explícita de emergencia (por ejemplo, disco lleno durante una asamblea), lo que queda registrado como error y mantiene bloqueadas la publicación y la finalización. `test/vote-secrecy.integration.spec.ts` verifica que no quede ningún enlace y el caso de fallo.

Riesgo residual durante una ronda abierta: no tomar respaldos ni copias de la base, no registrar sentencias SQL y limitar el acceso directo a PostgreSQL. El WAL puede conservar temporalmente las inserciones originales. Controles automáticos: `scripts/candidate-backup.sh` se niega a respaldar con una papeleta abierta y, para cubrir una apertura entre esa comprobación y `pg_dump`, antes de volcar reinserta en orden aleatorio los votos de todas las rondas no abiertas (también sobre el esquema anterior, para el respaldo previo a una actualización), y descarta el respaldo si el propio archivo contiene una ronda abierta (un respaldo lógico no incluye `xmin` ni versiones antiguas, pero sí el orden físico de las filas), `docker-compose.candidate.yml` fija `log_statement=none` y `log_min_duration_statement=-1`, y la API advierte al iniciar si PostgreSQL registra sentencias.
