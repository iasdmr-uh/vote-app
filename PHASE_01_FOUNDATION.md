# Fase 01 — Fundación y decisiones de implementación

**Prioridad:** P0
**Objetivo:** convertir el alcance aprobado en decisiones técnicas mínimas, una estructura ejecutable y contratos coherentes, sin construir aún la interfaz final.

## Alcance y tareas ordenadas

1. **P0 — Confirmar decisiones de producto bloqueantes.** Registrar respuestas de Secretaría/mesa para reglas por papeleta, acceso a moderación, retención/eliminación, contingencia física y criterio de reabrir ingreso. Marcar explícitamente lo que siga pendiente; no inventar reglas.
2. **P0 — Definir arquitectura de una aplicación modular.** Acordar Vue 3 + TypeScript + Vite; NestJS; PostgreSQL; ORM compatible con transacciones/índices únicos; Socket.IO; Docker. Escribir una ADR breve con versiones iniciales y límites del despliegue.
3. **P0 — Crear estructura de repositorio y convenciones.** Separar cliente y servidor o usar workspace sencillo; definir scripts comunes, configuración por entorno, formato/lint y gestión de secretos. Mantener la solución de un solo despliegue lógico cuando sea posible.
4. **P0 — Modelar estados y reglas.** Definir estados permitidos de Asamblea, lobby y ronda; transiciones autorizadas; idempotencia de acciones. Una ronda abierta no cambia sus opciones. El voto es final tras confirmar. Cierre manual, publicación explícita.
5. **P0 — Definir modelo de datos y privacidad.** Organización, Asamblea, participante/sesión, ronda, opción, participación, voto anónimo y evento administrativo. La fila de voto no debe contener clave de participante ni datos de sesión. Participación debe permitir impedir duplicados por sesión/ronda mediante restricción única.
6. **P0 — Definir contrato HTTP y eventos en tiempo real.** Acordar payloads mínimos, errores, roles/canales autorizados y campos que no deben emitirse. Separar los eventos públicos del lobby, privados de participante y privados del moderador.
7. **P1 — Preparar guía de desarrollo local.** Variables de entorno de ejemplo sin secretos, migraciones iniciales, Docker Compose de desarrollo y datos de demostración no sensibles.
8. **P1 — Registrar decisiones de accesibilidad e identidad.** Tokens derivados del manual (incluido azul principal `#0F3999`), contraste, foco, targets táctiles y lenguaje sencillo. La UI visual completa espera la segunda iteración Figma.

## Dependencias

- Scope existente como fuente funcional.
- Secretaría/mesa para reglas y acceso administrativo; privacidad/retención pendiente de responsable institucional.
- Antes de diseñar la UI final: segunda iteración Figma.

## Criterios de aceptación

- Hay ADR/decisiones que identifican lo confirmado, lo pendiente y quién lo valida.
- Estados y transiciones no permiten abrir una papeleta antes de cerrar ingreso, modificar opciones abiertas, aceptar voto tras el cierre ni publicar antes de que el moderador lo solicite.
- El esquema conceptual separa identidad/participación de selección y explica el límite de anonimato frente a privilegios de servidor.
- Los contratos identifican qué datos se pueden ver en proyector, participante y moderador; no hay evento público de identidad + selección.
- Una nueva persona puede seguir la guía y levantar cliente, servidor y PostgreSQL localmente.
- No se incluyen cuentas de delegados, padrón/credenciales individuales, iglesias, múltiples organizaciones activas ni microservicios en V1.

## Entregables

- ADR de arquitectura y decisiones pendientes.
- Diagrama o documento corto de estados y transiciones.
- Modelo de datos lógico y diccionario de datos.
- Borrador de contrato REST y eventos Socket.IO.
- Estructura inicial y guía de ejecución local.

## Riesgos y notas

- Sin credenciales individuales, un delegado podría usar varios dispositivos o un nombre ajeno; QR y nombre no acreditan elegibilidad.
- Separación de tablas no impide correlación mediante logs, marcas temporales o acceso a la base; minimizar trazas y controlar privilegios.
- Reglas de mayoría, abstención, empate, nulidad y repetición dependen de validación institucional.
- No retener más datos ni por más tiempo de lo definido por la organización.

## Qué NO hacer todavía

- No implementar UI final antes de la segunda iteración de Figma.
- No codificar reglas electorales universales, quórum o proclamación automática.
- No añadir autenticación social, cuentas de delegados, credenciales individuales ni roles complejos no requeridos.
- No iniciar microservicios, colas, cachés distribuidas, Kubernetes o multi-región.

## Checklist para Codex

- [ ] Revisé el scope y respeté sus límites V1.
- [ ] Registré decisiones confirmadas y pendientes sin asumir las pendientes.
- [ ] Documenté estados, transiciones y acciones idempotentes.
- [ ] Revisé el modelo para evitar vínculo directo entre identidad y opción.
- [ ] Definí canales/eventos y DTOs con divulgación mínima.
- [ ] Dejé pasos reproducibles para ejecutar el esqueleto local.
- [ ] Aplacé UI final y funciones fuera de alcance.
