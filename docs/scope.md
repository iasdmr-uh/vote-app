# Scope del proyecto: Sistema de votaciones para la Asamblea de Delegados ASDMR

**Estado:** Documento de alcance inicial (V1)
**Organización inicial:** ASDMR – Unión Hondureña
**Preparado:** 1 de octubre de 2026
**Actualizado:** 2 de noviembre de 2026 (resultados automáticos, decisiones e inhabilitación)

## 1. Contexto

La Unión Hondureña de la Iglesia Adventista del Séptimo Día Movimiento de Reforma (ASDMR) celebra asambleas de delegados donde se consideran asuntos institucionales y se eligen autoridades, entre ellas presidencia, secretaría, tesorería y direcciones departamentales. El proceso actual se realiza principalmente mediante papeletas secretas.

Se propone una aplicación web para apoyar esas votaciones desde los teléfonos de los delegados, con una dinámica de ingreso sencilla inspirada en Kahoot: QR común, incorporación a una sala y cambios de estado en tiempo real. La primera implementación debe atender una asamblea presencial estimada en 50–70 participantes, muchos de los cuales prefieren una experiencia tecnológica simple.

El Reglamento Interno es la referencia de procedimiento. Entre otros asuntos, el Capítulo V aborda elección y credenciales de delegados, instalación y quórum de la Asamblea, y procedimientos de nombramiento (incluidos 05-04, 05-10, 05-12). El sistema es una herramienta operativa: no sustituye a la Asamblea, a su presidencia ni a Secretaría en la interpretación del Reglamento. Las reglas definitivas por elección deben validarse con la autoridad institucional y, cuando aplique, con los Estatutos vigentes.

El manual de identidad de ASDMR establece el azul como color principal y proporciona una paleta institucional. La interfaz seguirá esa identidad con un diseño sobrio, claro y legible.

## 2. Problema

La votación en papel requiere distribuir, recoger y contabilizar papeletas, mientras que las personas que presiden y Secretaría necesitan saber cuántos participantes se han incorporado y cuántos han emitido su voto. La solución debe reducir pasos y errores operativos sin comprometer la confidencialidad de la selección individual. El software aplica solo las reglas de conteo confirmadas por la mesa; quórum, elegibilidad y proclamación siguen correspondiendo a la Asamblea.

## 3. Objetivo general

Diseñar e implementar una aplicación web accesible que facilite la preparación, conducción y publicación de votaciones secretas durante la Asamblea de Delegados de la Unión Hondureña, con una experiencia simple para 50–70 asistentes presenciales y una base organizativa reutilizable por las asociaciones en fases posteriores.

## 4. Objetivos específicos

- Permitir el ingreso desde un QR de sesión, sin cuenta, contraseña ni credencial individual en V1.
- Mostrar al moderador y en la pantalla del proyector qué personas se han unido mediante nombre y apellido.
- Permitir al moderador preparar cargos, preguntas y opciones/candidatos antes de abrir cada votación.
- Actualizar en tiempo real el estado de la papeleta y el conteo de participación, sin revelar resultados parciales.
- Permitir votar sin cronómetro, cerrar la votación bajo decisión del moderador y mostrar el resultado a todos a la vez cuando los votos se separan.
- Calcular automáticamente electos, desempates y decisiones con mayoría sobre los participantes habilitados.
- Separar técnicamente identidad/participación de la selección emitida para proteger el secreto del voto.
- Dejar el modelo de datos listo para organizaciones y asambleas de la Unión y asociaciones, sin habilitar iglesias en V1.

## 5. Usuarios y responsabilidades

| Usuario | Necesidad y responsabilidad |
|---|---|
| Delegado | Ingresar con nombre y apellido, esperar la papeleta, revisar su selección, confirmarla y recibir confirmación. |
| Moderador / mesa autorizada | Abrir la sesión, revisar e inhabilitar/habilitar participantes, cerrar ingreso, configurar, abrir, cerrar y anular votaciones, y agregar resultados finales a oficiales. No elige ganadores. |
| Secretaría | Apoyar la verificación presencial de asistentes y quórum conforme al Reglamento; puede asistir en la revisión de nombres. El sistema no certifica oficialmente la calidad de delegado. |
| Asamblea / pantalla pública | Ver la sala de espera, el estado general de la votación y los resultados cuando se muestran al cerrar. |

## 6. Alcance de la V1

