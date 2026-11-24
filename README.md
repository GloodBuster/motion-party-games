# Motion & Party Games — Bolos 3D (MVP)

Prototipo de juegos sociales y de movimiento en navegador/PC usando **teléfonos móviles como mandos** mediante código QR, sensores IMU y WebRTC de baja latencia.

## Requisitos
- **Node.js** `>= 22` (probado en Node `24.x`)
- **pnpm** `>= 10`

## Instalación y arranque rápido

```bash
pnpm install
pnpm dev
```

Esto levanta en paralelo:
- **Pantalla principal (`host-web`):** `https://localhost:5173` (PC / TV)
- **Mando móvil (`controller-mobile`):** `https://localhost:5174` (se abre escaneando el QR desde el móvil en el mismo Wi-Fi)
- **Servidor de señalización (`signaling-server`):** `http://127.0.0.1:3001` (proxeado por ambos frontends en `/ws` y `/api`)

> **HTTPS en el móvil (red local):** iOS y Android exigen HTTPS para habilitar `DeviceMotionEvent`. En desarrollo local se usa un certificado autofirmado de Vite (`@vitejs/plugin-basic-ssl`), por lo que la primera vez que abras el QR en el teléfono deberás aceptar la advertencia de certificado local.
>
> Si quieres probar solo en PC en HTTP sin certificado autofirmado:
> ```bash
> pnpm dev:http
> ```

## Cómo jugar / probar

### Con teléfono móvil (recomendado)
1. Abre `https://localhost:5173` en el PC/TV.
2. Conecta tu teléfono al **mismo Wi-Fi** y escanea el código QR en pantalla.
3. Pulsa **"Conectar y activar sensores"** (activa permisos IMU en iOS/Android y `Screen Wake Lock`).
4. Ajusta tu posición/ángulo en la pista, **mantén pulsado el botón grande para agarrar la bola**, haz el swing hacia delante sin soltar el teléfono y **suelta el botón en pantalla** en el punto más alto.
   - Inclinar/girar la muñeca (*roll*) aplica efecto (*hook*) a la bola.
   - Abre **"Sensores IMU"** (o tecla `D`) en el PC para inspeccionar en vivo pitch, roll, aceleración, Hz, paquetes descartados y transporte (`WebRTC P2P` vs `WS Fallback`).

### Sin móvil (en el mismo PC)
- Pulsa **"Abrir mando simulado (PC)"** en el panel del QR para conectar una ventana de mando por WebRTC/WebSocket y lanzar con el simulador de potencia + efecto.
- O usa directamente el teclado en el Host: `←` / `→` para moverte en la pista y `Espacio` para lanzar.

## Comandos útiles

```bash
pnpm typecheck   # Validación estricta de TypeScript en todo el monorepo
pnpm test        # Tests unitarios (sensores, puntuación, señalización WS, física Rapier3D)
pnpm build       # Compilación de producción de host-web y controller-mobile
```

## Estructura de carpetas

```text
motion-party-games/
├── AGENTS.md                                  # Reglas globales del proyecto para agentes IA
├── .agents/rules/motion-sensors.md            # Reglas para sensores IMU, Wake Lock y baja latencia
├── docs/
│   ├── 01-investigacion-juegos-y-viabilidad.md
│   └── arquitectura/
│       └── 01-stack-y-protocolo-bolos.md      # ADR de stack, protocolo y física
├── packages/
│   └── shared/                                # Protocolo, filtro gravedad, SwingDetector, BowlingScorer
└── apps/
    ├── signaling-server/                      # Salas por código/QR, señalización WebRTC y WS fallback
    ├── host-web/                              # Bolos 3D (Three.js + Rapier3D + Audio + QR + HUD IMU)
    └── controller-mobile/                     # Mando móvil (IMU 60Hz, WakeLock, háptica, simulador)
```
