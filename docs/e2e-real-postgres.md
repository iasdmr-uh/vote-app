# E2E real con PostgreSQL

La suite `test:e2e:real-stack` recorre la aplicación web conectada a la API Nest y a una instancia PostgreSQL real. La suite `test:e2e` existente sigue usando mocks y conserva su ejecución rápida.

## Requisitos

- Node.js y npm compatibles con el repositorio, con dependencias instaladas (`npm ci`).
- Docker disponible y en ejecución, o las herramientas locales `initdb`, `pg_ctl` y `createdb`. La primera ejecución con Docker descarga `postgres:17-alpine` si la imagen no está en caché.
- Playwright Chromium instalado (`npx playwright install chromium`) cuando el navegador aún no está instalado.

## Ejecutar

Desde la raíz del repositorio:

```sh
npm run test:e2e:real-stack
# solo algunos escenarios: los argumentos extra pasan a Playwright
npm run test:e2e:real-stack -- committee inhabilitar
# si 3300 o 4174 están ocupados
E2E_API_PORT=3310 E2E_WEB_PORT=4184 npm run test:e2e:real-stack
```

El comando intenta arrancar un contenedor PostgreSQL sin volumen persistente y con puerto local aleatorio. Si Docker no está disponible, crea un clúster PostgreSQL local aislado en una carpeta temporal y selecciona un puerto libre. En ambos casos genera el cliente Prisma, aplica las migraciones e inicia la API en `127.0.0.1:3300` y la web en `127.0.0.1:4174` (o en `E2E_API_PORT` / `E2E_WEB_PORT`; si un puerto está ocupado, el comando falla antes de empezar e indica la variable). El clúster local corre con la configuración regional `C`, porque PostgreSQL no arranca con un `LC_CTYPE` inválido. El proceso elimina el contenedor o detiene y borra el clúster al terminar, incluso si falla la prueba.

Cada escenario crea su propia Asamblea (antes finaliza la que haya quedado activa, porque la API admite una sola) y actúa por la interfaz real: la mesa, el proyector y varios teléfonos, cada uno en su propio contexto de navegador. La API solo se usa para leer lo guardado y para probar lo que el servidor rechaza. Las esperas son sobre el estado de la interfaz o los avisos en tiempo real, nunca pausas fijas. Los pasos comunes están en `tests/e2e/real-stack/helpers.ts`.

| Archivo | Qué prueba |
|---|---|
| `full-voting-flow.spec.ts` | Ingreso, voto único, rechazo del segundo envío, resultados ocultos hasta publicar. |
| `office-runoff.spec.ts` | A · Cargo sin mayoría: desempate automático entre los 2 primeros y empates, «Mayoría: X», «N no votaron», la 2.ª votación elige (#37, #38, #41). |
| `committee.spec.ts` | B · Comisión de 3: 1.º electo, desempate de 2.º, 3.º y 4.º por 2 puestos, selección exacta en el teléfono y en el servidor, desempates encadenados (#37, #38, #39). |
| `new-candidate.spec.ts` | C · Candidato nuevo: ausente en la 2.ª votación, presente en la 3.ª, y resulta electo (#40). |
| `inhabilitar.spec.ts` | D · Inhabilitar y Habilitar durante una votación, voto rechazado con 403, sigue en la base; inhabilitar a alguien que aún no votó. |
| `decisions.spec.ts` | E · Decisiones 3/4 aprobada y no aprobada, 50/50 con mayoría simple, opciones que se repiten (#42). |
| `two-thirds.spec.ts` | Decisión 2/3 con 7 en la sala: 5 votos aprueban, 4 no aprueban aunque sean mayoría, y el teléfono no muestra la regla (#87). |
| `annul-runoff.spec.ts` | F · Anular el primer desempate y repetirlo: sigue siendo la 2.ª votación y no admite candidato nuevo. |
| `remove-candidate.spec.ts` | G · «Quitar» un candidato nuevo en la 3.ª votación: sale del borrador y ningún teléfono lo recibe (#40). |
| `inhabilitar-reconnect.spec.ts` | H · La mesa retira a alguien de la sala, lo regresa y lo reconecta con «Reconectar dispositivo». |
| `assembly-simulation.spec.ts` | Asamblea completa con nueve teléfonos; capturas y notas de tiempo en `SIMULATION_OUTPUT_DIR`. |

## Evidencia

Cada corrida escribe `metadata.json`, `results.json` y artefactos de Playwright en una carpeta ignorada por Git bajo `test-results/`. El nombre de carpeta incluye el SHA completo de `HEAD`, indica si el árbol de trabajo tenía cambios y añade una marca de tiempo; `metadata.json` registra también la rama. Para vincular evidencia a un cambio terminado, ejecuta la suite después de crear el commit correspondiente.

Esta suite se configura en `playwright.real-stack.config.ts` y vive en `tests/e2e/real-stack/`; la configuración por defecto no incluye esa carpeta y sigue ejecutando únicamente los E2E simulados.
