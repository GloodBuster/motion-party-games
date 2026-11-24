import './styles.css';
import {
  SwingDetector,
  buildSimulatedThrow,
  clamp,
  type HostGameStatePayload,
  type SensorTelemetryPacket,
  type TransportMode,
} from '@motion-party/shared';
import { ControllerConnection } from './connection.js';
import { MobileSensorManager } from './sensors.js';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
};

const joinScreen = $<HTMLElement>('join-screen');
const controllerScreen = $<HTMLElement>('controller-screen');
const joinForm = $<HTMLFormElement>('join-form');
const roomCodeInput = $<HTMLInputElement>('room-code-input');
const playerNameInput = $<HTMLInputElement>('player-name-input');
const connectBtn = $<HTMLButtonElement>('connect-btn');
const joinStatus = $<HTMLElement>('join-status');

const playerColorDot = $<HTMLElement>('player-color-dot');
const playerNameLabel = $<HTMLElement>('player-name-label');
const roomCodeBadge = $<HTMLElement>('room-code-badge');
const transportBadge = $<HTMLElement>('transport-badge');
const rttLabel = $<HTMLElement>('rtt-label');

const turnTitle = $<HTMLElement>('turn-title');
const turnSubtitle = $<HTMLElement>('turn-subtitle');
const scoreValue = $<HTMLElement>('score-value');
const frameLabel = $<HTMLElement>('frame-label');
const pinsLabel = $<HTMLElement>('pins-label');
const wakeLockLabel = $<HTMLElement>('wakelock-label');

const laneLeftBtn = $<HTMLButtonElement>('lane-left-btn');
const laneRightBtn = $<HTMLButtonElement>('lane-right-btn');
const laneSlider = $<HTMLInputElement>('lane-slider');
const angleLeftBtn = $<HTMLButtonElement>('angle-left-btn');
const angleRightBtn = $<HTMLButtonElement>('angle-right-btn');
const angleSlider = $<HTMLInputElement>('angle-slider');
const angleValue = $<HTMLElement>('angle-value');
const recenterBtn = $<HTMLButtonElement>('recenter-btn');

const gripBtn = $<HTMLButtonElement>('grip-btn');
const gripMainText = $<HTMLElement>('grip-main-text');
const gripSubText = $<HTMLElement>('grip-sub-text');
const accelBar = $<HTMLElement>('accel-bar');
const accelValue = $<HTMLElement>('accel-value');
const rollIndicator = $<HTMLElement>('roll-indicator');
const rollValue = $<HTMLElement>('roll-value');
const restartBtn = $<HTMLButtonElement>('restart-btn');

const simPanel = $<HTMLDetailsElement>('sim-panel');
const simPowerSlider = $<HTMLInputElement>('sim-power-slider');
const simPowerVal = $<HTMLElement>('sim-power-val');
const simSpinSlider = $<HTMLInputElement>('sim-spin-slider');
const simSpinVal = $<HTMLElement>('sim-spin-val');
const simThrowBtn = $<HTMLButtonElement>('sim-throw-btn');

const swingDetector = new SwingDetector();

let laneOffset = 0; // -1..1
let aimAngle = 0; // -14..14 deg
let canThrow = true;
let simSeq = 0;

// Pre-rellenar sala si viene del código QR (?room=XXXX)
const urlParams = new URLSearchParams(window.location.search);
const roomFromUrl = urlParams.get('room');
if (roomFromUrl) {
  roomCodeInput.value = roomFromUrl.toUpperCase().slice(0, 4);
}
const simRequested = urlParams.get('sim') === '1';

const sensors = new MobileSensorManager(
  (packet) => handleTelemetrySample(packet),
  (status) => {
    wakeLockLabel.textContent = `Pantalla activa: ${status.wakeLockActive ? 'Sí' : 'No'}`;
    if (status.hasImuEvents) {
      // Si el móvil ya manda IMU real, mantenemos el simulador colapsado salvo que se pida
      if (!simRequested) simPanel.open = false;
    }
  },
);

