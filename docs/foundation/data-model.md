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

### Comisiones, quién votó, anulación y repetición

Desde el 21 de octubre de 2026 no existe «Voto nulo»: la papeleta solo muestra los candidatos. Una comisión es una papeleta de nombres escritos por la mesa (como un cargo) con `rounds.member_count` = cuántos integrantes quedarán; cada persona marca de 1 a `election_seats` nombres (al crearla, igual a `member_count`) y nunca envía la papeleta vacía. Puede haber más candidatos que integrantes, nunca menos. Los resultados se publican ordenados por votos; en una comisión, el proyector calcula los porcentajes sobre quienes votaron. Cerrar o publicar no elige a nadie. El flujo anterior de la Comisión de Nombramiento (propuestas, apoyos, aprobación y validación de Secretaría) se eliminó con la migración `20261021000000_simple_committees_no_null_vote`.

La mesa ve en la lista de participantes quién ya votó en la última papeleta abierta (punto amarillo: falta; verde: ya votó), también después de cerrarla y hasta que se abra la siguiente. Se calcula solo con `participations` (que no contiene la selección), nunca con los votos.

La mesa puede anular una papeleta en cualquier estado anterior a su declaración oficial (`rounds.status = 'annulled'`, `annulled_at`, `annul_reason`). Sus votos se eliminan y la ronda pasa por la misma limpieza que el cierre (`votes_unlinked_at`), porque las tuplas borradas conservan su `xmin` hasta el `VACUUM`. Las participaciones se conservan como registro.

Para repetir una votación (por ejemplo, entre los más votados o tras una anulación), la mesa crea una ronda vinculada con `committee_root_round_id` apuntando a la papeleta original, aunque sea de cargo. El resultado oficial se declara siempre en la papeleta original, cuando ella o una de sus repeticiones ya fue contada. Mientras exista una declaración (publicada o no), la papeleta original y sus repeticiones no se pueden anular, repetir ni abrir; la mesa debe retirarla primero (`DELETE /moderator/rounds/:id/official-result`, registrado en el historial). Una repetición todavía en preparación sí se puede anular, porque no tiene votos.

### Borrado después de la Asamblea

Por decisión de Secretaría (octubre 2026), los datos se conservan solo durante la Asamblea y el acta es el registro. Después de finalizarla (`status = 'completed'`), la mesa borra la Asamblea con `DELETE /moderator/assemblies/:id` (cuerpo `{ "confirmation": true }`). En una transacción se eliminan sus rondas (y con ellas opciones, participaciones, votos y declaraciones), las sesiones de participantes, la bitácora y la Asamblea; las rondas van primero porque sus participaciones referencian las sesiones. Luego un `VACUUM FULL` reescribe las tablas para que las filas borradas no queden en sus archivos; si no termina, la respuesta lo indica (`vacuumed: false`) y el borrado sigue siendo válido. Los registros WAL pueden conservar datos hasta que PostgreSQL los recicle, por eso en modo LAN el cierre termina borrando el volumen completo (`scripts/lan.sh borrar-todo`).

### Desvinculación física al cerrar la ronda

Voto y Participación se insertan en la misma transacción para garantizar un único voto. Mientras la ronda está abierta, PostgreSQL permite enlazarlos por el identificador de transacción (`xmin`) y por el orden físico de inserción. Al cerrar la ronda, el servidor vuelve a insertar los votos de esa ronda en orden aleatorio dentro de la transacción de cierre y ejecuta `VACUUM FULL anonymous_votes` para eliminar las versiones antiguas. Cada ronda se reordena en su propia transacción y `VACUUM FULL` se ejecuta en una conexión dedicada con `lock_timeout` de 5 s, para que un bloqueo retenido produzca un error recuperable en lugar de una espera indefinida. Solo cuando `VACUUM FULL` termina se registra `rounds.votes_unlinked_at`; si falla, la ronda queda cerrada (no acepta votos), el panel de moderación muestra un aviso persistente con «Reintentar limpieza», y se rechazan la publicación de resultados y la finalización de la Asamblea hasta completarla. Al iniciar, la API completa la limpieza pendiente de todas las asambleas, incluidas rondas publicadas antes de esta protección; si no puede, se niega a arrancar salvo que `ALLOW_START_WITH_PENDING_VOTE_CLEANUP=true` se configure como decisión explícita de emergencia (por ejemplo, disco lleno durante una asamblea), lo que queda registrado como error y mantiene bloqueadas la publicación y la finalización. `test/vote-secrecy.integration.spec.ts` verifica que no quede ningún enlace y el caso de fallo.

Riesgo residual durante una ronda abierta: no tomar respaldos ni copias de la base, no registrar sentencias SQL y limitar el acceso directo a PostgreSQL. El WAL puede conservar temporalmente las inserciones originales. Controles automáticos: `scripts/candidate-backup.sh` se niega a respaldar con una papeleta abierta y, para cubrir una apertura entre esa comprobación y `pg_dump`, antes de volcar reinserta en orden aleatorio los votos de todas las rondas no abiertas (también sobre el esquema anterior, para el respaldo previo a una actualización), y descarta el respaldo si el propio archivo contiene una ronda abierta (un respaldo lógico no incluye `xmin` ni versiones antiguas, pero sí el orden físico de las filas), `docker-compose.candidate.yml` fija `log_statement=none` y `log_min_duration_statement=-1`, y la API advierte al iniciar si PostgreSQL registra sentencias.
