# E2E real con PostgreSQL

La suite `test:e2e:integration` recorre la aplicación web conectada a la API Nest y a una instancia PostgreSQL real. La suite `test:e2e` existente sigue usando mocks y conserva su ejecución rápida.

## Requisitos

- Node.js y npm compatibles con el repositorio, con dependencias instaladas (`npm ci`).
- Docker disponible y en ejecución, o las herramientas locales `initdb`, `pg_ctl` y `createdb`. La primera ejecución con Docker descarga `postgres:17-alpine` si la imagen no está en caché.
- Playwright Chromium instalado (`npx playwright install chromium`) cuando el navegador aún no está instalado.

## Ejecutar

Desde la raíz del repositorio:

```sh
npm run test:e2e:integration
```

El comando intenta arrancar un contenedor PostgreSQL sin volumen persistente y con puerto local aleatorio. Si Docker no está disponible, crea un clúster PostgreSQL local aislado en una carpeta temporal y selecciona un puerto libre. En ambos casos genera el cliente Prisma, aplica las migraciones e inicia la API en `127.0.0.1:3300` y la web en `127.0.0.1:4174`. El proceso elimina el contenedor o detiene y borra el clúster al terminar, incluso si falla la prueba.

La prueba crea una asamblea y un delegado con nombres sintéticos, prepara y abre una papeleta desde Moderación, registra el voto desde la vista de Delegado, comprueba que un segundo envío se rechaza y que la participación continúa siendo una, y verifica que la vista pública solo muestra los resultados después de publicarlos.

## Evidencia

Cada corrida escribe `metadata.json`, `results.json` y artefactos de Playwright en una carpeta ignorada por Git bajo `test-results/`. El nombre de carpeta incluye el SHA completo de `HEAD`, indica si el árbol de trabajo tenía cambios y añade una marca de tiempo; `metadata.json` registra también la rama. Para vincular evidencia a un cambio terminado, ejecuta la suite después de crear el commit correspondiente.

Esta suite se configura en `playwright.integration.config.ts` y vive en `tests/e2e/integration/`; la configuración por defecto no incluye esa carpeta y sigue ejecutando únicamente los E2E simulados.