- Aplicación web adaptable a teléfonos y pantallas de escritorio; no se requiere instalar una app.
- Una sesión de Asamblea para la Unión Hondureña, preparada para 50–70 participantes presenciales.
- QR común para entrar a la sesión; alternativa de URL/código corto de sesión como contingencia operativa si se implementa.
- Formulario de ingreso con nombre y apellido; sala de espera con lista de participantes en proyector.
- Herramientas del moderador para revisar, corregir o retirar nombres antes de iniciar votaciones, cerrar el ingreso y gestionar las rondas.
- Papeletas configuradas por el moderador, con candidatos/opciones ingresados por este.
- Voto secreto, una participación por sesión de participante y ronda; confirmación explícita antes de emitir el voto.
- Sin límite de tiempo para votar. El moderador decide cuándo cerrar; el sistema no fuerza el cierre al llegar a cero.
- Resultado automático al cerrar: electos, desempates y decisiones según las reglas 11–16 de la sección 8.
- Indicador de votos recibidos/participantes habilitados para el moderador; durante una votación no se presentan totales por candidato ni selecciones individuales.
- Resultado visible para todos al cerrar, una vez separados los votos de los participantes. Mientras tanto, teléfonos, proyector y mesa muestran «Preparando el resultado» (texto sin confirmar).
- Cada resultado dice si es final o quiénes pasan a la siguiente votación. La mesa agrega cada resultado final a la lista de oficiales con **Agregar a oficiales** (texto sin confirmar), y una vez agregado no cambia.
- Registro de eventos administrativos relevantes (por ejemplo, apertura/cierre y registro en oficiales) sin guardar una asociación consultable entre identidad y opción votada.
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
10. Al separarse los votos, el resultado aparece a la vez en teléfonos, proyector y mesa. Si quedan puestos sin cubrir, el sistema deja preparado el desempate como borrador y la mesa lo abre. Los participantes regresan al estado de espera para la siguiente ronda.
11. Cuando la elección tiene resultado final, la mesa lo agrega a oficiales. Otra elección no se abre mientras haya un resultado final sin agregar o un desempate pendiente. «Presentar oficiales» muestra solo los resultados agregados.

## 8. Reglas funcionales

