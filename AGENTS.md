# AGENTS.md

Instrucciones y convenciones de trabajo para los agentes de IA (Antigravity / Gemini / Claude) que trabajen en este repositorio.

## Contexto del proyecto
Este repositorio nace para explorar y prototipar juegos sociales/party y deportivos en navegador o escritorio que usan **teléfonos móviles como mandos** (por código QR, sensores de movimiento o interfaz privada de cartas/roles) junto a una pantalla compartida (PC / TV).

Antes de proponer arquitectura o código nuevo, revisa siempre [`docs/01-investigacion-juegos-y-viabilidad.md`](docs/01-investigacion-juegos-y-viabilidad.md).

## Idioma y comunicación
- Responder siempre en **español**.
- Mantener explicaciones claras, directas y enfocadas en decisiones prácticas.
- Comentar el código solo cuando la lógica no sea obvia (por ejemplo, matemáticas de filtros de sensores o protocolos de red).

## Principios técnicos para este proyecto
1. **Cero fricción para el usuario final:** priorizar acceso por navegador + código QR antes que obligar a instalar apps nativas.
2. **Diseñar alrededor de los límites reales de los sensores (IMU):**
   - No intentar tracking posicional 6-DOF por doble integración del acelerómetro.
   - Priorizar gestos, picos de aceleración, inclinación (*pitch/roll*), velocidad angular (*spin*) y botones de recentrado.
   - Recordar requisitos de navegador móvil: HTTPS obligatorio, `DeviceMotionEvent.requestPermission()` en iOS y `Screen Wake Lock API`.
3. **Baja latencia en red:** preferir WebRTC `RTCDataChannel` no fiable/sin orden (`ordered: false, maxRetransmits: 0`) para telemetría continua de sensores y un canal fiable para eventos discretos (botones, inicio/fin de turno).
4. **Prototipar pequeño:** validar primero **1 solo mini-juego completo** (p. ej. Bolos, Golf o un juego de mesa social) antes de construir un catálogo grande.

## Estructura del repositorio
- `docs/`: investigación de mercado, notas de diseño y arquitectura.
- `apps/host-web/`: aplicación de pantalla compartida (PC / TV).
- `apps/controller-mobile/`: aplicación web ligera que corre en el móvil como mando.
- `apps/signaling-server/`: gestión de salas/QR y señalización WebRTC (o fallback WebSocket).
- `packages/shared/`: tipos y esquemas de mensajes compartidos entre host, móvil y servidor.

## Flujo de trabajo
- Hacer commits pequeños y descriptivos (formato recomendado: `feat:`, `fix:`, `docs:`, `chore:`).
- Al tomar decisiones importantes de arquitectura o stack, documentarlas en `docs/arquitectura/`.
