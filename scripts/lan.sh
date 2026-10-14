#!/usr/bin/env bash
# Runs the assembly on this laptop over the organization's own Starlink Wi-Fi. See docs/lan-assembly.md.
set -euo pipefail

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env.lan"
MODERATOR_URL="http://localhost:8081/moderator"

compose() {
  docker compose --env-file "$ENV_FILE" -f "$ROOT_DIR/docker-compose.lan.yml" "$@"
}

fail() {
  printf '\nERROR: %s\n' "$1" >&2
  exit 1
}

require_env() {
  [[ -f "$ENV_FILE" ]] || fail "No existe .env.lan. Ejecuta primero: scripts/lan.sh preparar"
}

env_value() {
  sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1
}

set_env_value() {
  local tmp
  tmp="$(mktemp)"
  grep -v "^$1=" "$ENV_FILE" > "$tmp" || true
  printf '%s=%s\n' "$1" "$2" >> "$tmp"
  cat "$tmp" > "$ENV_FILE"
  rm -f "$tmp"
}

# The address phones use: the one on the interface of the default route (the Starlink router).
detect_address() {
  if [[ -n "${LAN_ADDRESS:-}" ]]; then
    printf '%s\n' "$LAN_ADDRESS"
    return
  fi
  local address=''
  case "$(uname -s)" in
    Darwin)
      local iface
      iface="$(route -n get default 2>/dev/null | awk '/interface:/ { print $2 }')"
      [[ -n "$iface" ]] && address="$(ipconfig getifaddr "$iface" 2>/dev/null || true)"
      [[ -z "$address" ]] && address="$(ipconfig getifaddr en0 2>/dev/null || true)"
      ;;
    Linux)
      # Under WSL the Linux address is internal to Windows; phones need the Windows Wi-Fi address.
      if grep -qi microsoft /proc/version 2>/dev/null; then
        printf '\n'
        return
      fi
      address="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{ for (i = 1; i <= NF; i++) if ($i == "src") { print $(i + 1); exit } }')"
      [[ -z "$address" ]] && address="$(hostname -I 2>/dev/null | awk '{ print $1 }')"
      ;;
  esac
  printf '%s\n' "$address"
}

wait_for_health() {
  local url="$1"
  for _ in $(seq 1 60); do
    if curl -fsS --max-time 2 "$url" > /dev/null 2>&1; then return 0; fi
    sleep 2
  done
  return 1
}

cmd_preparar() {
  command -v docker > /dev/null || fail "Docker no está instalado."
  docker info > /dev/null 2>&1 || fail "Docker no está en marcha. Abre Docker Desktop y vuelve a intentarlo."
  if [[ ! -f "$ENV_FILE" ]]; then
    command -v openssl > /dev/null || fail "Falta openssl para generar las claves."
    umask 077
    cat > "$ENV_FILE" <<EOF
POSTGRES_DB=asdmr_lan
POSTGRES_USER=asdmr_lan
POSTGRES_PASSWORD=$(openssl rand -hex 32)
MODERATOR_ACCESS_TOKEN=$(openssl rand -hex 32)
LAN_ADDRESS=
ALLOW_START_WITH_PENDING_VOTE_CLEANUP=false
EOF
    chmod 600 "$ENV_FILE"
    echo "Se creó .env.lan con claves nuevas."
  fi
  # A placeholder address lets Compose read the file before the first start.
  LAN_ADDRESS="${LAN_ADDRESS:-127.0.0.1}" compose --profile tools build
  LAN_ADDRESS="${LAN_ADDRESS:-127.0.0.1}" compose --profile tools pull --ignore-buildable postgres caddy
  echo
  echo "Listo. Las imágenes quedaron en esta laptop; el día de la Asamblea no hace falta Internet."
}

