# Entorno candidato de Asamblea

El perfil `docker-compose.candidate.yml` prepara una instalación candidata aislada: Caddy termina HTTPS, el contenedor web sirve el build estático, la API no publica puertos al host y PostgreSQL solo queda accesible dentro de la red de Compose. Las imágenes están especificadas por versiones patch y base Alpine para que una reconstrucción no adopte silenciosamente un cambio de versión mayor/menor. Actualiza estas versiones como un cambio revisado y vuelve a ejecutar la verificación del candidato. Esto es un paquete reproducible para desplegar en un host que opere la organización; no crea por sí mismo DNS, una máquina ni una aprobación institucional.

## Requisitos y configuración

- Un host Linux de prueba con Docker Engine y Docker Compose v2.
- Un nombre DNS de prueba que apunte al host. Los puertos TCP 80 y 443 deben ser accesibles desde Internet para que Caddy solicite y renueve el certificado. UDP 443 se publica para HTTP/3.
- Un canal aprobado para entregar los secretos al operador del host.

Desde la raíz del repositorio, prepara el archivo de entorno fuera del control de versiones:

```sh
cp .env.candidate.example .env.candidate
chmod 600 .env.candidate
openssl rand -hex 32
```

Usa una salida aleatoria distinta para `POSTGRES_PASSWORD` y `MODERATOR_ACCESS_TOKEN`; reemplaza también `APP_DOMAIN` por el DNS candidato. El formato hexadecimal evita caracteres que necesitarían escape en la URL de conexión PostgreSQL. No copies secretos del desarrollo ni uses nombres o votos personales reales.

## Despliegue inicial

El perfil no publica PostgreSQL ni la API al host. HTTPS/Caddy es la única entrada pública y la API permite únicamente el origen `https://APP_DOMAIN`.

```sh
scripts/candidate-compose.sh config --quiet
scripts/candidate-compose.sh build
scripts/candidate-compose.sh --profile tools run --rm migrate
scripts/candidate-compose.sh up -d
scripts/candidate-compose.sh ps
APP_DOMAIN="$(sed -n 's/^APP_DOMAIN=//p' .env.candidate)"
curl --fail "https://${APP_DOMAIN}/api/v1/health"
```

Ejecuta las migraciones una vez antes de actualizar el servicio API; no se aplican automáticamente en cada arranque. La API y web tienen healthchecks; Compose espera a PostgreSQL sano antes de migrar o iniciar la API y a ambos servicios antes de iniciar Caddy.

Caddy gestiona certificados públicamente confiables para el nombre DNS. Si el host está detrás de NAT, permite el reenvío de 80/443; si DNS o el firewall aún no están listos, el certificado no estará disponible y la prueba móvil HTTPS no debe marcarse como aprobada.

## Reinicio y actualización

Para reiniciar los servicios del candidato:

```sh
scripts/candidate-compose.sh restart
scripts/candidate-compose.sh ps
curl --fail https://APP_DOMAIN/api/v1/health
```

Para una versión nueva, identifica primero el SHA que se pretende desplegar, respalda la base, construye las imágenes desde ese checkout, ejecuta `migrate` y después aplica `up -d`. Revisa los logs si algún healthcheck no pasa:

```sh
scripts/candidate-compose.sh logs --tail=200 api caddy
```

No ejecutes `prisma migrate dev` en el candidato. Si una migración no es compatible con la versión anterior, no reviertas código a ciegas ni sobrescribas la base: conserva el backup y recupera una copia aislada para diagnosticarla. Los volúmenes `candidate_postgres_data` y `candidate_caddy_data` persisten al recrear contenedores; `down -v` los borra y no forma parte del procedimiento de reinicio.

## Respaldo y comprobación de restauración

Guarda backups fuera del repositorio y en almacenamiento restringido/cifrado. `BACKUP_DIR` permite seleccionar el destino:

```sh
BACKUP_DIR=/ruta/segura/backups scripts/candidate-backup.sh
scripts/candidate-verify-restore.sh /ruta/segura/backups/asdmr-candidate-<fecha>.dump
```

El respaldo usa formato custom de `pg_dump`, permisos de archivo `0600` y valida su catálogo con `pg_restore --list`. El verificador crea una base temporal independiente dentro del servicio PostgreSQL, restaura allí, comprueba las tablas principales y elimina esa base al salir. La restauración de verificación no reemplaza ni modifica la base candidata activa. Conserva el archivo y el log de la corrida según la política aprobada; no incluyas el dump en Git ni en capturas compartidas.

## Rollback y límites

Si HTTPS o un healthcheck falla durante una sesión, avisa a la mesa y sigue su procedimiento manual aprobado para pausar o continuar el proceso. La aplicación no determina elegibilidad, quórum, conteo ni proclamación; esta guía no crea reglas de papeleta ni sustituye la decisión de Secretaría. Antes de usar el candidato en un simulacro, registra responsables, contactos y el procedimiento físico aprobado en el checklist operativo.

El rollback de contenedores solo es seguro cuando la versión anterior soporta el esquema ya migrado. Conserva y etiqueta los artefactos de la versión anterior, revisa la compatibilidad de cada migración y vuelve a ejecutar healthchecks después del rollback. Si hace falta recuperar datos, prueba el dump en una base aislada antes de acordar con el responsable del entorno cualquier sustitución o cambio de tráfico. No hay rollback automático de datos.

## Evidencia de verificación local

El 2026-10-02 se verificó el stack con Docker Engine 28.0.4, Docker Compose 2.34.0-desktop.1 e imagen `postgres:17.11-alpine3.24`, la misma versión fijada en `docker-compose.candidate.yml`. Se usó un dominio sintético (`candidate.test`), secretos aleatorios temporales, una base desechable y ningún dato de participantes.

La corrida construyó las imágenes API y web, arrancó PostgreSQL, aplicó `20261001000000_initial`, inició API y frontend, y ambos quedaron healthy. La API respondió `200` en `/api/v1/health`; el frontend respondió correctamente en su healthcheck HTTP interno. Luego `scripts/candidate-backup.sh` produjo un dump custom y validó su catálogo con `pg_restore --list`; `scripts/candidate-verify-restore.sh` lo restauró en una base desechable nueva y confirmó las cuatro tablas principales (`organizations`, `assemblies`, `rounds`, `anonymous_votes`). Al terminar, se eliminaron contenedores, red, volúmenes y archivos de prueba.

Esta corrida sí ejecutó los scripts `candidate-*` con la imagen PostgreSQL candidata. No verificó HTTPS público ni CORS desde un móvil fuera del host: el dominio era sintético y Caddy no se inició. La corrida local previa con PostgreSQL 15.15 y verificación de ocho tablas fue una prueba separada anterior; ya no representa el estado de verificación de Docker de esta branch.

La aceptación de issue #6 sigue necesitando desplegar en un host/DNS autorizados, confirmar HTTPS y CORS desde un móvil fuera del host y adjuntar evidencia identificada por SHA. La verificación local de los scripts de respaldo/restauración con la imagen candidata ya está registrada arriba; no sustituye esas comprobaciones externas. Esa infraestructura y sus credenciales no están en el repositorio.
