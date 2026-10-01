# Scope del proyecto: Sistema de votaciones para la Asamblea de Delegados ASDMR

**Estado:** Documento de alcance inicial (V1)
**Organización inicial:** ASDMR – Unión Hondureña
**Preparado:** 1 de octubre de 2026

## 1. Contexto

La Unión Hondureña de la Iglesia Adventista del Séptimo Día Movimiento de Reforma (ASDMR) celebra asambleas de delegados donde se consideran asuntos institucionales y se eligen autoridades, entre ellas presidencia, secretaría, tesorería y direcciones departamentales. El proceso actual se realiza principalmente mediante papeletas secretas.

Se propone una aplicación web para apoyar esas votaciones desde los teléfonos de los delegados, con una dinámica de ingreso sencilla inspirada en Kahoot: QR común, incorporación a una sala y cambios de estado en tiempo real. La primera implementación debe atender una asamblea presencial estimada en 50–70 participantes, muchos de los cuales prefieren una experiencia tecnológica simple.

El Reglamento Interno es la referencia de procedimiento. Entre otros asuntos, el Capítulo V aborda elección y credenciales de delegados, instalación y quórum de la Asamblea, y procedimientos de nombramiento (incluidos 05-04, 05-10, 05-12). El sistema es una herramienta operativa: no sustituye a la Asamblea, a su presidencia ni a Secretaría en la interpretación del Reglamento. Las reglas definitivas por elección deben validarse con la autoridad institucional y, cuando aplique, con los Estatutos vigentes.

El manual de identidad de ASDMR establece el azul como color principal y proporciona una paleta institucional. La interfaz seguirá esa identidad con un diseño sobrio, claro y legible.

## 2. Problema

La votación en papel requiere distribuir, recoger y contabilizar papeletas, mientras que las personas que presiden y Secretaría necesitan saber cuántos participantes se han incorporado y cuántos han emitido su voto. La solución debe reducir pasos y errores operativos sin comprometer la confidencialidad de la selección individual ni atribuir al software decisiones que corresponden a la Asamblea.

## 3. Objetivo general

Diseñar e implementar una aplicación web accesible que facilite la preparación, conducción y publicación de votaciones secretas durante la Asamblea de Delegados de la Unión Hondureña, con una experiencia simple para 50–70 asistentes presenciales y una base organizativa reutilizable por las asociaciones en fases posteriores.

## 4. Objetivos específicos

- Permitir el ingreso desde un QR de sesión, sin cuenta, contraseña ni credencial individual en V1.
- Mostrar al moderador y en la pantalla del proyector qué personas se han unido mediante nombre y apellido.
- Permitir al moderador preparar cargos, preguntas y opciones/candidatos antes de abrir cada votación.
- Actualizar en tiempo real el estado de la papeleta y el conteo de participación, sin revelar resultados parciales.
- Permitir votar sin cronómetro, cerrar la votación bajo decisión del moderador y publicar resultados únicamente cuando este lo indique.
- Separar técnicamente identidad/participación de la selección emitida para proteger el secreto del voto.
- Dejar el modelo de datos listo para organizaciones y asambleas de la Unión y asociaciones, sin habilitar iglesias en V1.

## 5. Usuarios y responsabilidades

| Usuario | Necesidad y responsabilidad |
|---|---|
| Delegado | Ingresar con nombre y apellido, esperar la papeleta, revisar su selección, confirmarla y recibir confirmación. |
| Moderador / mesa autorizada | Abrir la sesión, revisar participantes, cerrar ingreso, configurar y abrir/cerrar votaciones, y publicar resultados. |
| Secretaría | Apoyar la verificación presencial de asistentes y quórum conforme al Reglamento; puede asistir en la revisión de nombres. El sistema no certifica oficialmente la calidad de delegado. |
| Asamblea / pantalla pública | Ver la sala de espera, el estado general de la votación y los resultados después de su publicación. |

## 6. Alcance de la V1

- Aplicación web adaptable a teléfonos y pantallas de escritorio; no se requiere instalar una app.
- Una sesión de Asamblea para la Unión Hondureña, preparada para 50–70 participantes presenciales.
- QR común para entrar a la sesión; alternativa de URL/código corto de sesión como contingencia operativa si se implementa.
- Formulario de ingreso con nombre y apellido; sala de espera con lista de participantes en proyector.
- Herramientas del moderador para revisar, corregir o retirar nombres antes de iniciar votaciones, cerrar el ingreso y gestionar las rondas.
- Papeletas configuradas por el moderador, con candidatos/opciones ingresados por este.
- Voto secreto, una participación por sesión de participante y ronda; confirmación explícita antes de emitir el voto.
- Sin límite de tiempo para votar. El moderador decide cuándo cerrar; el sistema no fuerza el cierre al llegar a cero ni decide quién ganó según reglas no configuradas.
- Indicador de votos recibidos/participantes habilitados para el moderador; durante una votación no se presentan totales por candidato ni selecciones individuales.
- Resultados retenidos hasta que el moderador seleccione **Publicar resultados**.
- Registro de eventos administrativos relevantes (por ejemplo, apertura/cierre y publicación) sin guardar una asociación consultable entre identidad y opción votada.
- Estructura de organización configurable que permita incorporar asociaciones posteriormente.