cmd_iniciar() {
  require_env
  docker info > /dev/null 2>&1 || fail "Docker no está en marcha. Abre Docker Desktop y vuelve a intentarlo."
  local address previous
  address="$(detect_address)"
  [[ -n "$address" ]] || fail "No se encontró la dirección de esta laptop en la red. Conéctala al Wi-Fi de Starlink, o indícala a mano: LAN_ADDRESS=192.168.1.50 scripts/lan.sh iniciar (en Windows, la «Dirección IPv4» del Wi-Fi que muestra ipconfig)"
  previous="$(env_value LAN_ADDRESS)"
  set_env_value LAN_ADDRESS "$address"
  export LAN_ADDRESS="$address"

  compose up -d --wait postgres
  compose --profile tools run --rm migrate
  compose up -d
  echo "Esperando a que la aplicación responda…"
  wait_for_health "http://localhost:8081/api/v1/health" || fail "La aplicación no respondió. Revisa: scripts/lan.sh registros"
  if ! curl -fsS --max-time 3 "http://$address/api/v1/health" > /dev/null 2>&1; then
    echo
    echo "AVISO: la aplicación no responde en http://$address desde esta laptop."
    echo "Revisa el firewall de la laptop (debe permitir conexiones entrantes a Docker) y que la dirección sea la del Wi-Fi de Starlink."
  fi

  echo
  echo "======================================================================"
  echo " Teléfonos (QR del proyector):  http://$address"
  echo " Panel de la mesa (solo aquí):  $MODERATOR_URL"
  echo " Clave de la mesa:              scripts/lan.sh credencial"
  echo "======================================================================"
  if [[ -n "$previous" && "$previous" != "127.0.0.1" && "$previous" != "$address" ]]; then
    echo
    echo "ATENCIÓN: la dirección cambió ($previous → $address)."
    echo "Los teléfonos que ya se unieron deben volver a escanear el QR del proyector."
  fi
  echo
  echo "Recuerda: la laptop conectada a la corriente y sin suspensión durante toda la Asamblea."
}

cmd_estado() {
  require_env
  compose ps
  echo
  echo "Dirección para teléfonos: http://$(env_value LAN_ADDRESS)"
  echo "Dirección actual de la laptop: $(detect_address)"
}

cmd_credencial() {
  require_env
  env_value MODERATOR_ACCESS_TOKEN
}

cmd_registros() {
  require_env
  compose logs --tail=200 api caddy
}

cmd_detener() {
  require_env
  compose stop
  echo "Servicios detenidos. Los datos se conservan; scripts/lan.sh iniciar continúa la Asamblea."
}

cmd_borrar_todo() {
  require_env
  echo "Esto borra la base de datos completa de esta laptop: nombres, votos, resultados y registros."
  echo "Hazlo solo después de entregar el acta a Secretaría. No se puede deshacer."
  printf 'Escribe BORRAR para continuar: '
  local answer
  read -r answer
  [[ "$answer" == "BORRAR" ]] || fail "Cancelado. No se borró nada."
  compose --profile tools down --volumes --remove-orphans
  rm -f "$ENV_FILE"
  echo "Se borraron la base de datos y las claves. La próxima Asamblea empieza con scripts/lan.sh preparar."
}

case "${1:-}" in
  preparar) cmd_preparar ;;
  iniciar) cmd_iniciar ;;
  estado) cmd_estado ;;
  credencial) cmd_credencial ;;
  registros) cmd_registros ;;
  detener) cmd_detener ;;
  borrar-todo) cmd_borrar_todo ;;
  *)
    cat <<EOF
Uso: scripts/lan.sh <comando>

  preparar     Antes del día: crea las claves y construye la aplicación (requiere Internet).
  iniciar      El día de la Asamblea: arranca todo y muestra las direcciones.
  estado       Muestra si los servicios están en marcha y la dirección actual.
  credencial   Muestra la clave del panel de la mesa.
  registros    Muestra los últimos registros de la aplicación para diagnosticar.
  detener      Detiene los servicios sin borrar datos.
  borrar-todo  Al terminar: borra la base de datos completa y las claves.
EOF
    exit 2
    ;;
esac
