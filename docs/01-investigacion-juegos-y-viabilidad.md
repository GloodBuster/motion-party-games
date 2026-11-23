# Investigación: Entretenimiento, Juegos de Mesa y Mandos con Teléfono Móvil (2025–2026)

Documento base con el análisis de viabilidad técnica de juegos estilo *Wii Sports* usando el móvil como mando en navegador/PC y los principales huecos detectados en entretenimiento, juegos de mesa y juegos sociales.

---

## Parte 1: Juegos estilo *Wii Sports* en PC/navegador usando el móvil como mando

### ¿Es técnicamente viable?
**Sí, es totalmente viable**, tanto en navegador web (sin instalar apps, entrando por código QR) como en app nativa, **siempre y cuando los juegos se diseñen respetando los límites físicos de los sensores de un teléfono** y no intentando replicar seguimiento espacial 3D exacto (6-DOF).

### 1. El secreto del Wii Remote original
- El mando original de la Wii *tampoco* conocía su posición exacta en el espacio mediante acelerómetro. Usaba el acelerómetro para **detectar gestos, velocidad del swing e inclinación**, y una cámara infrarroja apuntando a la barra sensora solo para el puntero.
- Con un teléfono ocurre igual: intentar calcular la posición 3D exacta integrando doblemente la aceleración acumula un error (*drift*) que rompe la posición en menos de 2 segundos.
- La inclinación vertical/lateral (*pitch* y *roll*) es muy estable gracias a la gravedad, pero el giro horizontal (*yaw*) deriva poco a poco porque el magnetómetro sufre interferencias en interiores y los navegadores lo limitan a ~10 Hz.