1. **Identidad de ingreso:** nombre y apellido son requeridos para aparecer en la sala de espera. No equivalen a validación de identidad ni acreditación oficial.
2. **Ingreso controlado:** una vez cerrado el ingreso, no se admiten participantes nuevos salvo que el moderador reabra explícitamente la sala antes de una votación, dejando registro del evento.
3. **Nombres repetidos:** no bloquear automáticamente a dos personas con el mismo nombre; permitir que el moderador los distinga/revise.
4. **Configuración de papeleta:** el moderador define el título, el tipo (Cargo, Comisión o Decisión), los candidatos/opciones, los puestos de una comisión (N) y, en decisiones, la regla de aprobación (mayoría simple; 2/3, Reglamento 01-02 03, ver #87; o 3/4, regla de la Junta, ver #88).
5. **Inmutabilidad de ronda abierta:** no editar candidatos/opciones después de abrir una votación. Si existe un error, el moderador debe cerrar/anular según decisión de la mesa y crear una nueva ronda; conservar el evento en el historial.
6. **Un voto por ronda:** el servidor acepta como máximo una respuesta por sesión participante y ronda. Una respuesta confirmada no puede editarse desde el dispositivo.
7. **Tiempo:** no existe vencimiento automático. Solo el moderador cierra la papeleta.
8. **Resultados:** no mostrar conteos de opciones antes del cierre. Al cerrar, nadie ve conteos, ni siquiera la mesa, hasta que los votos se separan; entonces todos los ven a la vez.
9. **Autoridad:** quórum, elegibilidad oficial, validez de una ronda y proclamación corresponden a las instancias designadas por el Reglamento/Asamblea. El resultado es 100 % automático según las reglas 11–17: la mesa solo abre, cierra, agrega resultados finales a oficiales y puede anular; nunca elige ganadores. No se puede anular una votación cuando ya se abrió la siguiente de su elección o cuando la elección ya está en oficiales.
10. **Tipos de procedimiento:** V1 se concentra en papeletas electrónicas secretas. Aclamación, votación a mano alzada y otros métodos pueden registrarse en futuras fases, no se simulan como papeleta secreta.
11. **Mayoría y electos (cargos y comisiones):** la base son los participantes habilitados congelados al abrir la votación (`eligibleCount`); los inhabilitados y quienes no votan cuentan en ella. Mayoría = más del 50 % de la base (38 → 20); la mitad exacta no es mayoría. Un cargo tiene N = 1; una comisión, N puestos. Queda electo quien está entre los N primeros **y** tiene mayoría. Si hay más candidatos con mayoría que puestos, quedan los más votados; un empate en el corte va a desempate solo entre los empatados.
12. **Desempates:** pasan los que están entre los N primeros sin mayoría y los empatados en el corte. Si así no hay más candidatos que puestos libres, entra también el siguiente (y sus empatados); en un cargo, los 2 primeros más los empatados con el 2.º. En el desempate se exige de nuevo mayoría y se repite hasta cubrir los puestos. Mientras quedan puestos abiertos, el resultado es preliminar y quienes ya quedaron electos aparecen como «Electo/a». El resultado es final, y la mesa lo agrega a oficiales, solo cuando la elección está completa, con todos los puestos cubiertos (decisión del 8 de noviembre de 2026). El sistema prepara cada desempate como borrador; la mesa lo abre. Ejemplo: comisión de 3, el 1.º con mayoría, el 2.º sin mayoría, el 3.º y el 4.º empatados → queda el 1.º; el 2.º, el 3.º y el 4.º van a desempate por 2 puestos.
13. **Selección exacta y candidato nuevo:** en comisiones y desempates cada delegado marca exactamente los puestos abiertos, ni más ni menos; el servidor también lo valida. Desde la 3.ª votación (2.º desempate en adelante) la mesa puede agregar un candidato nuevo; nunca en el primer desempate.
14. **Decisiones:** formato A favor / En contra u Opciones (se elige una), con regla de mayoría simple (más de 1/2 de la base), 2/3 (al menos 2/3 de la base, redondeado hacia arriba: 28 → 19; Reglamento 01-02 03, ver #87) o 3/4 (al menos 3/4 de la base, redondeado hacia arriba: 38 → 29; regla de la Junta, definitiva desde el 8 de noviembre de 2026, ver #88). Base = participantes habilitados; sin abstención. A favor / En contra: aprobada si «A favor» alcanza el umbral; si no, no aprobada (50/50 = no aprobada). Opciones: la ganadora debe alcanzar el umbral; si ninguna lo logra, se repite entre las 2 más votadas y las empatadas.
15. **Salir de la sala, Retirar de la sala e Inhabilitar:** el delegado no puede salir de la sala por su cuenta; el teléfono no tiene botón Salir y el servidor rechaza la petición, para evitar salidas por error. Si alguien deja la sala, la mesa lo retira con «Retirar de la sala». La persona queda en «Fuera de la sala», su sesión deja de funcionar y no cuenta en la base. La mesa puede regresarla con «Regresar a la sala» cuando no hay una votación abierta, y reconectar su dispositivo con un código de un solo uso. Retirar y regresar quedan en el historial. El cambio cuenta desde la siguiente votación: la votación abierta conserva la base con la que se abrió, y las papeletas en borrador usan la lista nueva. **Inhabilitar** es otra acción, para quien sigue presente pero no debe votar: sigue en la sala y en la lista, no recibe papeletas, el servidor rechaza su voto y sigue contando en la base. Es reversible (Habilitar) y queda en el historial. Un voto ya emitido se conserva. Desde el 8 de noviembre de 2026 (#55), mientras hay una votación abierta la mesa no puede retirar, regresar, inhabilitar ni habilitar a nadie, incluida la Secretaría Regional; lo hace al cerrarla. Desde el 8 de noviembre de 2026 (#78), mientras hay una votación abierta la mesa no puede generar códigos de reconexión y nadie puede usar un código de un solo uso, ni de reconexión ni el de ingreso de la Secretaría Regional. Un código generado antes sigue sirviendo cuando la votación se cierra o se anula, hasta que se usa o vence. Un teléfono que pierde la red y vuelve conserva su sesión. La Secretaría Regional no tiene reconexión; si pierde el dispositivo, la mesa la retira y la agrega de nuevo (regla 17). **Línea de quórum:** la mesa ve «En sala X de Y · quórum Z» junto a la lista de participantes. Quedan acreditadas todas las personas que entraron por el QR, excepto la Secretaría Regional (que la mesa ve en la lista como «Secretario regional» y retira con la misma acción, sin «Regresar a la sala» ni «Inhabilitar»; ver la regla 17), y las que fueron retiradas por error antes de votar no cuentan. Están en sala las acreditadas que no fueron retiradas de la sala. El quórum es dos tercios de las acreditadas, redondeado hacia arriba (Reglamento 05-04 5). Si en sala hay menos que el quórum, la línea se pone en rojo con «Sin quórum» y la confirmación para abrir una votación repite el aviso. Solo avisa, nunca impide abrir la votación.
16. **Conteo publicado:** se muestra al separarse los votos, con los votos de cada candidato/opción y cuántos no votaron (base − votos emitidos).
17. **Empate persistente (Reglamento 05-09 02):** desde la 4.ª votación, si la votación anterior empató en el corte, la mesa puede agregar a la secretaría regional, representante de la Asociación General, como un votante secreto más. Aplica a cargos, comisiones y decisiones con Opciones. Entra con un código de un solo uso, suma 1 a la base solo en esas votaciones y sigue en las siguientes de esa misma elección mientras esté en la sala. La mesa la ve en la lista de participantes como «Secretario regional», sin ver nunca cómo votó, y puede retirarla con «Retirar de la sala» y la misma confirmación. Desde la siguiente votación ya no cuenta en la base ni recibe papeleta, y la votación abierta conserva la base con la que se abrió. No tiene «Regresar a la sala» ni «Inhabilitar»; para que vuelva, la mesa la agrega de nuevo con la acción de esta regla, que conserva las condiciones del Reglamento 05-09 02 y le da un código nuevo. No recibe otras papeletas. La pantalla y el acta dicen «Con la secretaría regional». Si el empate era 5-5 y queda 6-5, la aritmética puede revelar su voto.

## 9. Seguridad y privacidad

- El nombre del participante puede asociarse a su sesión para la sala de espera y el control de participación; la opción elegida debe persistirse por separado y no incluir un identificador del participante en el registro de voto.
- La aplicación no debe ofrecer al moderador ni a administradores una función para consultar “persona X votó por opción Y”.
- Para contar participación, guardar por separado un recibo/estado de que la sesión participó en una ronda y el voto anónimo de esa ronda. Diseñar el envío para que no cree una relación directa entre ambas tablas/registros.
- Usar HTTPS, controles de acceso para las funciones de moderación, validación de entradas y protección contra doble envío. Las sesiones de participante deben usar identificadores aleatorios no visibles ni editables por el usuario.
- Limitar la información identificable a lo necesario, definir acceso y plazo de conservación, y evitar exponer listas de nombres o datos del dispositivo fuera de la Asamblea.
- En el proyector, mostrar nombres durante la sala de espera; durante una papeleta, mostrar estado y participación agregada, no la lista pública de quién falta ni votos individuales. ~~El moderador puede tener una lista operativa de quién ya participó para prestar ayuda, sin revelar selecciones.~~ Desde el 8 de noviembre de 2026 (#55) la mesa ve solo cuántos votaron y la base, nunca quién, con la votación abierta o ya cerrada.
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
| Participante de sesión | Asamblea, nombre y apellido, identificador aleatorio de sesión, hora de ingreso y estado (incluye habilitado/inhabilitado). No contiene el voto. |
| Ronda de votación | Asamblea, título/cargo, tipo (cargo, comisión o decisión), puestos, regla de aprobación, ronda de origen si es desempate, base al cierre, opciones, estado, tiempos de apertura/cierre y publicación. |
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
- Sustitución de los Estatutos o del Reglamento, cálculo automático de quórum oficial, interpretación legal o proclamación oficial. El cálculo de electos, desempates y decisiones sí es automático (sección 8).
- Votación pública/nominal, resultados parciales, temporizador o sistema de puntos.
- Procedimientos no secretos (aclamación/mano alzada), gestión integral de la Asamblea, actas institucionales, padrones o directorio permanente.

## 14. Criterios de éxito

- Delegados con distintos niveles de habilidad pueden ingresar escaneando el QR y completando nombre y apellido con instrucciones mínimas.
- El proyector refleja oportunamente los nombres unidos en sala de espera y cambia correctamente de vista durante la papeleta.
- El moderador puede completar el ciclo preparar → abrir → recibir votos → cerrar → agregar a oficiales sin asistencia técnica continua.
- No hay cronómetro; los votos se reciben hasta el cierre manual.
- El sistema bloquea votos repetidos de la misma sesión en la misma ronda y no presenta resultados parciales.
- Electos, desempates y decisiones calculados coinciden con las reglas 11–16 en todos los casos de prueba.
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
| Interpretación incorrecta del Reglamento o reglas electorales | Reglas confirmadas con la mesa (2 de noviembre de 2026), cálculo con pruebas por caso y anulación por la mesa; no automatizar quórum en V1. |
| Falla del dispositivo o sesión desconectada | Diseñar reconexión segura sin permitir segundo voto; definir cómo la mesa resolverá casos excepcionales. |
| «X de Y conectados» leído como asistencia | El conteo indica solo teléfonos conectados. Un teléfono con la pantalla bloqueada puede perder la conexión y contar como no conectado, y un teléfono conectado no prueba que su dueño esté en la sala. |
| Resultados publicados antes de validación | Nadie, ni siquiera la mesa, ve conteos antes de que los votos se separen. Un resultado entra a oficiales solo cuando la mesa lo agrega. |

## 16. Fases futuras

1. **V1 – Asamblea de la Unión:** ingreso por QR común, nombres visibles, papeletas secretas, control del moderador, resultados visibles al cerrar y lista de oficiales.
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
- Existe un moderador que prepara las opciones/candidatos, abre y cierra cada votación y agrega los resultados finales a oficiales (#76).
- Los resultados son automáticos: mayoría sobre habilitados, desempates encadenados, selección exacta, decisiones (simple, 2/3 o 3/4, ver #87 y #88) e inhabilitación (reglas 11–16, 2 de noviembre de 2026).
- No hay límite de tiempo para votar.
- Se protege el secreto: no se debe relacionar el nombre con la opción elegida.
- Las credenciales individuales y la acreditación digital se dejan para una versión futura para mantener la adopción inicial sencilla.
- Se desea dejar la solución preparada para asociaciones; iglesias locales quedan fuera de V1.
- La identidad visual debe seguir el manual de branding compartido.
- El Reglamento Interno orienta el flujo, pero el software no sustituye la autoridad de la Asamblea ni la determinación oficial de Secretaría.

## 18. Pendientes de validación antes de desarrollo

- ~~Confirmar con Secretaría y la mesa las reglas exactas para cada cargo, mayorías, abstenciones, desempates, anulaciones y repetición de rondas.~~ Respondido por Secretaría (octubre 2026):
  - No se valida en el sistema quién vota (votan delegados y ex oficio).
  - ~~No se automatiza la mayoría: se muestran todos los candidatos ordenados por votos y la mesa, con la Asamblea, decide quién continúa (puede repetir la votación entre los más votados) y quién queda. Cerrar una papeleta no elige a nadie. Los empates se resuelven igual.~~ Sustituido el 2 de noviembre de 2026: mayoría y desempates automáticos (reglas 11–13 de la sección 8).
  - ~~Existe el voto en blanco y se llama «Voto nulo».~~ Eliminado el 21 de octubre de 2026: la papeleta solo muestra candidatos y no se puede enviar vacía.
  - La mesa puede anular una papeleta.
  - Comisiones (21 de octubre de 2026): la mesa escribe los candidatos y cuántos integrantes quedarán (N). ~~Cada persona marca de 1 a N~~ Desde el 2 de noviembre de 2026 cada persona marca exactamente N (regla 13); puede haber más candidatos que integrantes. Al publicar, el proyector muestra a todos ordenados de mayor a menor. Se eliminó el flujo de propuestas, apoyos y aprobación de la Comisión de Nombramiento.
  - Reglas automáticas (2 de noviembre de 2026): mayoría sobre habilitados, desempates, selección exacta, candidato nuevo, decisiones, inhabilitación y «no votaron» (reglas 11–16 de la sección 8).
  - ~~La mesa ve quién ya votó (punto amarillo: falta; verde: ya votó), nunca por quién; se mantiene tras cerrar hasta abrir la siguiente papeleta.~~ Desde el 8 de noviembre de 2026 (#55) la mesa ve solo cuántos votaron y la base, nunca quién. El tiempo para votar se maneja de forma presencial.
  - Las llegadas tarde las decide la Asamblea; la mesa reabre el ingreso.
  - Una persona técnica modera; una laptop funciona como servidor en una red Wi-Fi propia (Starlink).
  - En esa red los teléfonos usan HTTP sin cifrar: riesgo aceptado (octubre 2026), con las medidas de `docs/lan-assembly.md`.
  - El proyector muestra nombres y cantidad durante el ingreso.
  - Los datos se conservan solo durante la Asamblea; después rige el acta.
- ~~Determinar quién puede operar el panel de moderación y cómo se entregará/acreditará su acceso.~~ Lo opera la persona técnica, solo desde la laptop servidor (`docs/lan-assembly.md`).
- ~~Definir conservación y eliminación de nombres, participaciones, votos y bitácoras después de la Asamblea.~~ Tras imprimir el acta, la mesa borra los datos desde el panel y el técnico borra la base completa (`docs/lan-assembly.md`).
- Confirmar la cobertura y capacidad del Wi-Fi de Starlink en la sala con un ensayo con teléfonos reales. Ya no se usa dominio; la red es local (`docs/lan-assembly.md`).
- Precisar si el proyector mostrará solamente cantidad de participantes durante el ingreso o también la lista completa de nombres, considerando tamaño y privacidad.
