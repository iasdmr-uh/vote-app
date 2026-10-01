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