### 2. Viabilidad por tipo de juego en navegador
- **Alta viabilidad (funcionan muy bien):** Bolos (*Bowling*), Golf, Tenis, Béisbol, Pesca, volantes de carreras, dardos o boxeo por impulsos. Todos se basan en **momento del golpe, pico de aceleración, ángulo de muñeca (efecto/*spin*) y soltar un botón en el momento justo**.
- **Viabilidad media (requieren trucos de diseño):** Puntería/disparos (requieren un botón rápido de *"Recentrar"* en la pantalla del móvil) o peleas de espadas / ping-pong 1:1 continuo (requieren recentrado automático invisible entre cada punto o ronda para corregir el *drift*).

### 3. Límites técnicos del navegador (APIs Web)
- **Frecuencia de muestreo:** `DeviceMotionEvent` y `DeviceOrientationEvent` suelen estar limitados a **~60 Hz** en navegadores (frente a 100–200 Hz en apps nativas). 60 Hz (~16 ms por muestra) es suficiente para deportes arcade tipo Wii.
- **Permisos y pantalla:**
  - Requiere **HTTPS obligatorio**.
  - En iOS/iPadOS exige un toque explícito del usuario para llamar a `DeviceMotionEvent.requestPermission()`.
  - Es necesario usar la **Screen Wake Lock API** (`navigator.wakeLock.request("screen")`) para evitar que la pantalla del móvil se apague durante la partida.
- **Latencia de red (punto crítico):** Para que el golpe se sienta instantáneo, la latencia total de extremo a extremo debe mantenerse por debajo de **~100 ms**.
  - **WebSockets (TCP):** Un paquete perdido en Wi-Fi congela el movimiento hasta retransmitirse (*head-of-line blocking*).
  - **WebRTC (`RTCDataChannel`):** Es la solución recomendada en navegador. Configurado en modo **no fiable y sin orden** (`{ ordered: false, maxRetransmits: 0 }`) para telemetría continua de sensores (los paquetes perdidos se ignoran a favor del más reciente), más un segundo canal fiable para eventos discretos (botones, inicio/fin de jugada).

### 4. El principal reto NO técnico (y alternativas)
- **El miedo a lanzar un teléfono caro contra la TV o el monitor:** Un Wii Remote traía correa de muñeca y era económico; un smartphone no.
- **Soluciones que está adoptando la industria (2025–2026):**
  1. **Juegos de gestos controlados / muñeca:** golf suave, bolos sin soltar el móvil, volantes, caña de pescar, mini-juegos táctiles + inclinación.
  2. **Visión por computadora con cámara (MediaPipe / webcam):** sin sostener nada en la mano (enfoque adoptado por *Just Dance 2026 Camera Controller*, la consola *Nex Playground* y plataformas web como *MovePlay*).

### 5. Panorama competitivo (2025–2026)
- **Proyectos indie con el mismo concepto:** *Rally* (`playrally.cc`, tenis de mesa en navegador con móvil por QR), *Motioncade* (Steam, mini-juegos tipo Wii Sports con móvil) y *MotionSports*.
- **Grandes plataformas entrando al salón:** **Netflix Games on TV** (lanzado finales de 2025–2026) y **Amazon Luna GameNight** (2025–2026) ofrecen juegos de fiesta en Smart TV controlados con el móvil vía QR (*Pictionary*, *Codenames*, *Boggle*, *Overcooked*, *Ticket to Ride*). **AirConsole** continúa operando y se ha expandido al infoentretenimiento en automóviles (BMW, Volkswagen).
- **Ángulo de diferenciación:**
  - **Cero fricción en navegador:** sin suscripción a Netflix/Prime ni descarga de apps; escanear el QR en cualquier portátil conectado a la TV y jugar en 10 segundos.
  - **Mecánicas híbridas:** combinar movimiento suave del móvil + **información privada en la pantalla del teléfono** (algo que una webcam o un mando de Wii tradicional no pueden ofrecer).

---

## Parte 2: Otros huecos reales en entretenimiento, juegos de mesa y vida real

### 1. Juegos de mesa tácticos en TV usando el móvil como "mano privada"
- **El hueco:** Casi todos los juegos de móvil+TV (*Jackbox*, *AirConsole*) son frenéticos o de reflejos rápidos. Grupos de juegos de mesa, familias y no-*gamers* buscan **juegos por turnos más pausados** donde el televisor es el tablero compartido (resolviendo cálculos y reglas automáticamente) y cada teléfono muestra cartas secretas, rol oculto o inventario.
- **Referencia:** *Sunderfolk* (RPG táctico cooperativo en TV controlado desde el móvil). Hay mucho espacio para versiones más cortas (20–30 minutos) y accesibles en navegador.

### 2. Juegos sociales y de mesa tradicionales/regionales bien hechos (mercado hispanohablante)
- **El hueco:** *Jackbox* depende mucho del humor/referencias de EE. UU., cuesta ~30 USD por paquete y tiene poca adaptación cultural al español. Los juegos tradicionales de LATAM y España (**Truco, Mus, Escoba, Chinchón, Dominó por parejas, Lotería, Parqués, Basta/Tutti Frutti/Stop, deducción social**) suelen tener apps antiguas llenas de anuncios y sin modo "salón / pantalla compartida".
- **Oportunidad:** Plataforma web tipo *"Jackbox en español"* con humor local, sin descargas, pensada para reuniones/previas y capaz de escalar tanto a **2–3 jugadores** como a **grupos grandes de 12–20 personas** (casi todos los *party games* tienen un tope de 8).

### 3. "Árbitros digitales" y *Companion Apps* para juegos físicos
En vez de reemplazar el juego físico, eliminar su fricción:
- **Moderador automático para juegos de roles ocultos (Mafia, Pueblo Duerme / Hombre Lobo, Espía):** reparto secreto en móviles, narración/voz y temporizadores para que ningún amigo tenga que quedarse fuera narrando.
- **Escáner de puntuación por cámara para juegos de mesa físicos:** apuntar con el móvil a la mesa (*Rummikub*, *Dominó*, *Scrabble*, *Carcassonne*) para sumar puntos automáticamente.
- **Kits de *Escape Room* o *Misterio de Asesinato* en casa (PC + móviles):** pistas secretas y coartadas en tiempo real en cada teléfono mientras la pantalla del salón muestra el mapa y la cuenta atrás.

### 4. Cooperativo local asimétrico (para parejas: *gamer* + jugador casual)
- **El hueco:** Muchas parejas quieren jugar juntas en el sofá pero tienen distinto nivel de experiencia con mandos.
- **Oportunidad:** Juegos donde ambos roles sean igual de importantes pero con exigencia mecánica diferente (p. ej. uno controla acción/conducción y el otro gestiona radar, crafteo, pistas o puzzles desde el móvil o un segundo mando).

### 5. Adaptaciones digitales limpias de juegos de mesa modernos (en solitario o asíncronos)
- **El hueco:** El nicho de juegos de mesa en solitario (*solo boardgaming*) está en fuerte crecimiento, y los grupos adultos tienen poco tiempo para coincidir en directo.
- **Oportunidad:** Juegos de estrategia de mesa cortos con **multijugador asíncrono** (jugar el turno en 2 minutos desde móvil/navegador cuando haya tiempo libre, manteniendo alta interacción entre jugadores).

---

## Recomendación para el Primer Prototipo (MVP)

Empezar con **1 solo mini-juego muy pulido** (por ejemplo, **Bolos** o **Golf**, donde el riesgo de soltar el móvil es bajo y los 60 Hz son más que suficientes):

- **Frontend PC (`apps/host-web`):** Three.js / PixiJS o Canvas 2D + código QR en pantalla para unirse.
- **Frontend Móvil (`apps/controller-mobile`):** Web ligera con `DeviceMotionEvent` + `WakeLock` + vibración háptica (`navigator.vibrate` en Android).
- **Red (`apps/signaling-server`):** WebRTC `RTCDataChannel` no fiable (con fallback a WebSocket) para medir latencia real en red local.

### Próximos pasos al continuar en la otra PC
- [ ] Elegir el primer mini-juego o prototipo (Movimiento tipo Wii vs. Juego de mesa con mano privada).
- [ ] Elegir stack concreto (ej. TypeScript + Vite + Three.js/Canvas + Node/Bun para señalización).
- [ ] Construir prueba de concepto mínima de conexión QR + lectura de sensores en tiempo real.
