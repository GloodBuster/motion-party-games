import './styles.css';
import QRCode from 'qrcode';
import {
  BowlingScorer,
  buildSimulatedThrow,
  clamp,
  type ControllerEventPacket,
  type GamePhase,
  type PlayerSummary,
  type ThrowPayload,
} from '@motion-party/shared';
import { BowlingAudio } from './audio.js';
import { BowlingSimulation } from './bowling-physics.js';
import { HostNetwork, type TelemetryStats } from './network.js';
import { BowlingScene } from './scene.js';

interface PlayerState {
  id: string;
  name: string;
  color: string;
  scorer: BowlingScorer;
  isLocalDemo?: boolean;
}

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el as T;
};

const alleyCanvas = $<HTMLCanvasElement>('alley-canvas');
const hudRoomCode = $<HTMLElement>('hud-room-code');
const hudPlayerCount = $<HTMLElement>('hud-player-count');
const scoreboardContainer = $<HTMLElement>('scoreboard-container');

const toggleQrBtn = $<HTMLButtonElement>('toggle-qr-btn');
const closeQrBtn = $<HTMLButtonElement>('close-qr-btn');
const toggleDiagBtn = $<HTMLButtonElement>('toggle-diag-btn');
const muteBtn = $<HTMLButtonElement>('mute-btn');
const restartHostBtn = $<HTMLButtonElement>('restart-host-btn');

const qrPanel = $<HTMLElement>('qr-panel');
const qrCanvas = $<HTMLCanvasElement>('qr-canvas');
const qrRoomCode = $<HTMLElement>('qr-room-code');
const controllerUrlInput = $<HTMLInputElement>('controller-url-input');
const applyUrlBtn = $<HTMLButtonElement>('apply-url-btn');
const playersList = $<HTMLElement>('players-list');
const openSimBtn = $<HTMLButtonElement>('open-sim-btn');
const quickThrowBtn = $<HTMLButtonElement>('quick-throw-btn');

const diagPanel = $<HTMLElement>('diag-panel');
const diagTransport = $<HTMLElement>('diag-transport');
const horizonBar = $<HTMLElement>('horizon-bar');
const diagPitch = $<HTMLElement>('diag-pitch');
const diagRoll = $<HTMLElement>('diag-roll');
const diagAccel = $<HTMLElement>('diag-accel');
const diagHold = $<HTMLElement>('diag-hold');
const diagHz = $<HTMLElement>('diag-hz');
const diagDropped = $<HTMLElement>('diag-dropped');
const diagLastThrow = $<HTMLElement>('diag-last-throw');

const calloutBanner = $<HTMLElement>('callout-banner');
const calloutTitle = $<HTMLElement>('callout-title');
const calloutSub = $<HTMLElement>('callout-sub');

const gameoverModal = $<HTMLElement>('gameover-modal');
const gameoverWinner = $<HTMLElement>('gameover-winner');
const gameoverStandings = $<HTMLElement>('gameover-standings');
const playAgainBtn = $<HTMLButtonElement>('play-again-btn');

const turnBanner = $<HTMLElement>('turn-banner');
const throwReadout = $<HTMLElement>('throw-readout');

const audio = new BowlingAudio();
const scene = new BowlingScene(alleyCanvas);