## 7. Flujo principal

1. El moderador crea/abre la Asamblea y muestra el QR en el proyector.
2. Cada delegado escanea el QR, introduce nombre y apellido y se une sin crear una cuenta.
3. El nombre aparece en la sala de espera; el teléfono del participante confirma el ingreso y queda esperando.
4. La mesa y Secretaría comparan la asistencia del salón con los participantes de la aplicación. La determinación oficial de delegados presentes y del quórum permanece bajo el procedimiento institucional.
5. El moderador revisa nombres duplicados o errores y cierra el ingreso cuando la mesa esté lista.
6. El moderador configura el cargo/pregunta y sus candidatos u opciones, y abre la papeleta.
7. La papeleta aparece en los teléfonos. El delegado selecciona, revisa y confirma. Puede emitir una sola respuesta en esa ronda.
8. El moderador ve el progreso de participación, sin resultados parciales. No hay cronómetro.
9. El moderador cierra la ronda cuando corresponda. El sistema deja de aceptar respuestas y calcula el resultado configurado.
10. El moderador verifica y publica los resultados; estos aparecen en el proyector. Los participantes regresan al estado de espera para la siguiente ronda.

## 8. Reglas funcionales

1. **Identidad de ingreso:** nombre y apellido son requeridos para aparecer en la sala de espera. No equivalen a validación de identidad ni acreditación oficial.
2. **Ingreso controlado:** una vez cerrado el ingreso, no se admiten participantes nuevos salvo que el moderador reabra explícitamente la sala antes de una votación, dejando registro del evento.
3. **Nombres repetidos:** no bloquear automáticamente a dos personas con el mismo nombre; permitir que el moderador los distinga/revise.
4. **Configuración de papeleta:** el moderador define el título, formato, candidatos/opciones y, cuando proceda, la regla de conteo. La V1 no debe codificar “más votos gana” como regla universal.
5. **Inmutabilidad de ronda abierta:** no editar candidatos/opciones después de abrir una votación. Si existe un error, el moderador debe cerrar/anular según decisión de la mesa y crear una nueva ronda; conservar el evento en el historial.
6. **Un voto por ronda:** el servidor acepta como máximo una respuesta por sesión participante y ronda. Una respuesta confirmada no puede editarse desde el dispositivo.
7. **Tiempo:** no existe vencimiento automático. Solo el moderador cierra la papeleta.
8. **Resultados:** no mostrar conteos de opciones antes del cierre; no publicar hasta que el moderador lo ordene.
9. **Autoridad:** quórum, elegibilidad, validez de una ronda, desempates y proclamación oficial corresponden a las instancias designadas por el Reglamento/Asamblea. El sistema presenta datos y ejecuta acciones autorizadas.
10. **Tipos de procedimiento:** V1 se concentra en papeletas electrónicas secretas. Aclamación, votación a mano alzada y otros métodos pueden registrarse en futuras fases, no se simulan como papeleta secreta.

## 9. Seguridad y privacidad

- El nombre del participante puede asociarse a su sesión para la sala de espera y el control de participación; la opción elegida debe persistirse por separado y no incluir un identificador del participante en el registro de voto.
- La aplicación no debe ofrecer al moderador ni a administradores una función para consultar “persona X votó por opción Y”.
- Para contar participación, guardar por separado un recibo/estado de que la sesión participó en una ronda y el voto anónimo de esa ronda. Diseñar el envío para que no cree una relación directa entre ambas tablas/registros.
- Usar HTTPS, controles de acceso para las funciones de moderación, validación de entradas y protección contra doble envío. Las sesiones de participante deben usar identificadores aleatorios no visibles ni editables por el usuario.
- Limitar la información identificable a lo necesario, definir acceso y plazo de conservación, y evitar exponer listas de nombres o datos del dispositivo fuera de la Asamblea.
- En el proyector, mostrar nombres durante la sala de espera; durante una papeleta, mostrar estado y participación agregada, no la lista pública de quién falta ni votos individuales. El moderador puede tener una lista operativa de quién ya participó para prestar ayuda, sin revelar selecciones.
- V1 ofrece una protección práctica contra votos duplicados accidentales por sesión/dispositivo, pero **no garantiza criptográficamente “una persona = un voto”**: sin credenciales individuales una persona podría usar más de un navegador/dispositivo o ingresar con un nombre ajeno. La pantalla de nombres y la revisión presencial son controles operativos, no acreditación digital.
- La aplicación no determina el quórum ni reemplaza la lista oficial de Secretaría. Conexiones o teléfonos no son equivalentes a delegados presentes.

