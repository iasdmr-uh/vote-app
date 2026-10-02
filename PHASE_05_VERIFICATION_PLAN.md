# Fase 05 — Plan y matriz de verificación operativa

**Estado:** pruebas automatizadas parciales; la prueba puntual contra PostgreSQL local pasó; validación integrada en entorno candidato, carga y simulacro siguen pendientes.
**Base:** `PHASE_05_TESTING.md`, `README_IMPLEMENTATION.md` y `sistema-votaciones-asdmr.md`.
**Objetivo:** convertir los criterios de Fase 05 en escenarios repetibles, con evidencia y bloqueos visibles, para el entorno candidato de la Asamblea ASDMR.

## 1. Condiciones de ejecución

### Evidencia ya disponible

- Compilación y revisión de tipos de API y web: ejecutadas de nuevo el 2026-10-01; npm run typecheck y npm run build finalizaron con código 0.
- Pruebas de API: con una base PostgreSQL nueva y desechable, migración aplicada y TEST_DATABASE_URL explícita, npm run test --workspace @asdmr/api pasó 11/11 (incluida la prueba de integración, sin skips).
- Playwright: npm run test:e2e pasó 6/6 con respuestas sintéticas interceptadas; no valida integración con API ni base de datos. La primera ejecución en sandbox falló al enlazar 127.0.0.1:5173 (EPERM); repetida con autorización para iniciar servidor local, pasó.
- Escenario k6: node --input-type=module --check < tests/load/voting.js pasó la comprobación sintáctica. k6 no está instalado (k6 version: comando no encontrado), así que no se ejecutó carga.
- Ensayos operativos: no ejecutados.

Estos resultados son parciales y no aprueban por sí solos los escenarios de la matriz. Mantener cada fila como `Pendiente` hasta que se ejecute ese escenario y se adjunte su evidencia específica.

No iniciar la aceptación integral hasta tener las fases 01–04 integradas en una versión identificable y desplegada en un entorno candidato. Registrar para cada corrida: versión/commit, fecha, responsables, configuración relevante, datos sintéticos utilizados, ambiente/red/dispositivos y enlaces a evidencia. No usar datos personales reales en pruebas de carga ni en capturas compartidas.

Antes de ejecutar, completar estas decisiones y dependencias:

| Bloqueo | Estado actual | Quién/qué lo libera |
|---|---|---|
| Implementación integrada y entorno candidato | Pendiente: la implementación y su integración en entorno candidato no se han verificado para este plan | Confirmar fases F01–04, versión candidata reproducible y entorno de despliegue |
| Reglas concretas por papeleta (mayoría, abstención, nulidad, empate, repetición, cancelación) | Pendiente institucional | Secretaría/mesa valida y documenta reglas para cada papeleta; pruebas solo verifican reglas aprobadas |
| Acceso y roles del moderador; reapertura de lobby | Pendiente de decisión/implementación | Secretaría/mesa confirma operación; F01 registra decisión y F02–04 la implementan |
| Retención/eliminación de nombres, participación, votos y bitácoras | Pendiente institucional | Responsable institucional aprueba política; implementarla antes de validar borrado/retención |
| Límite aceptable de latencia y tasa de error de carga | Sin umbrales definidos | Acordar umbrales antes de la corrida k6 con responsables técnicos y operativos |
| Hosting, dominio/HTTPS, respaldos y restauración | Pendiente de entorno | Preparar entorno candidato representativo y confirmar el procedimiento de respaldo/restauración |
| Wi-Fi del recinto, proyector y dispositivos | Pendiente de confirmación y ensayo | Confirmar acceso y ventana de simulacro en el recinto |
| Disponibilidad de Secretaría/mesa y participantes de prueba | Pendiente de agenda | Designar responsables, operadores y grupo de ensayo |
| Playwright y k6 ejecutables en pipeline/entorno | Playwright instalado y suite aislada ejecutada: 6/6 pasan; CLI k6 no está instalado en el entorno actual | Instalar k6 en el host y confirmar versiones/comandos reproducibles antes de la carga; las pruebas UI no validan backend |

### Preparación candidata (#6)

