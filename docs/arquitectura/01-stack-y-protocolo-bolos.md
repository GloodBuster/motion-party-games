# ADR 001: Stack Técnico y Protocolo de Red — Prototipo Bolos 3D (MVP)

## Estado
Aceptado — Fase inicial de implementación.

## Contexto
El objetivo del primer prototipo vertical es validar la experiencia completa de un juego de movimiento estilo *Wii Sports Bowling* usando **el navegador del PC/TV como pantalla compartida** y **el navegador del teléfono móvil como mando** (conexión por código QR, sin instalar apps).

## Decisiones de Stack

### 1. Aplicación 100% Web + Monorepo `pnpm` con Node.js 24
- **Gestor y runtime:** `pnpm` workspaces + **Node.js 24** + **TypeScript** estricto.
  - Se elige **Node.js 24** frente a Bun porque ya está integrado con `pnpm` y Vite en Windows, evita mantener dos runtimes distintos en el monorepo y el servidor de señalización solo maneja salas ligeras y reenvío de *handshake* WebRTC (sin cuello de botella de CPU).
- **Pantalla compartida (`apps/host-web`):**
  - **Vite + TypeScript**
  - **Three.js** para renderizado 3D ligero de la pista, bola, 10 pinos y cámara dinámica.
  - **Rapier3D (`@dimforge/rapier3d-compat`)** para física rígida determinista en WebAssembly (colisiones de pinos, fricción y efecto/*hook* lateral por giro de muñeca).
  - **Web Audio API** procedural para efectos de rodado, impacto de pinos y celebración sin dependencias de assets externos pesados.
  - Generación de código QR local con `qrcode`.
- **Mando móvil (`apps/controller-mobile`):**
  - **Vite + TypeScript** (UI ligera orientada a móvil con botones grandes de baja latencia).
  - Lectura de `DeviceMotionEvent` y `DeviceOrientationEvent` con:
    - Solicitud de permiso iOS (`requestPermission()`) dentro de un toque explícito del usuario.
    - Filtro paso bajo (`GravityFilter`) cuando `event.acceleration` es `null` en dispositivos Android.
    - Prevención de suspensión con `Screen Wake Lock API` + re-adquisición en `visibilitychange`.
    - Vibración háptica (`navigator.vibrate`) para agarre, lanzamiento, strike y spare.
  - **Modo simulador integrado** para pruebas en escritorio o navegadores sin IMU.
- **Servidor de señalización (`apps/signaling-server`):**
  - **Node.js + `ws`** ligero: crea salas de 4 caracteres, expone la IP LAN local (`/api/network-info`), negocia el intercambio WebRTC (`offer`, `answer`, `ice`) y provee *fallback* automático por WebSocket si una red bloquea P2P.
- **Paquete compartido (`packages/shared`):**
  - Tipos de protocolo, filtro de gravedad, guarda de orden de paquetes por `timestamp`/`seq`, detector de swing de bolos y motor oficial de puntuación de 10 frames.

## Arquitectura de Red y HTTPS Local

Para evitar problemas de múltiples certificados autofirmados en iOS/Android durante desarrollo local:
- `host-web` corre en el puerto `5173` (HTTPS opcional/por defecto con `@vitejs/plugin-basic-ssl`) y hace proxy de `/ws` y `/api` hacia `signaling-server` (`127.0.0.1:3001`).
- `controller-mobile` corre en el puerto `5174` (HTTPS con `@vitejs/plugin-basic-ssl`) y hace proxy de `/ws` hacia `signaling-server` (`127.0.0.1:3001`).
- De este modo el teléfono solo necesita abrir **un único origen HTTPS** (`https://<IP-LAN>:5174/?room=XXXX`) y el WebSocket de señalización viaja sobre el mismo origen (`wss://<IP-LAN>:5174/ws`).
- Una vez negociado el enlace WebRTC:
  1. **Canal `telemetry`:** `{ ordered: false, maxRetransmits: 0 }` para telemetría continua IMU (~60 Hz). El receptor descarta paquetes con `ts` o `seq` más antiguos que el último procesado.
  2. **Canal `events`:** `{ ordered: true }` para eventos discretos fiables (`grab`, `release`, `aim_move`, `recenter`, `throw`, `game_state`, `haptic`, `ping`/`pong`).
- Si ICE/WebRTC no conecta en ~3.5 segundos, el cliente activa automáticamente el **modo WebSocket Fallback** transparente a través del servidor de señalización usando exactamente los mismos paquetes.

## Mecánica de Seguridad Física (UX) y Detección de Swing

Para evitar que el jugador suelte o lance el teléfono físicamente:
1. El jugador **mantiene pulsado** un botón grande en pantalla (*Agarrar bola*), similar al botón B del Wii Remote.
2. Mientras mantiene pulsado, el mando acumula muestras IMU en un buffer circular de `450 ms`.
3. Al hacer el péndulo hacia delante, el jugador **suelta el botón en pantalla** (sin soltar el teléfono).
4. `SwingDetector` calcula:
   - **Velocidad de lanzamiento (`4.8 – 13.5 m/s`):** a partir del pico de aceleración lineal en la ventana previa a soltar. Si el pico es inferior a `2.2 m/s²`, el lanzamiento se cancela como toque accidental.
   - **Efecto / Hook (`-1 .. +1`):** combinación de inclinación de muñeca (*roll* relativo al recentrado) y velocidad angular de giro en el momento del lanzamiento.
   - **Calidad de suelta (`perfect | good | early_or_late`):** proximidad temporal entre el pico del swing y el instante en que se soltó el botón.
