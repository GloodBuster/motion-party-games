# Roadmap y Próximos Pasos

Documento vivo con el estado del MVP de **Bolos 3D** y las prioridades acordadas para la siguiente sesión de trabajo.

---

## Estado actual (MVP completado)
- Monorepo `pnpm` + **Node.js 24** + **TypeScript** (`packages/shared`, `apps/signaling-server`, `apps/host-web`, `apps/controller-mobile`).
- Conexión móvil ↔ PC mediante **código QR + salas de 4 caracteres**, **WebRTC `RTCDataChannel`** (canal `telemetry` no fiable/sin orden + canal `events` fiable) y *fallback* automático por WebSocket.
- Lectura de sensores IMU en navegador móvil (`DeviceMotionEvent`, `requestPermission()` iOS, filtro de gravedad Android, `Screen Wake Lock API`, háptica y modo simulador para PC).
- Pista de **Bolos 3D** en **Three.js + Rapier3D (WASM)**, audio procedural, marcador oficial de 10 frames (1–4 jugadores) y panel de **Diagnóstico IMU** en vivo (`D`).
- Suite de tests unitarios/integración/física (`pnpm test`) y validación E2E en navegador pasando.

---

## Prioridades para la próxima sesión

### 1. Optimizar detección de movimiento e inclinación (IMU)
- [ ] Probar con teléfonos reales (iOS y Android) y capturar perfiles reales de `pitch`, `roll`, `rotationRate` y aceleración durante el swing.
- [ ] Diferenciar mejor el **backswing** (hacia atrás) del **foreswing** (hacia delante) combinando giroscopio (`rotationRate.beta`) + aceleración lineal para evitar disparos en falso.
- [ ] Mejorar suavizado y calibración de inclinación (*pitch/roll*) con filtro complementario ligero y soporte cómodo para **diestros y zurdos**.
- [ ] Ajustar la curva de velocidad de la bola y la sensibilidad del efecto (*hook*) al girar la muñeca para que se sienta natural y controlable.
- [ ] Añadir opción de grabar/reproducir trazas reales de sensores como fixtures de test en `packages/shared/test/`.

### 2. Mejorar interfaces (Host 3D + Mando Móvil)
- [ ] **Mando móvil (`apps/controller-mobile`):**
  - Mejorar ergonomía para uso con una sola mano (apuntado por gestos o barra táctil más intuitiva sin apartar la vista de la TV).
  - Feedback visual más rico al apuntar, agarrar la bola, hacer strike/spare o cambiar de turno.
  - Guía paso a paso amigable si el navegador bloquea permisos IMU o HTTPS.
- [ ] **Pantalla compartida (`apps/host-web`):**
  - Mejorar estética y ambientación de la bolera 3D (iluminación, reflejos, animaciones del pinsetter/recogida de pinos, efectos de partículas/confeti en Strike y Spare).
  - Refinar transiciones de cámara, tabla de resultados y lobby de jugadores (selector de nombre/color/bola y botón "Listo").
  - Reducir tamaño del bundle de `host-web` separando chunks de `three` y `rapier3d`.

### 3. Pensar y diseñar los siguientes juegos (plataforma multi-juego)
- [ ] Evaluar una capa común de **Lobby / Selector de juegos** que reutilice salas QR, WebRTC y perfiles de jugadores.
- [ ] Definir el **segundo juego** apoyándonos en [`docs/01-investigacion-juegos-y-viabilidad.md`](01-investigacion-juegos-y-viabilidad.md):
  - **Línea movimiento (estilo Wii):** Golf (swing suave + putt), Dardos, Tenis arcade, Pesca o Volante de carreras.
  - **Línea social / mesa con mano privada en el móvil:** juego de deducción social / roles ocultos en español, *party game* cultural o juego de cartas tradicional en salón.

---

## Recordatorio rápido de arranque

```bash
pnpm install
pnpm dev        # Host: https://localhost:5173 | Mando: https://localhost:5174
pnpm test       # Tests de shared, signaling-server y física Rapier3D
```