## 10. Identidad visual y experiencia

Basado en el manual de identidad compartido:

- Azul principal `#0F3999`; azul oscuro complementario `#0A245E`.
- Crema `#EFD19F`, gris `#7E7E82`, blanco cálido `#F2F1EF`, azul claro `#3E80F2`, amarillo `#F1BE48` y coral `#FF8D6D` como colores complementarios.
- Mantener el logotipo y sus proporciones según el manual; no cambiar la paleta institucional ni aplicar efectos no autorizados.
- Usar tipografía institucional disponible o una alternativa web legible; el manual menciona Noto Sans para lenguajes inusuales.
- Interfaz de alto contraste, botones amplios, lenguaje cotidiano, instrucciones breves y confirmaciones visibles. En la papeleta puede usarse “Papeleta” para mantener familiaridad con el proceso actual.
- Diseñar vistas diferenciadas para teléfono del delegado, panel del moderador y proyector. En la sala de espera se exhiben nombres; al abrir la votación, el proyector pasa a mostrar el cargo, estado y progreso.

## 11. Arquitectura técnica propuesta

Propuesta inicial que debe validarse al iniciar el desarrollo:

- **Frontend:** Vue 3, TypeScript y Vite; diseño responsive/PWA opcional para acceso desde navegador.
- **Estilos:** CSS con tokens de marca (Tailwind CSS opcional si acelera el desarrollo sin complicar la accesibilidad).
- **Backend:** NestJS con API para operaciones y Socket.IO/WebSockets para cambios en tiempo real.
- **Persistencia:** PostgreSQL; transacciones y restricciones únicas para evitar más de una participación por sesión y ronda.
- **Acceso del moderador:** autenticación y autorización separadas del acceso sencillo de los delegados; credencial del moderador administrada de forma segura.
- **Despliegue:** contenedor Docker en un servidor administrado, dominio institucional y HTTPS. Preparar monitorización, respaldo y una guía de contingencia antes del evento.
- **Principio de diseño:** una sola aplicación modular; no introducir microservicios o infraestructura adicional sin una necesidad demostrada.

La arquitectura debe mantener separados los conceptos de organización, Asamblea, participante, ronda, estado de participación y voto anónimo. La separación lógica por sí sola no prueba secreto absoluto frente a acceso privilegiado al servidor; la política de acceso, retención, auditoría y revisión técnica forman parte del diseño de privacidad.

## 12. Entidades principales

| Entidad | Propósito / datos principales |
|---|---|
| Organización | Nombre, tipo (`union` o `association`), identidad institucional y estado. En V1 se configura la Unión Hondureña. |
| Asamblea | Organización, nombre, fecha, estado, configuración de sala y metadatos operativos. |
| Participante de sesión | Asamblea, nombre y apellido, identificador aleatorio de sesión, hora de ingreso y estado. No contiene el voto. |
| Ronda de votación | Asamblea, título/cargo, formato, reglas configuradas, opciones, estado, tiempos de apertura/cierre y publicación. |
| Opción/candidato | Ronda, nombre/etiqueta y orden mostrado. Se bloquea al abrir la ronda. |
| Participación | Ronda y sesión participante, con estado emitido/pendiente; restricción única por ronda y sesión. No incluye la opción seleccionada. |
| Voto anónimo | Ronda y opción seleccionada; sin `participant_id`, nombre ni clave de enlace con Participación. |
| Evento de auditoría | Actor administrativo, acción, ronda/Asamblea, hora y metadatos mínimos; nunca contenido que vincule identidad y voto. |

## 13. Fuera de alcance de V1

- Cuentas o perfiles de delegados, contraseña, validación por correo o credenciales/QR individuales.
- Importación y cotejo automático contra lista oficial, check-in acreditado y certificación digital de delegados.
- Uso por iglesias locales; no se contempla en V1.
- Operación remota/híbrida: V1 supone que todos están físicamente en el mismo recinto.
- Aplicación nativa para iOS/Android.
- Sustitución de los Estatutos o del Reglamento, cálculo automático de quórum oficial, interpretación legal, proclamación automática o decisión autónoma de desempates.
- Votación pública/nominal, resultados parciales, temporizador o sistema de puntos.
- Procedimientos no secretos (aclamación/mano alzada), gestión integral de la Asamblea, actas institucionales, padrones o directorio permanente.

## 14. Criterios de éxito