const connection = new ControllerConnection({
  onJoined: (info) => {
    joinScreen.classList.add('hidden');
    controllerScreen.classList.remove('hidden');
    playerColorDot.style.background = info.color;
    playerNameLabel.textContent = info.playerName;
    roomCodeBadge.textContent = info.roomCode;
    connectBtn.disabled = false;

    // Si en 1.8s no llegan eventos IMU reales (ej. navegador de PC), abrir panel simulador
    window.setTimeout(() => {
      if (!sensors.getStatus().hasImuEvents || simRequested) {
        simPanel.open = true;
      }
    }, 1800);
  },
  onTransportChange: (mode: TransportMode) => {
    transportBadge.className = 'badge';
    if (mode === 'webrtc') {
      transportBadge.classList.add('badge-webrtc');
      transportBadge.textContent = 'WebRTC P2P';
    } else if (mode === 'ws-fallback') {
      transportBadge.classList.add('badge-ws');
      transportBadge.textContent = 'WS Fallback';
    } else if (mode === 'connecting') {
      transportBadge.classList.add('badge-connecting');
      transportBadge.textContent = 'Conectando...';
    } else {
      transportBadge.classList.add('badge-connecting');
      transportBadge.textContent = 'Desconectado';
    }
  },
  onHostEvent: (event) => {
    if (event.type === 'game_state') {
      applyHostState(event.state);
    } else if (event.type === 'haptic') {
      sensors.triggerHaptic(event.pattern);
    }
  },
  onRttUpdate: (rttMs) => {
    rttLabel.textContent = `${rttMs} ms`;
  },
  onError: (message) => {
    joinStatus.textContent = message;
    joinStatus.classList.add('error');
    connectBtn.disabled = false;
  },
  onHostDisconnected: () => {
    controllerScreen.classList.add('hidden');
    joinScreen.classList.remove('hidden');
    joinStatus.textContent = 'La pantalla principal cerró la sala. Vuelve a escanear el QR.';
    joinStatus.classList.add('error');
    connectBtn.disabled = false;
  },
});

function handleTelemetrySample(packet: SensorTelemetryPacket): void {
  connection.sendTelemetry(packet);

  if (swingDetector.isHolding()) {
    swingDetector.pushSample({
      ts: packet.ts,
      accelMag: packet.accelMag,
      forwardAccel: packet.forwardAccel,
      roll: packet.roll,
      rollRate: packet.rollRate,
      yawRate: packet.yawRate,
    });
  }

  // Actualizar medidores visuales en el mando
  const pct = clamp((packet.accelMag / 20) * 100, 0, 100);
  accelBar.style.width = `${pct.toFixed(0)}%`;
  accelValue.textContent = `${packet.accelMag.toFixed(1)} m/s²`;

  const rollPct = clamp(50 + (packet.roll / 45) * 45, 5, 95);
  rollIndicator.style.left = `${rollPct.toFixed(0)}%`;
  rollValue.textContent = `${packet.roll.toFixed(0)}°`;
}

function applyHostState(state: HostGameStatePayload): void {
  scoreValue.textContent = String(state.totalScore);
  frameLabel.textContent = `Frame ${state.frame} · Tiro ${Math.max(1, state.roll)}`;
  pinsLabel.textContent = `${state.pinsStanding} pino${state.pinsStanding === 1 ? '' : 's'}`;

  const isGameOver = state.phase === 'game_over';
  restartBtn.classList.toggle('hidden', !isGameOver);

  canThrow = state.yourTurn && state.phase === 'aiming';
  gripBtn.disabled = !canThrow;
  simThrowBtn.disabled = !canThrow;

  if (isGameOver) {
    turnTitle.textContent = '¡Partida terminada!';
    turnSubtitle.textContent = state.message;
  } else if (state.yourTurn && state.phase === 'aiming') {
    turnTitle.textContent = '¡Es tu turno!';
    turnSubtitle.textContent = state.message || 'Apunta y haz el swing manteniendo el botón';
  } else if (state.yourTurn && state.phase === 'rolling') {
    turnTitle.textContent = '¡Bola en pista!';
    turnSubtitle.textContent = 'Mira la pantalla principal...';
  } else if (state.phase === 'frame_result') {
    turnTitle.textContent = state.lastCallout ?? 'Resultado';
    turnSubtitle.textContent = state.message;
  } else {
    turnTitle.textContent = `Turno de ${state.activePlayerName}`;
    turnSubtitle.textContent = state.message || 'Prepárate para tu siguiente frame';
  }
}

function emitAim(): void {
  laneSlider.value = String(Math.round(laneOffset * 100));
  angleSlider.value = String(Math.round(aimAngle));
  angleValue.textContent = `${Math.round(aimAngle)}°`;
  connection.sendEvent({
    type: 'aim_move',
    laneOffset: Number(laneOffset.toFixed(3)),
    aimAngle: Number(aimAngle.toFixed(1)),
    ts: Date.now(),
  });
}

// Formulario de conexión (dispara requestPermission + WakeLock dentro del gesto)
joinForm.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const code = roomCodeInput.value.trim().toUpperCase();
  if (code.length < 4) {
    joinStatus.textContent = 'Introduce el código de 4 caracteres de la pantalla.';
    joinStatus.classList.add('error');
    return;
  }

  joinStatus.classList.remove('error');
  joinStatus.textContent = 'Activando sensores y conectando a la sala...';
  connectBtn.disabled = true;

  const sensorStatus = await sensors.startFromUserGesture();
  joinStatus.textContent = `${sensorStatus.note} · Conectando...`;

  connection.connect(code, playerNameInput.value);
});

// Controles de apuntado
laneSlider.addEventListener('input', () => {
  laneOffset = clamp(Number(laneSlider.value) / 100, -1, 1);
  emitAim();
});

