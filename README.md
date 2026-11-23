# Motion & Party Games

Repositorio base para diseñar y prototipar juegos sociales, de mesa y deportivos en navegador/PC usando **teléfonos móviles como mandos** (conexión por código QR, sensores de movimiento o pantalla privada de cartas/roles).

## Cómo retomar este proyecto en otra PC

1. Clona este repositorio:
   ```bash
   git clone https://github.com/GloodBuster/motion-party-games.git
   cd motion-party-games
   ```
2. Abre la carpeta en tu editor/CLI con Antigravity (leerá automáticamente [`AGENTS.md`](AGENTS.md) y `.agents/rules/`).
3. Revisa la investigación y análisis de viabilidad inicial en [`docs/01-investigacion-juegos-y-viabilidad.md`](docs/01-investigacion-juegos-y-viabilidad.md).
4. Decide el primer prototipo vertical (p. ej. **Bolos/Golf con sensores** o **juego de mesa/fiesta en español con mano privada**) y define el stack antes de generar código en `apps/`.

## Estructura de carpetas

```text
motion-party-games/
├── AGENTS.md                              # Reglas globales del proyecto para agentes IA
├── .agents/
│   ├── rules/                             # Reglas modulares activadas por contexto (Antigravity)
│   └── skills/                            # Skills reutilizables del proyecto
├── docs/
│   ├── 01-investigacion-juegos-y-viabilidad.md
│   └── arquitectura/                      # Decisiones técnicas, diagramas y protocolos
├── apps/
│   ├── host-web/                          # Pantalla compartida (PC / Smart TV)
│   ├── controller-mobile/                 # Mando en el navegador del teléfono
│   └── signaling-server/                  # Salas por QR y señalización WebRTC / WebSocket
└── packages/
    └── shared/                            # Tipos y mensajes compartidos
```
