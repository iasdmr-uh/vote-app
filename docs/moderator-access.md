# Acceso de la mesa

La moderación se abre deliberadamente en `/moderator`. Esta dirección no aparece en la navegación del delegado ni en la pantalla pública; puede guardarse como marcador en el dispositivo autorizado de la mesa.

Al entrar, la aplicación solicita la credencial operativa y la valida con `GET /api/v1/moderator/session`. El servidor protege esa ruta y todas las operaciones administrativas con `ModeratorGuard`. El panel solo aparece después de que el servidor acepta la credencial. Una credencial inválida o vencida vuelve al formulario de acceso.

No incluyas la credencial en la URL, en un QR público, en instrucciones proyectadas ni en mensajes compartidos. Configúrala en el entorno de la API como `MODERATOR_ACCESS_TOKEN`; entrégala únicamente a las personas autorizadas por la mesa y rótala si se expone. La credencial compartida no identifica a cada operador individual.

Para volver al flujo de delegado, usa la marca ASDMR del encabezado o abre `/`. Para abrir la pantalla pública del proyector, usa `/projector?code=<código-de-asamblea>`.

## Modo LAN

En la instalación de red local (`docker-compose.lan.yml`, ver `docs/lan-assembly.md`), la API se inicia con `MODERATOR_LOCAL_ONLY=true`. Caddy escucha en dos puertos: el `80`, abierto al Wi-Fi para los teléfonos, y el `8081`, publicado solo en `127.0.0.1` de la laptop. Cada puerto sobrescribe el encabezado `X-Asdmr-Channel` (`public` o `local`), y la API solo acepta la moderación (HTTP y Socket.IO) cuando vale `local`. La API no publica puertos, así que el encabezado solo puede venir de Caddy. Desde el Wi-Fi, `/moderator` redirige a `/` y `/api/v1/moderator/*` responde 404, aunque se tenga la credencial.
