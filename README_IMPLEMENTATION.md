# Backlog técnico de implementación — ASDMR Voting System

**Base:** `scope-sistema-votaciones-asdmr.md` (alcance V1, 1 de octubre de 2026)
**Estado:** backlog de planificación; no implica que exista código implementado.

## Propósito y orden recomendado

Construir un MVP para una Asamblea presencial de 50–70 delegados de la Unión Hondureña. El ingreso es por QR común, sin cuenta, con nombre y apellido. El moderador dirige el flujo; los resultados permanecen ocultos hasta su publicación explícita. La selección se almacena separada de la identidad y participación. La solución no acredita oficialmente delegados ni determina quórum, validez reglamentaria, desempates o proclamación.

Ejecutar las fases en este orden:

1. [PHASE_01_FOUNDATION.md](PHASE_01_FOUNDATION.md) — decisiones, estructura y contratos mínimos.
2. [PHASE_02_BACKEND.md](PHASE_02_BACKEND.md) — persistencia, reglas y API.
3. [PHASE_03_REALTIME.md](PHASE_03_REALTIME.md) — actualizaciones en vivo y reconexión.
4. [PHASE_04_FRONTEND.md](PHASE_04_FRONTEND.md) — experiencias de delegado, moderador y proyector.
5. [PHASE_05_TESTING.md](PHASE_05_TESTING.md) — verificación, simulacro y preparación de operación.

Las fases 2 y 3 pueden diseñarse en paralelo tras la fase 1, pero la integración de tiempo real depende del modelo y las reglas acordadas en fase 2. No saltar a UI final antes de la segunda iteración de Figma; sí se permite construir flujo funcional con estilos provisionales alineados al manual de marca.

## Prioridades

- **P0:** imprescindible para el MVP seguro y operable en la primera Asamblea.
- **P1:** necesario para una operación sólida o mejora directa de adopción; completar antes del evento si aplica.
- **P2:** conveniente, pero diferible sin bloquear el MVP.

## Decisiones rectoras

- Stack propuesto: Vue 3 + TypeScript + Vite; NestJS; PostgreSQL; ORM compatible; Socket.IO/WebSockets; Docker; Playwright; k6.
- Elegir un ORM que soporte transacciones y restricciones únicas en PostgreSQL; decidirlo al inicio, sin incorporar abstracciones adicionales.
- Una sola aplicación modular; no microservicios.
- Sin cronómetro, resultados parciales, edición de voto emitido ni vínculo consultable persona → opción.
- No almacenar `participant_id`, nombre, token de sesión ni un identificador correlacionable en el registro de voto. Mantener participación y voto en registros separados; revisar cuidadosamente trazas, eventos, colas y logs para que tampoco creen un enlace indirecto.
- El secreto práctico del voto no equivale a anonimato criptográfico frente a acceso privilegiado al servidor. Esta limitación, junto con el límite de “una persona = un voto”, debe documentarse.
- V1 atiende una Asamblea de la Unión Hondureña; asociaciones se contemplan en el modelo, pero no se habilitan como producto multi-organización en esta entrega.
- Secretaría y autoridad institucional validan reglas por papeleta, mayoría, abstención, nulidad, empate, repetición y publicación antes de la implementación final de esos comportamientos.

## Dependencias externas que pueden bloquear

- Segunda iteración del diseño en Figma para cerrar la UI visual final.
- Validación de reglas electorales y acceso de moderadores con Secretaría/mesa.
- Decisión sobre retención y eliminación de nombres, participación, votos y bitácoras.
- Confirmación de Wi-Fi, hosting, dominio/HTTPS y procedimiento de contingencia en recinto.

## Cierre del backlog

Una fase se considera terminada al cumplir sus criterios de aceptación, entregar los artefactos indicados y completar su checklist. Toda decisión pendiente debe quedar registrada como tal; Codex no debe inferir políticas institucionales o de privacidad.