El repositorio incluye ahora `docker-compose.candidate.yml`, imágenes API/web, Caddy para HTTPS, migración explícita, healthchecks, ejemplo de variables sin secretos y guiones para respaldo y comprobación de restauración aislada. Procedimiento: [docs/candidate-environment.md](docs/candidate-environment.md). Una comprobación local con PostgreSQL desechable pasó dump/restore de la migración y verificó ocho tablas; no prueba los scripts Compose ni PostgreSQL 17 del candidato. La fila de entorno continúa `Pendiente` hasta que el operador proporcione host/DNS autorizados y se adjunten la verificación desde fuera del host, el ensayo de scripts de respaldo/restauración con la imagen candidata y el SHA candidato. No se guardan secretos ni backups en Git.

Las filas marcadas pendientes son bloqueos para sus pruebas correspondientes; no representan fallos ni resultados. La revisión documental y preparación de casos sí puede avanzar con los contratos de Fase 01.

### Registro reproducible de validación local (2026-10-01)

Entorno: macOS, commit base ef79c17, Node.js 22.22.1, npm 11.13.0, Docker CLI 28.0.4 instalado pero daemon inaccesible (Cannot connect to the Docker daemon), PostgreSQL local 15.15. README_DEV.md requiere Node.js 22.22.3+ para desarrollo; por tanto esta corrida sirve como evidencia observada en 22.22.1, pero debe repetirse en la versión indicada antes de la aceptación. No se conectó a una base existente.

Se creó /private/tmp/asdmr-pg-test.QgPHjv/data desde cero; servidor limitado a 127.0.0.1:55432, base vacía asdmr_integration, autenticación trust local para el clúster efímero. Se aplicó 20261001000000_initial con prisma migrate deploy; luego se detuvo el servidor. La creación y el apagado necesitaron permiso fuera del sandbox para inicializar memoria compartida y detener el proceso. Comandos funcionales equivalentes para repetir el caso están en README_DEV.md.

Comandos y resultados de esta corrida:

~~~text
DATABASE_URL='postgresql://temporal2@127.0.0.1:55432/asdmr_integration?schema=public' npm run db:deploy --workspace @asdmr/api
  -> 1 migración aplicada: 20261001000000_initial
TEST_DATABASE_URL='postgresql://temporal2@127.0.0.1:55432/asdmr_integration?schema=public' npm run test --workspace @asdmr/api
  -> 11 passed, 0 failed, 0 skipped (incluye test de concurrencia, cierre y publicación)
npm run typecheck && npm run build
  -> código 0 en ambos; API y web compiladas
npm run test:e2e
  -> 6 passed (Chromium y mobile-chromium; API interceptada con datos sintéticos)
node --input-type=module --check < tests/load/voting.js
  -> sintaxis válida únicamente; no mide carga
k6 version
  -> command not found; no se pudo correr npm run test:load
~~~

La prueba de base respalda únicamente la ruta automatizada que cubre su test; no cambia a Pasa las filas de la matriz, que requieren los recorridos y evidencias por escenario descritos. No se acreditaron la integración desplegada, los recorridos HTTP/UI contra backend real, la carga, la privacidad operacional ni los ensayos del recinto. Las reglas institucionales y las decisiones de moderación, retención y nombres en proyección continúan pendientes.

### Herramientas automatizadas y comandos

Desde la raíz del repositorio:

```sh
npm install
npx playwright install chromium
npm run test:e2e
```

`@playwright/test` está declarado como dependencia de desarrollo raíz. Playwright descarga su navegador con `npx playwright install chromium`; el proyecto `mobile-chromium` usa emulación Pixel 7 en Chromium y `chromium` usa escritorio. Estos casos interceptan la API con respuestas sintéticas y no requieren iniciar ni conectar el backend. Para apuntar el navegador a un servidor web ya levantado, establecer `PLAYWRIGHT_BASE_URL` antes del comando; en ese modo Playwright no inicia Vite.

El ejecutable k6 es un requisito aparte de npm y debe instalarse/disponerse en el sistema (`k6 version`). El escenario usa ensamblado sintético explícito; no tiene URL de destino por defecto y aborta si faltan variables. Preparar primero Asamblea/lobby de prueba abierto; salvo `VOTE_JOIN_ONLY=true`, preparar también una ronda sintética abierta y una opción válida. Ejemplo de corrida de 50 sesiones:

