# Fase 04 — Frontend para delegado, moderador y proyector

**Prioridad:** P0
**Objetivo:** implementar tres vistas web adaptables, de uso simple y accesibles, conectadas a los contratos del backend. La presentación final espera la segunda iteración de Figma.

## Alcance y tareas ordenadas

1. **P0 — Preparar Vue 3 + TypeScript + Vite.** Configurar rutas, manejo de errores, cliente API/socket y estado de conexión. Evitar estado de negocio duplicado que contradiga al servidor.
2. **P0 — Crear tokens y componentes provisionales.** Usar la identidad ASDMR aprobada (azul principal `#0F3999`, azul oscuro `#0A245E`, paleta del scope), tipografía legible, foco visible, contraste y botones adecuados a teléfono. Sustituir/ajustar con Figma en segunda iteración.
3. **P0 — Vista de ingreso del delegado.** QR abre la sala; formulario breve de nombre y apellido; mensajes de validación y confirmación; sin cuenta. Evitar que nombre se publique hasta que la persona envíe el ingreso.
4. **P0 — Vista de espera y papeleta del delegado.** Mostrar estado de sala; al abrir ronda, mostrar título, opciones, selección/revisión y confirmación explícita. Tras voto confirmado, mostrar recibo de participación sin repetir la selección en pantalla compartida ni permitir edición.
5. **P0 — Panel del moderador.** Mostrar estado, QR, participantes, controles de corrección/retiro, cierre de lobby, configuración de ronda, apertura, progreso, cierre y publicación en acciones distintas. Confirmar acciones sensibles y prevenir doble clic.
6. **P0 — Vista de proyector.** Modo de alto contraste y lectura a distancia: QR/lista acordada en lobby; durante ronda, cargo, estado y progreso agregado; resultados agregados únicamente cuando se publiquen.
7. **P0 — Tratar desconexión, recarga y estado tardío.** Mensajes claros, reconexión, solicitud de snapshot; impedir que una pantalla aparente voto confirmado si el servidor no lo confirmó.
8. **P1 — Accesibilidad y facilidad de uso.** Navegación por teclado, etiquetas accesibles, foco, objetivos táctiles, errores en lenguaje cotidiano y pruebas en móvil de gama media; evitar depender solo del color.
9. **P1 — Integrar segunda iteración de Figma.** Aplicar componentes y vistas aprobadas cuando estén listas, conservando contratos y accesibilidad; registrar diferencias entre diseño y alcance funcional.
10. **P2 — PWA opcional.** Evaluar solo si aporta acceso/instalación o pantalla completa. No guardar ni sincronizar votos offline.

## Dependencias

- Fase 01: contratos, estados, decisiones de divulgación y tokens de marca.
- Fases 02–03: API y eventos disponibles.
- Segunda iteración de Figma para el acabado visual final; no bloquea prototipo funcional ni pruebas de flujo.

## Criterios de aceptación

- Un delegado puede completar QR → nombre/apellido → espera → seleccionar → revisar → confirmar → recibo, en teléfono sin instalación.
- El nombre se muestra en vistas permitidas del lobby; durante la papeleta no se publica quién falta ni su selección.
- Moderador puede completar el ciclo preparar → abrir → monitorear participación → cerrar → publicar sin resultados parciales.
- El proyector no muestra resultados antes de acción explícita de publicación.
- Cada vista muestra estados de carga, error, desconexión y reconexión sin confundirlos con éxito.
- No existe UI para cambiar un voto emitido ni para editar opciones de una ronda abierta.
- Diseño es usable en teléfono, panel de escritorio y pantalla de proyección; contraste, foco y controles cumplen criterios acordados.
- La segunda iteración Figma se integra sin introducir funciones fuera de V1.

## Entregables

- Aplicación Vue adaptable con rutas de delegado, moderador y proyector.
- Componentes/tokens provisionales y, posteriormente, correspondencia con Figma.
- Manejo de API/socket, errores, conexión y estados de flujo.
- Instrucciones de operación en pantalla (QR y preparación básica).

## Riesgos y notas

- Nombres en proyector son datos personales operativos; validar alcance y tamaño de lista con Secretaría.
- El navegador puede cerrar o borrar almacenamiento; recuperación de sesión debe seguir decisión técnica aprobada.
- La pantalla pública debe permanecer legible desde el fondo del recinto y no exponer listas de ausentes.
- Figma puede llegar después; mantener estilos provisionales deliberadamente simples y reemplazables.

## Qué NO hacer todavía

- No diseñar interfaz final antes de la segunda iteración Figma.
- No construir app nativa, inicio de sesión de delegados o flujo de credenciales individuales.
- No presentar contador por candidato, indicador de preferencia ni resultados parciales.
- No añadir temporizador, animaciones distractoras, puntos o efectos tipo concurso.
- No convertir la PWA en modo de voto offline.

## Checklist para Codex

- [ ] Flujo de delegado cabe en móvil y no requiere cuenta/instalación.
- [ ] Cada confirmación de voto espera respuesta autoritativa del servidor.
- [ ] Panel del moderador separa cerrar ronda y publicar resultados.
- [ ] Proyector usa solo datos permitidos para cada estado.
- [ ] Desconexión/recarga no simula un voto exitoso.
- [ ] Controles tienen etiquetas, foco visible, contraste y tamaño táctil adecuados.
- [ ] Estilos provisionales siguen manual de identidad y quedan listos para Figma.
- [ ] No añadí funciones fuera de alcance V1.
