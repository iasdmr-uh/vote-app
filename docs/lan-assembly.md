# Guía del técnico: Asamblea en red local con Starlink

Esta guía es para la persona técnica que modera la Asamblea. Una laptop hace de servidor. La red es el Wi-Fi del router Starlink propio de la organización. Los teléfonos de los delegados se conectan a ese Wi-Fi y abren la aplicación con la dirección de la laptop.

La aplicación no necesita Internet durante la Asamblea. Si Starlink pierde la señal del satélite, el Wi-Fi local sigue funcionando y la votación continúa.

## Cómo queda armado

| Quién | Dónde | Dirección |
| --- | --- | --- |
| Teléfonos de los delegados | Wi-Fi de Starlink | `http://<dirección-de-la-laptop>` (por QR) |
| Panel de la mesa | Solo en la laptop servidor | `http://localhost:8081/moderator` |
| Proyector | Ventana abierta desde el panel, en la laptop | la abre el botón «Abrir proyector en otra ventana» |

El panel de la mesa **solo funciona en la laptop servidor**. Desde el Wi-Fi, la dirección `/moderator` devuelve a la página de ingreso y la API de moderación no responde, aunque alguien tenga la clave. Por eso el proyector debe conectarse a la laptop (HDMI o similar). La mesa trabaja en esa misma laptop.

## Antes del día (con Internet)

Hazlo al menos un día antes, con la laptop que se usará.

1. Instala Docker Desktop (macOS o Windows) o Docker Engine con Compose (Linux) y ábrelo. En Windows, ejecuta los comandos dentro de WSL e indica la dirección a mano al iniciar: `LAN_ADDRESS=<Dirección IPv4 del Wi-Fi según ipconfig> scripts/lan.sh iniciar`.
2. Descarga el repositorio en la laptop.
3. En una terminal, desde la carpeta del repositorio:

   ```sh
   scripts/lan.sh preparar
   ```

   Crea `.env.lan` con claves nuevas y construye la aplicación. Tarda varios minutos la primera vez. Al terminar, todo queda en la laptop.

4. Haz un ensayo completo con la red Starlink y dos o tres teléfonos (Android y iPhone): sigue «El día de la Asamblea» y, al final, «Después de la Asamblea».

### Ajustes de la laptop

- **Sin suspensión:** desactiva la suspensión y el apagado de pantalla mientras esté conectada a la corriente. En macOS, puedes dejar abierta una terminal con `caffeinate -dis`. Si la laptop se suspende, los teléfonos pierden la conexión.
- **Cargador conectado** durante toda la Asamblea.
- **Firewall:** la primera vez que un teléfono se conecte, el sistema puede preguntar si permite conexiones entrantes a Docker. Responde que sí. Si `iniciar` avisa que la aplicación no responde en la dirección de la red, revisa el firewall.
- **Una sola red:** desconecta el cable de red y otras redes Wi-Fi para que la laptop use solo el Wi-Fi de Starlink.

### Ajustes del router Starlink

- Ponle un nombre de red y una contraseña propios (app Starlink → Router). Comparte la contraseña solo en la sala.
- Deja el router en su modo normal: él reparte las direcciones a la laptop y a los teléfonos.
- No reinicies el router durante la Asamblea.
- Si la organización usa un router propio detrás de Starlink (modo *bypass*), configura en ese router una **reserva DHCP** para la laptop. Así su dirección no cambia nunca.

## El día de la Asamblea

1. Conecta la laptop al Wi-Fi de Starlink y abre Docker Desktop.
2. En la carpeta del repositorio:

   ```sh
   scripts/lan.sh iniciar
   ```

   Al terminar muestra un recuadro con la dirección para teléfonos (por ejemplo `http://192.168.1.37`) y la del panel.

3. Abre `http://localhost:8081/moderator` en el navegador de la laptop. Para la clave de la mesa:

   ```sh
   scripts/lan.sh credencial
   ```