```sh
export VOTE_P95_MS='<umbral P95 aprobado, en milisegundos>'
export VOTE_MAX_ERROR_RATE='<tasa máxima aprobada, valor entre 0 y 1>'
VOTE_BASE_URL='https://entorno-candidato.example' \
VOTE_ASSEMBLY_CODE='CODIGO_SINTETICO' \
VOTE_ROUND_ID='UUID_RONDA_ABIERTA' \
VOTE_OPTION_ID='UUID_OPCION' \
VOTE_SESSIONS=50 \
K6_SUMMARY_FILE=.k6-summary.json \
npm run test:load
```

Sustituir ambos valores de umbral por los acordados por el equipo antes de la corrida; el script los exige y falla al arrancar si faltan o no son numéricos. Se evalúan como `http_req_duration: p(95)<=VOTE_P95_MS` y `vote_request_errors: rate<=VOTE_MAX_ERROR_RATE`. Cambiar `VOTE_SESSIONS` a un entero entre 50 y 70 para aceptación. Para probar solo ingreso y lectura de snapshot, omitir los IDs de ronda/opción y definir `VOTE_JOIN_ONLY=true`. Opcionalmente, `VOTE_MAX_DURATION` cambia el límite temporal de seguridad (por defecto `3m`) y `VOTE_API_PREFIX` cambia el prefijo (por defecto `/api/v1`). Cada VU crea una sesión con nombre sintético; las sesiones persistidas deben eliminarse conforme al procedimiento del entorno de prueba. El equipo fija los límites; este artefacto no prescribe sus valores.

## 2. Matriz funcional, privacidad y tiempo real

En la columna **Resultado** se usará `Pendiente`, `Pasa`, `Falla` o `Bloqueado`. Mantener `Pendiente` hasta ejecutar el escenario y adjuntar evidencia. Para fallos, registrar severidad, pasos de reproducción, versión y vínculo a incidencia.

