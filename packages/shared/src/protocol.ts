export type TransportMode = 'webrtc' | 'ws-fallback' | 'connecting' | 'disconnected';

export type GamePhase = 'waiting' | 'aiming' | 'rolling' | 'frame_result' | 'game_over';

export type ReleaseQuality = 'perfect' | 'good' | 'early_or_late';

export type HapticPattern = 'grab' | 'release' | 'strike' | 'spare' | 'pin_hit' | 'gutter';

export interface PlayerSummary {
  id: string;
  name: string;
  color: string;
  connected: boolean;
  transport: TransportMode;
}

/**
 * Paquete de telemetría continua enviado a ~60 Hz por el canal no fiable (RTCDataChannel).
 */
export interface SensorTelemetryPacket {
  type: 'telemetry';
  seq: number;
  ts: number;
  pitch: number; // grados (-180..180)
  roll: number; // grados (-90..90), relativo al recentrado
  yawRate: number; // deg/s
  rollRate: number; // deg/s
  accelMag: number; // m/s^2 (magnitud aceleración lineal sin gravedad)
  forwardAccel: number; // m/s^2
  holding: boolean;
  simulated?: boolean;
}

export interface ThrowPayload {
  speed: number; // m/s (4.8 .. 13.5)
  spin: number; // -1 (izquierda) .. +1 (derecha)
  aimAngle: number; // grados (-16 .. +16)
  laneOffset: number; // -1 (izquierda) .. +1 (derecha)
  peakAccel: number; // m/s^2
  releaseQuality: ReleaseQuality;
  simulated?: boolean;
}

export type ControllerEventPacket =
  | { type: 'ping'; clientTs: number }
  | { type: 'grab'; ts: number }
  | { type: 'release_cancel'; reason: 'swing_too_weak' | 'manual'; ts: number }
  | { type: 'aim_move'; laneOffset: number; aimAngle: number; ts: number }
  | { type: 'recenter'; ts: number }
  | { type: 'throw'; payload: ThrowPayload; ts: number }
  | { type: 'restart_game'; ts: number };

export interface HostGameStatePayload {
  phase: GamePhase;
  activePlayerId: string | null;
  activePlayerName: string;
  yourTurn: boolean;
  frame: number; // 1..10
  roll: number; // 1..3
  totalScore: number;
  pinsStanding: number;
  laneOffset: number;
  aimAngle: number;
  message: string;
  lastCallout?: string;
}

export type HostEventPacket =
  | { type: 'pong'; clientTs: number; hostTs: number }
  | { type: 'game_state'; state: HostGameStatePayload }
  | { type: 'haptic'; pattern: HapticPattern };

/**
 * Mensajes del servidor de señalización (WebSocket).
 */
export type ClientToServerMessage =
  | { type: 'create_room' }
  | { type: 'join_room'; roomCode: string; playerName: string }
  | { type: 'rtc_offer'; targetId: string; sdp: RTCSessionDescriptionInit }
  | { type: 'rtc_answer'; targetId: string; sdp: RTCSessionDescriptionInit }
  | { type: 'rtc_ice'; targetId: string; candidate: RTCIceCandidateInit }
  | { type: 'relay_telemetry'; targetId?: string; packet: SensorTelemetryPacket }
  | { type: 'relay_event'; targetId?: string; packet: ControllerEventPacket | HostEventPacket };

export type ServerToClientMessage =
  | { type: 'room_created'; roomCode: string; hostId: string }
  | {
      type: 'room_joined';
      roomCode: string;
      peerId: string;
      hostId: string;
      playerName: string;
      color: string;
    }
  | { type: 'peer_joined'; peerId: string; playerName: string; color: string }
  | { type: 'peer_left'; peerId: string }
  | { type: 'host_disconnected' }
  | { type: 'rtc_offer'; fromId: string; sdp: RTCSessionDescriptionInit }
  | { type: 'rtc_answer'; fromId: string; sdp: RTCSessionDescriptionInit }
  | { type: 'rtc_ice'; fromId: string; candidate: RTCIceCandidateInit }
  | { type: 'relay_telemetry'; fromId: string; packet: SensorTelemetryPacket }
  | { type: 'relay_event'; fromId: string; packet: ControllerEventPacket | HostEventPacket }
  | { type: 'error'; code: string; message: string };

export const DATA_CHANNEL_TELEMETRY = 'telemetry';
export const DATA_CHANNEL_EVENTS = 'events';

export const TELEMETRY_CHANNEL_OPTIONS: RTCDataChannelInit = {
  ordered: false,
  maxRetransmits: 0,
};

export const EVENTS_CHANNEL_OPTIONS: RTCDataChannelInit = {
  ordered: true,
};