laneLeftBtn.addEventListener('click', () => {
  laneOffset = clamp(laneOffset - 0.14, -1, 1);
  emitAim();
});

laneRightBtn.addEventListener('click', () => {
  laneOffset = clamp(laneOffset + 0.14, -1, 1);
  emitAim();
});

angleSlider.addEventListener('input', () => {
  aimAngle = clamp(Number(angleSlider.value), -14, 14);
  emitAim();
});

angleLeftBtn.addEventListener('click', () => {
  aimAngle = clamp(aimAngle - 2, -14, 14);
  emitAim();
});

angleRightBtn.addEventListener('click', () => {
  aimAngle = clamp(aimAngle + 2, -14, 14);
  emitAim();
});

recenterBtn.addEventListener('click', () => {
  sensors.recenter();
  laneOffset = 0;
  aimAngle = 0;
  emitAim();
  connection.sendEvent({ type: 'recenter', ts: Date.now() });
  sensors.triggerHaptic('grab');
});

// Botón gigante de agarre y lanzamiento (mantener + swing + soltar botón)
gripBtn.addEventListener('pointerdown', (ev) => {
  if (!canThrow) return;
  ev.preventDefault();
  gripBtn.setPointerCapture(ev.pointerId);
  gripBtn.classList.add('holding');
  gripMainText.textContent = '¡BOLA AGARRADA! HAZ EL SWING';
  gripSubText.textContent = 'Suelta este botón en el punto más alto hacia delante';

  sensors.setHolding(true);
  swingDetector.startHold();
  sensors.triggerHaptic('grab');
  connection.sendEvent({ type: 'grab', ts: Date.now() });
});

function finishGrip(manualCancel = false): void {
  if (!swingDetector.isHolding()) return;
  gripBtn.classList.remove('holding');
  gripMainText.textContent = 'MANTÉN PULSADO PARA AGARRAR';
  gripSubText.textContent = 'Haz el swing hacia delante y suelta el botón en pantalla';
  sensors.setHolding(false);

  if (manualCancel) {
    swingDetector.cancelHold();
    connection.sendEvent({ type: 'release_cancel', reason: 'manual', ts: Date.now() });
    return;
  }

  const evaluation = swingDetector.finishHold(Date.now(), laneOffset, aimAngle);
  if (evaluation.status === 'throw') {
    sensors.triggerHaptic('release');
    connection.sendEvent({
      type: 'throw',
      payload: evaluation.payload,
      ts: Date.now(),
    });
  } else {
    turnSubtitle.textContent = 'Movimiento muy suave: mantén pulsado, balancea y suelta al subir.';
    connection.sendEvent({
      type: 'release_cancel',
      reason: 'swing_too_weak',
      ts: Date.now(),
    });
  }
}

gripBtn.addEventListener('pointerup', () => finishGrip(false));
gripBtn.addEventListener('pointercancel', () => finishGrip(true));

restartBtn.addEventListener('click', () => {
  connection.sendEvent({ type: 'restart_game', ts: Date.now() });
});

// Controles del modo simulador (pruebas en PC sin IMU)
simPowerSlider.addEventListener('input', () => {
  simPowerVal.textContent = `${simPowerSlider.value}%`;
});

simSpinSlider.addEventListener('input', () => {
  const spin = Number(simSpinSlider.value) / 100;
  simSpinVal.textContent = spin.toFixed(2);
  // También envía un paquete de telemetría simulado para probar el visualizador IMU del host
  simSeq += 1;
  handleTelemetrySample({
    type: 'telemetry',
    seq: simSeq,
    ts: Date.now(),
    pitch: 15,
    roll: spin * 42,
    yawRate: 0,
    rollRate: spin * 180,
    accelMag: (Number(simPowerSlider.value) / 100) * 16,
    forwardAccel: (Number(simPowerSlider.value) / 100) * 14,
    holding: false,
    simulated: true,
  });
});

simThrowBtn.addEventListener('click', () => {
  if (!canThrow) return;
  const powerPercent = Number(simPowerSlider.value);
  const spin = Number(simSpinSlider.value) / 100;

  // Enviar un pulso de telemetría simulada antes de lanzar para alimentar el diagnóstico del host
  simSeq += 1;
  handleTelemetrySample({
    type: 'telemetry',
    seq: simSeq,
    ts: Date.now(),
    pitch: 32,
    roll: spin * 40,
    yawRate: 0,
    rollRate: spin * 200,
    accelMag: (powerPercent / 100) * 19,
    forwardAccel: (powerPercent / 100) * 17,
    holding: true,
    simulated: true,
  });

  const payload = buildSimulatedThrow({
    powerPercent,
    spin,
    laneOffset,
    aimAngle,
  });
  connection.sendEvent({
    type: 'throw',
    payload,
    ts: Date.now(),
  });
});