- Delegados con distintos niveles de habilidad pueden ingresar escaneando el QR y completando nombre y apellido con instrucciones mínimas.
- El proyector refleja oportunamente los nombres unidos en sala de espera y cambia correctamente de vista durante la papeleta.
- El moderador puede completar el ciclo preparar → abrir → recibir votos → cerrar → publicar sin asistencia técnica continua.
- No hay cronómetro; los votos se reciben hasta el cierre manual.
- El sistema bloquea votos repetidos de la misma sesión en la misma ronda y no presenta resultados parciales.
- La interfaz no permite vincular desde sus vistas operativas un nombre con su opción elegida.
- Una prueba operativa con 50–70 dispositivos/sesiones verifica conectividad, reconexión, proyección y procedimientos de contingencia antes de la Asamblea.
- Secretaría y la mesa pueden mantener su procedimiento oficial para asistencia, quórum y decisiones reglamentarias.

## 15. Riesgos y mitigaciones

| Riesgo | Mitigación prevista |
|---|---|
| Ingreso con nombre ajeno o varios dispositivos por persona | Reconocimiento presencial y revisión de lista en sala; documentar esta limitación y planificar credenciales individuales para V2. |
| Pérdida de Wi-Fi, energía o conectividad | Probar la red del recinto y carga esperada; preparar soporte, instrucciones y procedimiento alterno con papeletas físicas. |
| Delegados con poca familiaridad tecnológica | Flujo QR → nombre → unirse, botones grandes, lenguaje claro, voluntarios de apoyo y simulacro. |
| Duplicados/errores de nombres | Herramientas del moderador para revisar, distinguir y corregir antes de votar. |
| Exposición accidental del voto | Separación de almacenamiento, ausencia de relación persona-opción en el diseño, controles de acceso y revisión técnica. |
| Interpretación incorrecta del Reglamento o reglas electorales | Configuración por ronda y validación previa con Secretaría/autoridad competente; no automatizar desempates o quórum en V1. |
| Falla del dispositivo o sesión desconectada | Diseñar reconexión segura sin permitir segundo voto; definir cómo la mesa resolverá casos excepcionales. |
| Resultados publicados antes de validación | Estado de resultados retenidos y acción explícita de publicación por el moderador. |

## 16. Fases futuras

1. **V1 – Asamblea de la Unión:** ingreso por QR común, nombres visibles, papeletas secretas, control del moderador y publicación manual de resultados.
2. **V1.x – Estabilización:** mejoras basadas en el simulacro y el uso real; reportes operativos y refinamiento de accesibilidad/contingencias.
3. **V2 – Credenciales individuales:** padrón oficial, credenciales únicas emitidas por Secretaría, check-in/validación y controles robustos de elegibilidad y voto único.
4. **V3 – Asociaciones:** habilitar múltiples organizaciones tipo asociación, administración independiente y configuración institucional por Asamblea.
5. **Futuro sujeto a decisión:** iglesias locales, métodos no secretos, más reglas electorales y reportes/actas, siempre después de validar procedimientos con las autoridades correspondientes.

## 17. Decisiones confirmadas

- El primer uso es la Asamblea de Delegados de la Unión Hondureña ASDMR.
- Se esperan aproximadamente 50–70 participantes y todos estarán presencialmente en el mismo lugar.
- El proceso actual es principalmente mediante papeleta secreta.
- El delegado ingresa escaneando un QR común, sin cuenta, e introduce nombre y apellido.
- Los nombres de quienes se unen se muestran en la sala de espera/proyector para facilitar el control visual.
- Existe un moderador que prepara las opciones/candidatos, abre y cierra cada votación y publica resultados.
- No hay límite de tiempo para votar.
- Se protege el secreto: no se debe relacionar el nombre con la opción elegida.
- Las credenciales individuales y la acreditación digital se dejan para una versión futura para mantener la adopción inicial sencilla.
- Se desea dejar la solución preparada para asociaciones; iglesias locales quedan fuera de V1.
- La identidad visual debe seguir el manual de branding compartido.
- El Reglamento Interno orienta el flujo, pero el software no sustituye la autoridad de la Asamblea ni la determinación oficial de Secretaría.

## 18. Pendientes de validación antes de desarrollo

- Confirmar con Secretaría y la mesa las reglas exactas para cada cargo, mayorías, abstenciones, desempates, anulaciones y repetición de rondas; contrastarlas con los Estatutos vigentes además del Reglamento Interno.
- Determinar quién puede operar el panel de moderación y cómo se entregará/acreditará su acceso.
- Definir conservación y eliminación de nombres, participaciones, votos y bitácoras después de la Asamblea.
- Confirmar infraestructura, cobertura y capacidad de la red Wi-Fi del recinto, dominio y plan de contingencia.
- Precisar si el proyector mostrará solamente cantidad de participantes durante el ingreso o también la lista completa de nombres, considerando tamaño y privacidad.
