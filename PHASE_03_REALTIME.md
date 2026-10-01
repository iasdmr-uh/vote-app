# Fase 03 — Tiempo real y reconexión

**Prioridad:** P0
**Objetivo:** mantener sincronizados teléfonos, panel del moderador y proyector mediante Socket.IO, con eventos mínimos y recuperación segura de estado.

## Alcance y tareas ordenadas

1. **P0 — Definir canales y permisos.** Separar sala pública/proyector, canal del moderador y canal de la sesión del participante. Validar autorización al conectar y al suscribirse; un nombre o id de sala no debe bastar para recibir datos administrativos.
2. **P0 — Emitir eventos de lobby.** Notificar ingreso, corrección/retiro aprobado, apertura/cierre del lobby y cambios de estado. La lista de nombres solo se envía a las vistas autorizadas durante lobby conforme a política acordada.
3. **P0 — Emitir eventos de ronda.** Preparación, apertura, cierre y publicación. A participantes se les notifica estado y papeleta abierta; proyector recibe estado y progreso agregado autorizado; resultados solo después de publicación.
4. **P0 — Actualizar progreso sin revelar selecciones.** Moderador recibe cantidad emitida/total elegible y, si se aprueba, una lista operativa privada de quién ya participó para asistencia. El proyector recibe solo agregado; nunca lista de ausentes ni votos individuales.
5. **P0 — Hacer operaciones idempotentes y tolerantes a reconexión.** La conexión recupera estado mediante API/snapshot autorizado, no depende únicamente de eventos perdidos. Reintentos de voto no crean segundo voto ni cambian el primero.
6. **P0 — Gestionar fallos de socket.** Reconectar con backoff moderado, indicar claramente desconexión/estado desactualizado y refrescar snapshot tras reconexión. Una caída de socket no reabre la papeleta ni revierte estado confirmado en backend.
7. **P1 — Probar capacidad de sala para 70 usuarios.** Definir límites de conexiones y heartbeat razonables; validar configuración del servidor en despliegue previsto sin añadir infraestructura extra.
8. **P1 — Documentar contingencia.** Pasos ante Wi-Fi/Internet/socket caído, criterios para pausar o continuar según decisión de la mesa y alternativa de papeletas físicas.

## Dependencias

- Fase 01: contrato de eventos, estados y reglas de divulgación.
- Fase 02: endpoints/snapshot, autorización, persistencia y eventos de dominio.
- Infraestructura y red de recinto confirmadas antes del simulacro.

## Criterios de aceptación

- Cambios de lobby y estado de ronda se reflejan rápidamente en clientes conectados y se recuperan tras una reconexión.
- El delegado solo recibe su propia sesión y la papeleta/estado; no recibe lista de participantes ni actividad individual ajena.
- Durante votación abierta no se envía ningún resultado por opción a ningún cliente.
- El proyector no revela quién falta ni cómo votó alguien; participación agregada se limita a lo acordado.
- Repetición de un evento o reconexión no duplica voto ni altera una ronda cerrada.
- Una conexión no autorizada no puede unirse a canales de moderador ni extraer datos de Asamblea por enumeración.
- El estado recuperado después de una desconexión concuerda con la base de datos, aunque el cliente haya perdido eventos.

## Entregables

- Mapa de canales/eventos con audiencia y campos.
- Gateway Socket.IO con autorización y suscripción segura.
- Recuperación de estado/snapshot y estrategia de reconexión.
- Guía de contingencia de tiempo real.

## Riesgos y notas

- Los eventos y registros de transporte pueden correlacionar tiempos; no incluir token de participante ni selección en mensajes comunes.
- La red local del evento puede ser el principal punto de fallo; ensayar con la infraestructura real.
- WebSocket no sustituye persistencia: la base es fuente de verdad y el cliente debe resincronizar.

## Qué NO hacer todavía

- No añadir Redis adapter, broker o clúster mientras el despliegue de una sola instancia soporte la carga prevista.
- No enviar a la pantalla pública datos operativos privados por comodidad.
- No revelar respuestas en eventos privados al moderador antes de publicar.
- No implementar votación offline con sincronización posterior, pues puede crear conflictos de elegibilidad/cierre.

## Checklist para Codex

- [ ] Cada canal tiene audiencia y autorización explícitas.
- [ ] Los payloads de eventos contienen solo los campos necesarios.
- [ ] Los eventos de voto no transportan identidad y selección juntos.
- [ ] Los resultados solo se emiten tras publicación.
- [ ] Reconexión obtiene snapshot actualizado desde servidor.
- [ ] Reintentos de emisión mantienen idempotencia.
- [ ] La UI puede indicar estado desconectado o desactualizado.
- [ ] La contingencia de red está escrita y se ensayará.