| ID | Área / prioridad | Escenario y pasos esenciales | Resultado esperado | Evidencia mínima | Dependencia / bloqueo | Resultado |
|---|---|---|---|---|---|---|
| F-01 | Estado / P0 | Abrir Asamblea con lobby cerrado e intentar ingresar por QR/código | El servidor rechaza el ingreso; las vistas muestran el estado correcto | Solicitud/respuesta y captura de estado sin datos personales | F01–04 integradas | Pendiente |
| F-02 | Ingreso / P0 | Ingresar nombre y apellido mientras el lobby está abierto; repetir nombre con otra sesión | Ambas sesiones pueden ingresar; nombres iguales no se bloquean automáticamente | Resultado de API/UI y lista sintética | Regla de ingreso aprobada; F02/F04 | Pendiente |
| F-03 | Ronda / P0 | Preparar ronda, abrirla e intentar modificar opciones/configuración | Configuración queda inmutable al abrir; cambios se rechazan | Respuesta del servidor y estado antes/después | Reglas de papeleta aprobadas; F02/F04 | Pendiente |
| F-04 | Unicidad / P0 | Emitir voto y reenviar la misma solicitud; repetir dos envíos concurrentes de la misma sesión | A lo sumo una participación; reintento no cambia voto ni produce segundo recibo | Respuestas, conteo de participaciones y registros sintéticos | Persistencia/transacción de F02 | Pendiente |
| F-05 | Inmutabilidad / P0 | Confirmar voto y tratar de editar/reemplazarlo desde cliente/API | Voto confirmado no se puede cambiar; UI no ofrece edición | Respuestas de API y recorrido Playwright | F02/F04 | Pendiente |
| F-06 | Cierre / P0 | Cerrar ronda y enviar un voto nuevo o tardío | Solicitud de voto se rechaza; no aparece participación adicional | Respuesta del servidor y estado agregado | F02 integrado | Pendiente |
| F-07 | Cierre/publicación / P0 | Cerrar ronda sin publicar; consultar API, socket, UI y vista de proyector; luego publicar | Cierre no publica resultados; resultados agregados aparecen únicamente tras acción autorizada y explícita | Capturas de cada estado y respuestas/eventos | Reglas de resultados aprobadas; F02–04 | Pendiente |
| F-08 | Idempotencia / P0 | Repetir solicitudes/eventos de abrir, cerrar y publicar | Reintentos no duplican efectos ni retroceden estados | Eventos/estados antes y después | F02–03 | Pendiente |
| P-01 | Privacidad / P0 | Inspeccionar esquema, migraciones e índices de voto/participación | Registro de voto no contiene participante, nombre, token ni clave de enlace; unicidad se aplica en participación separada | Extracto de esquema anonimizado y revisión firmada | F01–02; datos/modelo implementados | Pendiente |
| P-02 | Privacidad / P0 | Revisar rutas, respuestas, errores, vistas y herramientas administrativas antes/durante/después de votar | Ninguna interfaz/API permite consultar persona → opción; ningún conteo por opción previo a publicación | Inventario de rutas/capturas y respuestas sintéticas | F02/F04; reglas aprobadas | Pendiente |
| P-03 | Privacidad / P0 | Revisar payloads de socket, logs, auditoría y errores durante ingreso, voto, rechazo y reconexión | No se emiten/guardan juntos identidad y selección; no se registran cuerpos de voto, secretos ni tokens correlacionables | Muestras redactadas de logs y payloads | F02–03; logging disponible | Pendiente |
| P-04 | Privacidad / P0 | Probar canales con delegado, proyector, moderador autorizado y cliente no autorizado; intentar suscripción/lectura cruzada | Cada rol recibe solo datos permitidos; cliente ajeno no accede a sala/canal privado ni enumera Asamblea | Matriz de rol→operación y trazas de autorización | Mecanismo de autorización aprobado; F02–04 | Pendiente |
| P-05 | Privacidad / P0 | Comparar datos visibles en lobby, ronda abierta y resultados publicados | Nombres solo en vistas autorizadas conforme a decisión; durante ronda no hay lista pública de ausentes ni selecciones; resultados solo tras publicación | Capturas por rol/estado | Decisión sobre lista del proyector pendiente; F04 | Pendiente |
| R-01 | Tiempo real / P0 | Conectar varios clientes y generar ingreso, corrección/retiro aprobado, cierre y cambios de ronda | Clientes autorizados reflejan eventos/estado correcto; cada audiencia recibe solo los campos acordados | Trazas de eventos y capturas de clientes | Contrato F01; F02–03 integradas | Pendiente |
| R-02 | Tiempo real / P0 | Desconectar un delegado antes y después de confirmar; reconectar | Recupera snapshot autoritativo; la confirmación solo aparece si el servidor la aceptó; reconexión no crea voto extra | Grabación de pasos, snapshot y conteo | Snapshot/API F02–03; UI F04 | Pendiente |
| R-03 | Tiempo real / P0 | Desconectar y reconectar moderador/proyector tras cambio de estado | Cada pantalla recupera estado de base de datos y no depende de eventos perdidos | Capturas y snapshot comparado con servidor | F02–04 | Pendiente |
| R-04 | Tiempo real / P0 | Enviar eventos repetidos o retrasados y reconectar tras cierre | No se duplica participación, no se reabre ronda y no se altera estado cerrado | Trazas con marcas de tiempo | F02–03 | Pendiente |
| R-05 | Tiempo real / P0 | Conectar cliente no autorizado e intentar unirse a canal de moderador/otra sesión | Acceso denegado sin exponer información de Asamblea ni participantes | Respuestas de conexión/suscripción y logs redactados | Autorización F02–03 | Pendiente |

## 3. Matriz Playwright y presentación

Ejecutar en viewport móvil representativo y escritorio; incluir navegador/dispositivo de prueba documentado. Cubrir estados cargando, error, sin conexión y reconectando. No se fija aquí una combinación de navegadores ni tamaños porque el despliegue y el parque de dispositivos todavía no están confirmados; acordarlos al preparar el entorno del ensayo.