async function bootstrap(): Promise<void> {
const sim = await BowlingSimulation.create();

// Estado de la partida
const players: PlayerState[] = [
  {
    id: 'local-demo',
    name: 'Jugador PC',
    color: '#38bdf8',
    scorer: new BowlingScorer(),
    isLocalDemo: true,
  },
];

let activePlayerIdx = 0;
let phase: GamePhase = 'aiming';
let laneOffset = 0;
let aimAngle = 0;
let liveRoll = 0;
let lastCallout = '';
let resultTimer: number | null = null;
let connectedPeers: PlayerSummary[] = [];
let detectedLanIp: string | null = null;
let customBaseUrl: string | null = null;
let currentRoomCode = '----';

function getActivePlayer(): PlayerState {
  return players[activePlayerIdx] ?? players[0]!;
}

function buildControllerBaseUrl(): string {
  if (customBaseUrl) return customBaseUrl.replace(/\/+$/, '');
  const protocol = window.location.protocol;
  const host = detectedLanIp ?? window.location.hostname;
  return `${protocol}//${host}:5174`;
}

async function renderQrCode(): Promise<void> {
  if (currentRoomCode === '----') return;
  const baseUrl = buildControllerBaseUrl();
  const fullUrl = `${baseUrl}/?room=${encodeURIComponent(currentRoomCode)}`;
  if (document.activeElement !== controllerUrlInput) {
    controllerUrlInput.value = baseUrl;
  }
  await QRCode.toCanvas(qrCanvas, fullUrl, {
    width: 210,
    margin: 1,
    color: { dark: '#0f172a', light: '#ffffff' },
  });
}

async function fetchLanInfo(): Promise<void> {
  try {
    const res = await fetch('/api/network-info');
    if (res.ok) {
      const data = (await res.json()) as { primaryIp: string | null };
      if (data.primaryIp) {
        detectedLanIp = data.primaryIp;
        await renderQrCode();
      }
    }
  } catch {
    // Usar hostname actual como respaldo
  }
}

function renderScoreboard(): void {
  scoreboardContainer.innerHTML = '';

  players.forEach((player, idx) => {
    const snap = player.scorer.getSnapshot();
    const row = document.createElement('div');
    row.className = `score-row${idx === activePlayerIdx ? ' active' : ''}`;

    const nameCell = document.createElement('div');
    nameCell.className = 'score-player-cell';
    nameCell.innerHTML = `<span class="player-dot" style="background:${player.color}"></span><span>${escapeHtml(player.name)}</span>`;
    row.appendChild(nameCell);

    snap.frames.forEach((frame, fIdx) => {
      const cell = document.createElement('div');
      const isCurrent = idx === activePlayerIdx && !snap.isGameOver && snap.currentFrame === fIdx + 1;
      cell.className = `frame-cell${isCurrent ? ' current' : ''}`;

      const rollsDiv = document.createElement('div');
      rollsDiv.className = `frame-rolls${fIdx === 9 ? ' tenth' : ''}`;
      frame.symbols.forEach((sym) => {
        const s = document.createElement('span');
        s.textContent = sym;
        if (sym === 'X') s.className = 'strike';
        else if (sym === '/') s.className = 'spare';
        rollsDiv.appendChild(s);
      });

      const totalDiv = document.createElement('div');
      totalDiv.className = 'frame-total';
      totalDiv.textContent = frame.cumulativeScore !== null ? String(frame.cumulativeScore) : '';

      cell.appendChild(rollsDiv);
      cell.appendChild(totalDiv);
      row.appendChild(cell);
    });

    const finalCell = document.createElement('div');
    finalCell.className = 'score-final-cell';
    finalCell.textContent = String(snap.totalScore);
    row.appendChild(finalCell);

    scoreboardContainer.appendChild(row);
  });
}

function renderPlayersList(): void {
  hudPlayerCount.textContent = `${connectedPeers.length} mando${connectedPeers.length === 1 ? '' : 's'}`;
  if (connectedPeers.length === 0) {
    playersList.innerHTML = '<li class="empty-players">Esperando primer teléfono...</li>';
    return;
  }

  playersList.innerHTML = '';
  for (const peer of connectedPeers) {
    const li = document.createElement('li');
    const badgeClass =
      peer.transport === 'webrtc'
        ? 'badge-webrtc'
        : peer.transport === 'ws-fallback'
          ? 'badge-ws'
          : 'badge-muted';
    const badgeLabel =
      peer.transport === 'webrtc'
        ? 'WebRTC'
        : peer.transport === 'ws-fallback'
          ? 'WS'
          : '...';
    li.innerHTML = `
      <span class="player-item-left">
        <span class="player-dot" style="background:${peer.color}"></span>
        <strong>${escapeHtml(peer.name)}</strong>
      </span>
      <span class="badge ${badgeClass}">${badgeLabel}</span>
    `;
    playersList.appendChild(li);
  }
}

function showCallout(title: string, subtitle: string, kind: 'normal' | 'strike' | 'spare' | 'gutter'): void {
  lastCallout = title;
  calloutTitle.textContent = title;
  calloutTitle.className = `callout-title${kind !== 'normal' ? ` ${kind}` : ''}`;
  calloutSub.textContent = subtitle;
  calloutBanner.classList.remove('hidden');
}

function hideCallout(): void {
  calloutBanner.classList.add('hidden');
}

function broadcastGameState(message?: string): void {
  const active = getActivePlayer();
  const snap = active.scorer.getSnapshot();
  const displayMsg =
    message ??
    (phase === 'aiming'
      ? `Turno de ${active.name} · Frame ${snap.currentFrame}, Tiro ${snap.currentRoll}`
      : phase === 'rolling'
        ? `¡Lanzamiento de ${active.name}!`
        : phase === 'game_over'
          ? '¡Partida finalizada!'
          : lastCallout);

  turnBanner.textContent = displayMsg;

  for (const peer of connectedPeers) {
    const peerPlayer = players.find((p) => p.id === peer.id);
    const peerSnap = peerPlayer?.scorer.getSnapshot() ?? snap;
    network.sendToPeer(peer.id, {
      type: 'game_state',
      state: {
        phase,
        activePlayerId: active.id,
        activePlayerName: active.name,
        yourTurn: active.id === peer.id,
        frame: peerSnap.currentFrame,
        roll: peerSnap.currentRoll,
        totalScore: peerSnap.totalScore,
        pinsStanding: snap.pinsStanding,
        laneOffset,
        aimAngle,
        message: displayMsg,
        lastCallout,
      },
    });
  }
}

function startNewMatch(): void {
  if (resultTimer !== null) {
    window.clearTimeout(resultTimer);
    resultTimer = null;
  }
  players.forEach((p) => p.scorer.reset());
  activePlayerIdx = 0;
  phase = 'aiming';
  laneOffset = 0;
  aimAngle = 0;
  liveRoll = 0;
  throwReadout.textContent = '';
  hideCallout();
  gameoverModal.classList.add('hidden');

  sim.resetAllPins();
  sim.resetBallToApproach(0);
  scene.setBallColor(getActivePlayer().color);
  renderScoreboard();
  broadcastGameState();
}

function triggerThrow(payload: ThrowPayload): void {
  if (phase !== 'aiming') return;

  // Cerrar el panel QR automáticamente al lanzar para despejar la pista
  qrPanel.classList.add('hidden');
  hideCallout();

  laneOffset = clamp(payload.laneOffset, -1, 1);
  aimAngle = clamp(payload.aimAngle, -16, 16);
  phase = 'rolling';

  const qualityLabel =
    payload.releaseQuality === 'perfect'
      ? 'Suelta perfecta'
      : payload.releaseQuality === 'good'
        ? 'Buena suelta'
        : 'Suelta temprana/tardía';
  throwReadout.textContent = `${payload.speed.toFixed(1)} m/s · Efecto ${payload.spin >= 0 ? '+' : ''}${payload.spin.toFixed(2)} · ${qualityLabel}`;
  diagLastThrow.textContent = `${payload.speed.toFixed(1)} m/s`;

  sim.launchBall(payload);
  audio.startRoll(payload.speed);
  broadcastGameState();
}

function handleRollFinished(pinsKnocked: number): void {
  audio.stopRoll();
  const active = getActivePlayer();
  const outcome = active.scorer.recordRoll(pinsKnocked);
  phase = 'frame_result';

  if (outcome.isStrike) {
    showCallout('¡STRIKE!', `${active.name} derribó los 10 pinos`, 'strike');
    audio.playStrike();
    network.sendToPeer(active.id, { type: 'haptic', pattern: 'strike' });
  } else if (outcome.isSpare) {
    showCallout('¡SPARE!', 'Todos los pinos limpios', 'spare');
    audio.playSpare();
    network.sendToPeer(active.id, { type: 'haptic', pattern: 'spare' });
  } else if (outcome.isGutter) {
    showCallout('CANALETA', '0 pinos en este tiro', 'gutter');
    network.sendToPeer(active.id, { type: 'haptic', pattern: 'gutter' });
  } else {
    showCallout(
      `${pinsKnocked} PINO${pinsKnocked === 1 ? '' : 'S'}`,
      outcome.frameComplete ? 'Fin del frame' : `Quedan ${active.scorer.getPinsStanding()} en pie`,
      'normal',
    );
  }

  renderScoreboard();
  broadcastGameState();

  resultTimer = window.setTimeout(() => {
    resultTimer = null;
    hideCallout();

    // Comprobar si todos los jugadores completaron los 10 frames
    const allFinished = players.every((p) => p.scorer.isGameOver());
    if (allFinished) {
      phase = 'game_over';
      showGameOver();
      broadcastGameState('¡Partida terminada! Pulsa "Jugar otra partida" para repetir.');
      return;
    }

    if (outcome.frameComplete) {
      // Avanzar al siguiente jugador que aún no haya terminado
      for (let i = 1; i <= players.length; i++) {
        const candidateIdx = (activePlayerIdx + i) % players.length;
        if (!players[candidateIdx]!.scorer.isGameOver()) {
          activePlayerIdx = candidateIdx;
          break;
        }
      }
      sim.resetAllPins();
    } else if (outcome.needsPinReset) {
      sim.resetAllPins();
    } else {
      sim.clearFallenPinsForNextRoll();
    }

    laneOffset = 0;
    aimAngle = 0;
    phase = 'aiming';
    sim.resetBallToApproach(0);
    scene.setBallColor(getActivePlayer().color);
    renderScoreboard();
    broadcastGameState();
  }, 2100);
}

function showGameOver(): void {
  const sorted = [...players].sort(
    (a, b) => b.scorer.getTotalScore() - a.scorer.getTotalScore(),
  );
  const winner = sorted[0]!;
  gameoverWinner.textContent =
    players.length > 1
      ? `🏆 Ganador: ${winner.name} (${winner.scorer.getTotalScore()} pts)`
      : `Puntuación final: ${winner.scorer.getTotalScore()} pts`;

  gameoverStandings.innerHTML = sorted
    .map(
      (p, i) => `
      <div class="standing-row">
        <span>${i + 1}. ${escapeHtml(p.name)}</span>
        <span>${p.scorer.getTotalScore()} pts</span>
      </div>
    `,
    )
    .join('');

  gameoverModal.classList.remove('hidden');
}

function syncConnectedPeersToPlayers(peers: PlayerSummary[]): void {
  connectedPeers = peers;
  renderPlayersList();

  if (peers.length === 0) {
    // Volver al jugador PC demo si todos los móviles se desconectaron
    if (players.length === 0 || !players[0]!.isLocalDemo) {
      players.splice(0, players.length, {
        id: 'local-demo',
        name: 'Jugador PC',
        color: '#38bdf8',
        scorer: new BowlingScorer(),
        isLocalDemo: true,
      });
      activePlayerIdx = 0;
      startNewMatch();
    }
    return;
  }

  // Reemplazar el jugador local demo cuando llega el primer mando móvil real
  const demoIdx = players.findIndex((p) => p.isLocalDemo);
  if (demoIdx !== -1) {
    players.splice(demoIdx, 1);
    activePlayerIdx = 0;
  }

  // Agregar nuevos mandos conectados
  for (const peer of peers) {
    if (!players.some((p) => p.id === peer.id)) {
      players.push({
        id: peer.id,
        name: peer.name,
        color: peer.color,
        scorer: new BowlingScorer(),
      });
    }
  }

  // Retirar mandos que se desconectaron
  for (let i = players.length - 1; i >= 0; i--) {
    const p = players[i]!;
    if (!p.isLocalDemo && !peers.some((peer) => peer.id === p.id)) {
      players.splice(i, 1);
    }
  }

  if (activePlayerIdx >= players.length) {
    activePlayerIdx = 0;
  }

  scene.setBallColor(getActivePlayer().color);
  renderScoreboard();
  broadcastGameState();
}

function updateDiagnosticsUI(stats: TelemetryStats): void {
  const { packet, transport, hz, dropped } = stats;
  diagTransport.textContent =
    transport === 'webrtc' ? 'WebRTC P2P' : transport === 'ws-fallback' ? 'WS Fallback' : '...';
  diagTransport.className = `badge ${
    transport === 'webrtc' ? 'badge-webrtc' : transport === 'ws-fallback' ? 'badge-ws' : 'badge-muted'
  }`;

  const pitchShift = clamp(packet.pitch * 0.4, -26, 26);
  horizonBar.style.transform = `translateY(${pitchShift.toFixed(1)}px) rotate(${packet.roll.toFixed(1)}deg)`;
  diagPitch.textContent = `${packet.pitch.toFixed(1)}°`;
  diagRoll.textContent = `${packet.roll.toFixed(1)}°`;
  diagAccel.textContent = `${packet.accelMag.toFixed(1)} m/s²`;
  diagHold.textContent = packet.holding ? 'Agarrando bola' : 'Libre';
  diagHz.textContent = `${hz} Hz`;
  diagDropped.textContent = String(dropped);
}

const network = new HostNetwork({
  onRoomCreated: (code) => {
    currentRoomCode = code;
    hudRoomCode.textContent = code;
    qrRoomCode.textContent = code;
    void renderQrCode();
  },
  onPeersChange: (peers) => {
    syncConnectedPeersToPlayers(peers);
  },
  onTelemetry: (stats) => {
    updateDiagnosticsUI(stats);
    if (stats.peerId === getActivePlayer().id) {
      liveRoll = stats.packet.roll;
    }
  },
  onControllerEvent: (peerId, event: ControllerEventPacket) => {
    if (event.type === 'restart_game') {
      startNewMatch();
      return;
    }

    const active = getActivePlayer();
    if (peerId !== active.id) return;

    switch (event.type) {
      case 'aim_move':
        if (phase === 'aiming') {
          laneOffset = clamp(event.laneOffset, -1, 1);
          aimAngle = clamp(event.aimAngle, -16, 16);
          sim.resetBallToApproach(laneOffset);
        }
        return;

      case 'recenter':
        if (phase === 'aiming') {
          laneOffset = 0;
          aimAngle = 0;
          liveRoll = 0;
          sim.resetBallToApproach(0);
        }
        return;

      case 'grab':
        if (phase === 'aiming') {
          turnBanner.textContent = `${active.name} agarró la bola — ¡haz el swing!`;
        }
        return;

      case 'release_cancel':
        if (phase === 'aiming') {
          turnBanner.textContent = `${active.name}: swing muy suave, inténtalo con más impulso.`;
        }
        return;

      case 'throw':
        triggerThrow(event.payload);
        return;
    }
  },
  onError: (msg) => {
    turnBanner.textContent = msg;
  },
});

// Controles UI del Host
toggleQrBtn.addEventListener('click', () => qrPanel.classList.toggle('hidden'));
closeQrBtn.addEventListener('click', () => qrPanel.classList.add('hidden'));
toggleDiagBtn.addEventListener('click', () => diagPanel.classList.toggle('hidden'));

muteBtn.addEventListener('click', () => {
  const muted = audio.toggleMute();
  muteBtn.textContent = muted ? '🔇' : '🔊';
});

restartHostBtn.addEventListener('click', () => startNewMatch());
playAgainBtn.addEventListener('click', () => startNewMatch());

applyUrlBtn.addEventListener('click', () => {
  const val = controllerUrlInput.value.trim();
  customBaseUrl = val.length > 0 ? val : null;
  void renderQrCode();
});

openSimBtn.addEventListener('click', () => {
  if (currentRoomCode === '----') return;
  const protocol = window.location.protocol;
  const url = `${protocol}//${window.location.hostname}:5174/?room=${encodeURIComponent(currentRoomCode)}&sim=1`;
  window.open(url, 'motion-party-controller', 'width=430,height=820');
});

quickThrowBtn.addEventListener('click', () => {
  triggerThrow(
    buildSimulatedThrow({
      powerPercent: 80,
      spin: 0.08,
      laneOffset,
      aimAngle,
    }),
  );
});

// Atajos de teclado en PC para pruebas rápidas
window.addEventListener('keydown', (ev) => {
  if (document.activeElement?.tagName === 'INPUT') return;

  if (ev.key === 'd' || ev.key === 'D') {
    diagPanel.classList.toggle('hidden');
  } else if (ev.key === 'q' || ev.key === 'Q') {
    qrPanel.classList.toggle('hidden');
  } else if (ev.key === 'm' || ev.key === 'M') {
    muteBtn.textContent = audio.toggleMute() ? '🔇' : '🔊';
  } else if (phase === 'aiming') {
    if (ev.key === 'ArrowLeft') {
      laneOffset = clamp(laneOffset - 0.1, -1, 1);
      sim.resetBallToApproach(laneOffset);
    } else if (ev.key === 'ArrowRight') {
      laneOffset = clamp(laneOffset + 0.1, -1, 1);
      sim.resetBallToApproach(laneOffset);
    } else if (ev.code === 'Space') {
      ev.preventDefault();
      triggerThrow(
        buildSimulatedThrow({
          powerPercent: 82,
          spin: 0.06,
          laneOffset,
          aimAngle,
        }),
      );
    }
  }
});

function escapeHtml(str: string): string {
  return str
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

// Arranque inicial
renderScoreboard();
network.connect();
void fetchLanInfo();

// Bucle de animación + física determinista
let lastFrameTime = performance.now();

function animate(now: number): void {
  const dt = Math.min(0.05, Math.max(0.001, (now - lastFrameTime) / 1000));
  lastFrameTime = now;

  if (phase === 'rolling') {
    const events = sim.step(dt);
    if (events.enteredGutter) {
      audio.stopRoll();
      audio.playGutter();
    }
    if (events.firstPinHit) {
      audio.playPinImpact(1.0);
      network.sendToPeer(getActivePlayer().id, { type: 'haptic', pattern: 'pin_hit' });
    }
    if (events.rollFinished) {
      handleRollFinished(events.pinsKnockedThisRoll);
    }
  }

  scene.updateAimGuide(phase === 'aiming', laneOffset, aimAngle, liveRoll);
  scene.syncPhysics(
    sim.getBallPose(),
    sim.getPinPoses(),
    phase === 'rolling' ? 'rolling' : phase === 'frame_result' ? 'result' : 'aiming',
  );
  scene.render(dt);

  requestAnimationFrame(animate);
}

requestAnimationFrame(animate);
}

void bootstrap();
