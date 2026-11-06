# Fase 05 — Verificación, simulacro y preparación del evento

**Prioridad:** P0
**Objetivo:** demostrar que el flujo es entendible y estable para 50–70 participantes presenciales, que se respetan reglas de privacidad y que existe una contingencia operable.

## Alcance y tareas ordenadas

1. **P0 — Pruebas de dominio y API.** Cubrir transiciones válidas/ inválidas, lobby cerrado, ronda abierta inmutable, voto único por sesión/ronda, voto tras cierre, cierre/publicación separados e idempotencia. Codificar solo reglas aprobadas.
2. **P0 — Pruebas de privacidad.** Revisar esquema, endpoints, eventos, errores, logs y herramientas administrativas para confirmar que no se obtiene identidad asociada a opción. Verificar ausencia de resultados parciales y publicación anticipada.
3. **P0 — Pruebas de integración de tiempo real.** Ingreso simultáneo, eventos de lobby, apertura/cierre, reconexión, recarga y recuperación de snapshot; clientes no autorizados no deben unirse a canales privados.
4. **P0 — Pruebas de flujo con Playwright.** Flujos principales en dispositivos/tamaños representativos: participante, moderador y proyector. Casos de doble clic, retraso, rechazo, refresh y desconexión.
5. **P0 — Prueba de carga con k6.** Simular 50–70 conexiones concurrentes y ráfaga de ingresos/envíos al abrir la papeleta; medir latencias/errores en el entorno más parecido al despliegue. No perseguir cifras de escala empresarial.
6. **P0 — Ensayo de operación presencial.** Usar teléfonos variados, QR en proyector, Wi-Fi del recinto, moderador y Secretaría; recorrer una elección simulada y comprobar visibilidad/legibilidad desde el salón.
7. **P0 — Ensayar contingencias.** Desconectar Wi-Fi, reiniciar cliente/servidor según entorno seguro, recargar navegador y simular pérdida de dispositivo. Aplicar el procedimiento aprobado, incluida papeleta física si corresponde.
8. **P0 — Revisar seguridad y despliegue.** HTTPS, secretos, autorización, límites de abuso básicos, CORS, errores, respaldo y restauración; confirmar que no hay datos de demostración sensibles.
9. **P1 — Revisar accesibilidad y comprensión.** Prueba guiada con usuarios de distintos niveles tecnológicos; observar sin dar instrucciones adicionales y corregir confusiones de texto/estado.
10. **P1 — Preparar lista de salida.** Confirmar responsables, acceso del moderador, URL/QR, Wi-Fi, proyector, dispositivos de respaldo, soporte y alternativa manual. Obtener conformidad de Secretaría/mesa sobre reglas y operación.

## Dependencias

- Fases 01–04 integradas en entorno candidato.
- Playwright y k6 disponibles en pipeline o entorno de desarrollo.
- Infraestructura, dominio, HTTPS y red del recinto confirmados.
- Mesa/Secretaría disponibles para simulacro y validación reglamentaria.

## Criterios de aceptación

- Los escenarios de reglas críticas pasan: no duplicidad por sesión/ronda, no voto tras cierre, no cambio posterior y no resultados antes de publicación.
- Pruebas verifican que ningún API, evento, vista o log expone selección relacionada con identidad.
- 50–70 sesiones completan el recorrido en la red prevista sin errores bloqueantes; límites concretos de latencia y tasa de error se acuerdan antes de evaluar la corrida.
- La reconexión recupera estado correcto y no duplica participación.
- Delegados de prueba pueden ingresar y votar con instrucciones breves; moderador completa el ciclo sin intervención técnica continua.
- Proyector funciona en lobby, ronda y resultados y no filtra listas o selecciones no autorizadas.
- Existe contingencia probada para Wi-Fi, pérdida de sesión/dispositivo y continuidad manual.
- Secretaría/mesa valida previamente las reglas cargadas y entiende que el sistema no acredita identidad, quórum ni proclamación.

## Entregables

- Suite Playwright para recorridos críticos.
- Escenarios y resultados k6 documentados, con entorno y límites de aceptación.
- Matriz de pruebas funcionales, privacidad y operación.
- Informe breve de simulacro y problemas corregidos/pendientes.
- Checklist de salida y guía de contingencia.

## Riesgos y notas

- Una prueba con 70 sesiones no prueba seguridad frente a ataque dirigido ni acredita que sean 70 delegados elegibles.
- El entorno real de Wi-Fi, proyección y dispositivos puede diferir de desarrollo; el simulacro presencial es clave.
- Una política de anonimato debe ser revisada por responsables institucionales; pruebas de software no sustituyen esa revisión.
- No activar el sistema para votación oficial mientras queden errores P0, reglas sin validar o contingencia sin ensayo.

## Qué NO hacer todavía

- No declarar el sistema certificado o infalible a partir de una prueba de carga.
- No usar datos personales reales en cargas de prueba o capturas compartidas.
- No ampliar el alcance a pentesting externo, auditoría legal o certificaciones no presupuestadas; registrar como fase separada si se solicita.
- No reemplazar el procedimiento institucional de Secretaría ni el plan manual de contingencia.

## Checklist para Codex

- [ ] Casos críticos de estado, autorización, duplicado y publicación tienen cobertura.
- [ ] Revisé base de datos, API, socket, UI y logs en busca de filtraciones de voto.
- [ ] Simulé 50–70 sesiones con k6 en entorno representativo y guardé resultados.
- [ ] Recorrí los tres roles con Playwright, incluyendo fallos y reconexión.
- [ ] Ensayé QR, red, proyector y flujo completo con teléfonos reales.
- [ ] Probé la contingencia física y documenté responsables/pasos.
- [ ] Registré problemas por prioridad y resolví todos los P0 antes de uso.
- [ ] Secretaría/mesa validó reglas, operación y límites conocidos.