| ID | Rol / prioridad | Recorrido y variación | Resultado esperado | Evidencia mínima | Dependencia / bloqueo | Resultado |
|---|---|---|---|---|---|---|
| U-01 | Delegado / P0 | QR/URL → nombre y apellido → espera → recibir papeleta → seleccionar → revisar → confirmar | El flujo termina con recibo solo ante confirmación del servidor; no requiere cuenta ni instalación | Traza Playwright, capturas y reporte | F02–04 integradas | Pendiente |
| U-02 | Delegado / P0 | Doble clic/doble toque y retraso de respuesta al confirmar | Una sola emisión; estado de espera visible y resultado final no ambiguo | Traza y red de navegador | F02/F04 | Pendiente |
| U-03 | Delegado / P0 | Rechazo por cierre, refresh antes/después del voto y desconexión durante solicitud | Se informa el resultado real del servidor; nunca se simula éxito; estado se recupera al recargar | Traza y capturas | F02–04 | Pendiente |
| U-04 | Moderador / P0 | Ingresar, revisar lista, cerrar lobby, preparar y abrir ronda, monitorear participación, cerrar y publicar | Controles autorizados y acciones separadas; sin resultados parciales; doble clic no duplica acción | Traza por etapa y capturas | Acceso de moderador y reglas aprobados; F02–04 | Pendiente |
| U-05 | Proyector / P0 | Mostrar lobby, ronda abierta, ronda cerrada sin publicar y resultados publicados | Estado adecuado y legible a distancia; sin lista/selección no autorizada ni resultados prematuros | Captura por estado y validación presencial | Decisión de lista de lobby; F04 y proyector | Pendiente |
| U-06 | Todos / P0 | Probar carga, error, desconexión, reconexión y estado desactualizado | Cada rol distingue operación pendiente/fallida de confirmación exitosa | Capturas y trazas | F02–04 | Pendiente |
| U-07 | Todos / P1 | Navegación por teclado, foco visible, etiquetas, contraste, tamaño táctil, mensajes sin depender del color | Controles operables y comprensibles según criterios acordados | Lista de observaciones y capturas | F04; criterios de accesibilidad acordados | Pendiente |
| U-08 | Participantes / P1 | Prueba guiada con distintos niveles de familiaridad tecnológica, sin instrucciones adicionales | Pueden ingresar y votar; documentar dudas/confusiones para corregir | Guion, observaciones y problemas | Participantes reclutados; entorno funcional | Pendiente |

## 4. Matriz k6 y ensayo presencial

### Carga con k6 — P0

Preparar datos completamente sintéticos. Ejecutar contra el entorno más parecido al despliegue real, con configuración y límites acordados por anticipado. Separar escenario de conexiones de los escenarios de ráfaga para poder identificar el origen de errores.

| ID | Perfil | Ejecución | Criterio de aceptación | Evidencia requerida | Bloqueos | Resultado |
|---|---|---|---|---|---|---|
| K-01 | Concurrencia normal | 50–70 sesiones conectadas; recorrer lobby, snapshot/estado y cambios de ronda | Recorrido completado sin errores bloqueantes; latencia y tasa de error cumplen umbrales definidos antes de correr | Script/commit, configuración, resumen k6, umbrales, entorno y errores | Entorno y 50–70 VUs; umbrales acordados | Pendiente |
| K-02 | Ráfaga de ingreso | Simular ingreso simultáneo/ráfaga hacia lobby durante apertura | Ingresos aceptados/rechazados de forma correcta según estado; sin pérdida ni duplicados; umbrales acordados | Métricas k6, conteo servidor y errores | Endpoint de ingreso y entorno representativo | Pendiente |
| K-03 | Ráfaga de voto | Con ronda abierta, ráfaga de envíos válidos y reintentos por sesión; incluir solicitudes después de cierre | Un voto máximo por sesión/ronda, rechazos tras cierre y estabilidad; no hay resultados parciales | Métricas, conteos sintéticos y revisión de eventos/logs | F02–03 y reglas aprobadas; umbrales acordados | Pendiente |

### Simulacro presencial — P0