4. Crea la Asamblea y pulsa «Abrir proyector en otra ventana». Lleva esa ventana a la pantalla del proyector y pulsa «Iniciar proyección». El proyector muestra el QR y, debajo, la dirección por si algún teléfono no puede escanearlo.
5. **Prueba con un teléfono** antes de abrir el ingreso a todos: conéctalo al Wi-Fi, escanea el QR y comprueba que aparece en la lista.

### Si algo falla

- **Un teléfono no abre la página:** confirma que está en el Wi-Fi de Starlink, no en datos móviles. Algunos teléfonos se pasan solos a datos si el Wi-Fi «no tiene Internet»; desactiva los datos móviles en ese teléfono.
- **Ver el estado:** `scripts/lan.sh estado` muestra los servicios y si la dirección de la laptop cambió.
- **La dirección de la laptop cambió** (por ejemplo, tras reiniciar el router): ejecuta `scripts/lan.sh iniciar` de nuevo. Cierra y vuelve a abrir el proyector desde el panel para que muestre el QR nuevo. Los teléfonos que ya se habían unido deben volver a escanearlo; si el ingreso ya estaba cerrado, la mesa decide si reabrirlo.
- **Registros para diagnosticar:** `scripts/lan.sh registros`.
- **Reiniciar la laptop a mitad de la Asamblea:** los datos se conservan. Vuelve a ejecutar `scripts/lan.sh iniciar`.

## Después de la Asamblea

Por decisión de Secretaría, los datos solo se guardan durante la Asamblea; después, el acta es el registro.

1. En el panel, finaliza la Asamblea.
2. En la tarjeta «Acta y borrado de datos»:
   1. **Imprimir o guardar PDF:** abre el diálogo de impresión con el acta (resultados por papeleta, anulaciones, declaraciones de la mesa y lista de participantes, con espacio para firmas). Elige la impresora o «Guardar como PDF».
   2. **Descargar CSV** (opcional): los mismos conteos para una hoja de cálculo.
   3. Entrega el acta a Secretaría.
   4. **Borrar datos de la Asamblea:** escribe `BORRAR` para confirmar. Se eliminan nombres, votos, resultados y registros, y se compacta la base para que no queden en sus archivos.
3. Al apagar, borra la base de datos completa y las claves:

   ```sh
   scripts/lan.sh borrar-todo
   ```

   Pide escribir `BORRAR`. Elimina el volumen de PostgreSQL, que también contiene los registros internos de la base. La siguiente Asamblea empieza otra vez con `scripts/lan.sh preparar`.

Si guardaste el acta en PDF o el CSV en la laptop, entrégalos a Secretaría y bórralos también de la laptop.

## Seguridad en esta red

**Riesgo aceptado: la conexión de los teléfonos no está cifrada.** Los teléfonos usan HTTP dentro del Wi-Fi, sin HTTPS. La contraseña del Wi-Fi impide que entre gente de fuera, pero no protege a un delegado de otra persona que también esté conectada. Alguien en la misma red, con las herramientas adecuadas, podría interponerse entre un teléfono y la laptop. Así podría ver la credencial de ese teléfono y su voto, o alterar lo que envía. Se decidió mantener HTTP (octubre de 2026) porque HTTPS en la red local exige un dominio propio con certificado o mostrar avisos de seguridad en cada teléfono.

Medidas para reducir el riesgo:

- Usa una contraseña de Wi-Fi nueva para cada Asamblea, dila solo en la sala y cámbiala al terminar. No uses una red abierta.
- Si el router lo permite, elige WPA3. Evita que alguien grabe el tráfico y lo descifre después con la contraseña, aunque no impide que alguien conectado se interponga.
- Que el Wi-Fi sea solo para la votación: no conectes otros equipos ni compartas la contraseña fuera de la sala.
- La mesa compara la participación con las personas presentes. Si un delegado dice que su voto no quedó registrado o que su teléfono mostró algo extraño, anúlala y repite la papeleta.

Lo que sí está protegido:

- El secreto del voto en la base de datos: al cerrar cada papeleta, el sistema desvincula los votos de quién participó (ver `docs/foundation/data-model.md`).
- La mesa: su clave nunca viaja por el Wi-Fi, porque el panel solo funciona en la laptop.
