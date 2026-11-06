# Fase 02 — Backend, persistencia y reglas de negocio

**Prioridad:** P0
**Objetivo:** implementar el núcleo confiable de una Asamblea V1: ingreso por QR, control de lobby, preparación de papeletas, emisión única por sesión/ronda, cierre, cálculo y publicación bajo control del moderador.

## Alcance y tareas ordenadas

1. **P0 — Crear aplicación NestJS modular y configuración segura.** Módulos pequeños para Asamblea, lobby, rondas, votos, moderación y auditoría; validar configuración al inicio; no guardar secretos en el repositorio.
2. **P0 — Implementar PostgreSQL, ORM y migraciones.** Crear tablas acordadas en fase 1, claves/índices y restricciones. Incluir unicidad de participación por sesión y ronda. No usar claves de participante en el registro de voto.
3. **P0 — Resolver acceso del moderador.** Implementar el mecanismo mínimo validado (por ejemplo, cuenta operativa autenticada o secreto rotado), autorización en cada operación y protección frente a intentos repetidos. No exponer credenciales en cliente delegado ni URL pública.
4. **P0 — Crear/abrir Asamblea y emitir acceso de sala.** Generar QR con URL/código no predecible o suficientemente aleatorio; permitir ingreso de nombre y apellido sin cuenta. Si el URL/token es público en proyector, limitarlo a incorporarse mientras el lobby esté abierto.
5. **P0 — Gestionar participantes y lobby.** Listar nombres para moderador/proyector según alcance acordado; editar/corregir/retirar participante con auditoría mínima; cerrar ingreso y reabrir explícitamente solo si se aprobó esa operación.
6. **P0 — Gestionar papeletas y opciones.** Crear título, formato, opciones/candidatos y orden; validar configuración según reglas institucionales ya aprobadas; bloquear cambios al abrir. Permitir anulación/cancelación según decisión documentada.
7. **P0 — Implementar flujo de voto en transacción.** Validar Asamblea/ronda abierta, sesión habilitada y no participante previo; registrar anónimamente la selección y la marca de participación separada. Evitar enviar identificadores comunes o correlacionables en el mismo evento/log. Responder confirmación genérica sin eco innecesario de la opción.
8. **P0 — Cerrar y calcular resultados.** El cierre requiere moderador, es idempotente y detiene nuevas emisiones. Calcular internamente solo después del cierre; mantener resultados ocultos hasta publicación explícita.
9. **P0 — Publicar resultados y registrar auditoría.** La publicación debe ser una acción separada, autorizada y auditable. Eventos registran quién realizó acción administrativa y cuándo, sin contenido que vincule nombre y selección.
10. **P0 — Aplicar privacidad y robustez básica.** Validación DTO, límites razonables de tamaño/frecuencia, CORS restringido, cabeceras, HTTPS en producción, manejo seguro de errores y redactado de logs.
11. **P1 — Implementar recuperación de sesión.** Permitir reconexión del mismo navegador con identificador aleatorio durable; resolver pérdida de almacenamiento o cambio de dispositivo mediante procedimiento de mesa, sin inventar reasignación que habilite doble voto.
12. **P1 — Añadir retención/eliminación operativa.** Implementar política aprobada para datos de Asamblea y bitácoras; añadir procedimiento documentado de respaldo/restauración.

## Dependencias

- Fase 01 cerrada: estados, modelo, contratos y ADR.
- Decisión validada de autenticación de moderador y reglas por ronda.
- Política de retención aprobada antes de activar borrado automático.

## Criterios de aceptación

- Un usuario puede ingresar con nombre y apellido mientras el lobby está abierto; se rechazan ingresos al cerrarlo.
- Un moderador autorizado puede preparar y abrir una ronda; la configuración queda inmutable al abrir.
- No se aceptan más de una participación por sesión/ronda, incluso ante solicitudes concurrentes/repetidas.
- Un voto confirmado no puede editarse; votos posteriores al cierre se rechazan.
- Antes del cierre, ninguna ruta, respuesta, log, evento o vista administrativa revela conteos por opción o selección individual.
- Cerrar ronda y publicar resultados son acciones distintas; solo tras publicar se exponen los resultados agregados permitidos.
- Consultas y esquema operativo no ofrecen relación directa participante → opción; eventos/auditoría no añaden una vía de correlación evitable.
- Acciones relevantes del moderador quedan auditadas sin registrar secretos ni selecciones individuales.

## Entregables

- API NestJS documentada con DTOs, errores y autorización.
- Migraciones y esquema PostgreSQL.
- Servicios de dominio para lobby, ronda, voto, cierre y publicación.
- Procedimiento de configuración, respaldo y retención.
- Registro de decisiones de seguridad y límites conocidos.

## Riesgos y notas

- La separación lógica reduce exposición accidental, pero no constituye anonimato criptográfico contra administrador con acceso a base y logs.
- Una restricción única protege por sesión; no acredita “una persona = un voto”.
- Diseñar cuidadosamente transacciones para que una respuesta fallida no deje participación registrada sin voto, o un voto sin su marca de participación; decidir el orden y rollback.
- Los registros de auditoría deben guardar acciones, no cuerpos HTTP ni payloads de voto.

## Qué NO hacer todavía

- No añadir votación nominal, conteos parciales, temporizador o voto editable.
- No automatizar quórum, elegibilidad, ganador, desempates o proclamación.
- No habilitar organizaciones/asociaciones múltiples en la interfaz ni flujo de iglesias.
- No añadir eventos sourcing, blockchain, cifrado homomórfico o sistemas distribuidos sin requisito aprobado.

## Checklist para Codex

- [ ] Migraciones reflejan el modelo aprobado y tienen claves/índices necesarios.
- [ ] Las operaciones críticas aplican validación, autorización y transacciones.
- [ ] La unicidad de participación se impone en servidor/base de datos.
- [ ] Los resultados son inaccesibles antes de cierre/publicación según el estado.
- [ ] La selección no contiene identidad, sesión ni token correlacionable.
- [ ] Logs y auditoría no capturan payloads de voto ni secretos.
- [ ] Las reglas no confirmadas permanecen configurables o explícitamente pendientes.
- [ ] Documenté los límites de credenciales y anonimato para revisión institucional.