| ID | Escenario | Procedimiento | Criterio de aceptación | Evidencia requerida | Bloqueos | Resultado |
|---|---|---|---|---|---|---|
| S-01 | Flujo completo | Con moderador, Secretaría y grupo de prueba: proyectar QR, ingresar, comparar asistencia según procedimiento institucional, preparar ronda, votar, cerrar y publicar | Delegados completan el recorrido con instrucciones breves; moderador termina sin asistencia técnica continua; proyector correcto por estado | Informe con participantes/roles, dispositivos, fotos/capturas sin datos reales y problemas | F01–04 integradas; Secretaría/mesa; salón/QR/proyector | Pendiente |
| S-02 | Legibilidad y variedad de teléfonos | Recorrer QR, ingreso y papeleta con teléfonos disponibles de distintos tamaños/gamas | Texto/controles legibles y operables; incidencias anotadas | Inventario de equipos y registro de observaciones | Dispositivos de prueba; entorno funcional | Pendiente |
| S-03 | Wi-Fi interrumpido | Interrumpir conexión según procedimiento seguro durante espera y durante papeleta; restaurar y resincronizar | Aplicación muestra desconexión; no simula éxito; recupera estado autoritativo; la mesa sigue el procedimiento aprobado | Cronología, capturas y decisión operativa | Red real o equivalente; contingencia aprobada | Pendiente |
| S-04 | Recarga y pérdida de dispositivo/sesión | Recargar navegador; simular pérdida de dispositivo y seguir el procedimiento de mesa aprobado | No duplica participación ni reasigna una sesión de forma improvisada; decisión de continuidad queda con mesa | Pasos, resultados y responsable de decisión | Recuperación F02–04 y procedimiento institucional aprobado | Pendiente |
| S-05 | Reinicio controlado | Reiniciar cliente/servidor solo en entorno seguro y según procedimiento; verificar retorno | Persistencia y recuperación concuerdan con el estado guardado; responsabilidades y tiempos documentados | Cronología, snapshot tras reinicio y notas operativas | Entorno seguro y procedimiento de reinicio aprobado | Pendiente |
| S-06 | Alternativa manual | Simular que la mesa decide continuar mediante papeleta física conforme a su procedimiento | Responsables conocen pasos, materiales y forma de preservar el proceso oficial | Acta breve del ejercicio y lista de materiales/responsables | Procedimiento de Secretaría/mesa; no lo define el software | Pendiente |

## 5. Revisión de seguridad y preparación de salida

| ID | Revisión / prioridad | Comprobación | Evidencia | Dependencia / bloqueo | Resultado |
|---|---|---|---|---|---|
| D-01 | Despliegue / P0 | Confirmar HTTPS en entorno candidato, secretos fuera del cliente/repositorio, autorización en operaciones administrativas, CORS restringido, límites básicos de abuso y errores sin fuga | Configuración redactada, lista de verificación y resultados de solicitudes negativas | Entorno desplegado y mecanismo de acceso aprobado | Pendiente |
| D-02 | Datos / P0 | Confirmar datos de prueba no sensibles y política aplicada para retención/eliminación; no ejecutar borrado automatizado sin aprobación/política | Inventario sintético, decisión institucional y evidencia del procedimiento | Política de retención pendiente | Pendiente |
| D-03 | Respaldo / P0 | Crear respaldo y verificar restauración en entorno seguro; verificar estado de ronda/voto sin correlación identidad-opción | Registro de respaldo/restauración y comprobaciones anonimizadas | Infraestructura y procedimiento listos | Pendiente |
| O-01 | Salida / P0 | Confirmar URL/QR, operador autorizado, dispositivos de respaldo, Wi-Fi, proyector, soporte, canal de decisión y alternativa manual | Checklist con responsable y estado por elemento | Secretaría/mesa e infraestructura confirmadas | Pendiente |
| O-02 | Salida / P0 | Revisar reglas cargadas y límites: el software no acredita delegados, determina quórum, desempata ni proclama | Aprobación de Secretaría/mesa y comunicación operativa | Validación institucional | Pendiente |

## 6. Registro de corrida e incidencias

Copiar esta ficha por cada ejecución importante:

```text
ID de corrida:
Fecha/hora y responsable:
Versión/commit del sistema:
Entorno y configuración relevante:
Red / ubicación / dispositivos:
Datos de prueba (confirmar que son sintéticos):
Escenarios incluidos y excluidos:
Umbrales previamente acordados (si aplica):
Resultado: Pendiente / Pasa / Falla / Bloqueado
Evidencia (rutas/enlaces):
Incidencias abiertas y prioridad:
Observaciones / limitaciones:
```

### Definición de listo para uso oficial

- Todos los escenarios P0 aplicables se ejecutaron y pasan, con evidencia vinculada; los bloqueados no se cuentan como aprobados.
- No quedan incidencias P0 abiertas.
- La corrida de carga documenta entorno y umbrales acordados antes de la ejecución.
- El simulacro presencial cubre red, QR, proyector, teléfonos, reconexión y contingencia manual.
- Secretaría/mesa valida las reglas cargadas, responsabilidades y límites conocidos del sistema.
- La revisión de privacidad confirma ausencia de una vía operativa conocida que relacione identidad y selección; esto no equivale a anonimato criptográfico frente a acceso privilegiado al servidor.

Este plan no certifica el sistema ni sustituye revisión institucional, pruebas de seguridad especializadas o validación en el recinto. Ningún escenario se considera aprobado por el mero hecho de estar especificado.
