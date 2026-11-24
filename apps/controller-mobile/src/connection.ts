import {
  DATA_CHANNEL_EVENTS,
  DATA_CHANNEL_TELEMETRY,
  EVENTS_CHANNEL_OPTIONS,
  TELEMETRY_CHANNEL_OPTIONS,
  type ClientToServerMessage,
  type ControllerEventPacket,
  type HostEventPacket,
  type SensorTelemetryPacket,
  type ServerToClientMessage,
  type TransportMode,
} from '@motion-party/shared';

export interface JoinedRoomInfo {
  roomCode: string;
  peerId: string;
  hostId: string;
  playerName: string;
  color: string;
}

export interface ControllerNetworkCallbacks {
  onJoined: (info: JoinedRoomInfo) => void;
  onTransportChange: (mode: TransportMode) => void;
  onHostEvent: (event: HostEventPacket) => void;
  onRttUpdate: (rttMs: number) => void;
  onError: (message: string) => void;
  onHostDisconnected: () => void;
}

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

export class ControllerConnection {
  private ws: WebSocket | null = null;
  private pc: RTCPeerConnection | null = null;
  private telemetryChannel: RTCDataChannel | null = null;
  private eventsChannel: RTCDataChannel | null = null;

  private hostId: string | null = null;
  private transport: TransportMode = 'disconnected';
  private fallbackTimer: number | null = null;
  private pingInterval: number | null = null;
  private readonly callbacks: ControllerNetworkCallbacks;

  constructor(callbacks: ControllerNetworkCallbacks) {
    this.callbacks = callbacks;
  }

  connect(roomCode: string, playerName: string): void {
    this.disconnect();
    this.setTransport('connecting');

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);
    this.ws = ws;

    ws.addEventListener('open', () => {
      this.sendSignaling({
        type: 'join_room',
        roomCode: roomCode.trim().toUpperCase(),
        playerName: playerName.trim() || 'Jugador',
      });
    });

    ws.addEventListener('message', (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as ServerToClientMessage;
        void this.handleSignalingMessage(msg);
      } catch {
        // Ignorar JSON inválido
      }
    });

    ws.addEventListener('error', () => {
      this.callbacks.onError('No se pudo conectar al servidor de señalización.');
    });

    ws.addEventListener('close', () => {
      if (this.transport !== 'webrtc') {
        this.setTransport('disconnected');
      }
    });
  }

  disconnect(): void {
    if (this.fallbackTimer !== null) {
      window.clearTimeout(this.fallbackTimer);
      this.fallbackTimer = null;
    }
    if (this.pingInterval !== null) {
      window.clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    this.telemetryChannel?.close();
    this.eventsChannel?.close();
    this.pc?.close();
    this.ws?.close();
    this.telemetryChannel = null;
    this.eventsChannel = null;
    this.pc = null;
    this.ws = null;
    this.hostId = null;
    this.setTransport('disconnected');
  }

  sendTelemetry(packet: SensorTelemetryPacket): void {
    if (this.telemetryChannel && this.telemetryChannel.readyState === 'open') {
      try {
        this.telemetryChannel.send(JSON.stringify(packet));
        return;
      } catch {
        // Caer al fallback WebSocket
      }
    }

    if (this.transport === 'ws-fallback' && this.ws?.readyState === WebSocket.OPEN) {
      this.sendSignaling({
        type: 'relay_telemetry',
        targetId: this.hostId ?? undefined,
        packet,
      });
    }
  }

  sendEvent(packet: ControllerEventPacket): void {
    if (this.eventsChannel && this.eventsChannel.readyState === 'open') {
      try {
        this.eventsChannel.send(JSON.stringify(packet));
        return;
      } catch {
        // Caer al fallback WebSocket
      }
    }

    if (this.ws?.readyState === WebSocket.OPEN && this.hostId) {
      this.sendSignaling({
        type: 'relay_event',
        targetId: this.hostId,
        packet,
      });
    }
  }

  private setTransport(mode: TransportMode): void {
    if (this.transport === mode) return;
    this.transport = mode;
    this.callbacks.onTransportChange(mode);
  }

  private sendSignaling(msg: ClientToServerMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private async handleSignalingMessage(msg: ServerToClientMessage): Promise<void> {
    switch (msg.type) {
      case 'room_joined': {
        this.hostId = msg.hostId;
        this.callbacks.onJoined({
          roomCode: msg.roomCode,
          peerId: msg.peerId,
          hostId: msg.hostId,
          playerName: msg.playerName,
          color: msg.color,
        });
        this.startPingLoop();
        await this.startWebRtcNegotiation(msg.hostId);
        return;
      }

      case 'rtc_answer': {
        if (this.pc) {
          await this.pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
        }
        return;
      }

      case 'rtc_ice': {
        if (this.pc && msg.candidate) {
          try {
            await this.pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
          } catch {
            // Candidato tardío o duplicado
          }
        }
        return;
      }

      case 'relay_event': {
        this.handleIncomingHostEvent(msg.packet as HostEventPacket);
        return;
      }

      case 'host_disconnected': {
        this.callbacks.onHostDisconnected();
        this.disconnect();
        return;
      }

      case 'error': {
        this.callbacks.onError(msg.message);
        return;
      }
    }
  }

  private async startWebRtcNegotiation(hostId: string): Promise<void> {
    if (typeof RTCPeerConnection === 'undefined') {
      this.setTransport('ws-fallback');
      return;
    }

    // Si WebRTC no abre en 3.2s (p. ej. firewall corporativo), activar fallback WebSocket
    this.fallbackTimer = window.setTimeout(() => {
      if (this.transport !== 'webrtc') {
        this.setTransport('ws-fallback');
      }
    }, 3200);

    const pc = new RTCPeerConnection(RTC_CONFIG);
    this.pc = pc;

    // Canal 1: telemetría no fiable y sin orden (baja latencia sin head-of-line blocking)
    const telemetry = pc.createDataChannel(DATA_CHANNEL_TELEMETRY, TELEMETRY_CHANNEL_OPTIONS);
    this.telemetryChannel = telemetry;

    // Canal 2: eventos discretos fiables
    const events = pc.createDataChannel(DATA_CHANNEL_EVENTS, EVENTS_CHANNEL_OPTIONS);
    this.eventsChannel = events;

    const checkChannelsOpen = () => {
      if (telemetry.readyState === 'open' && events.readyState === 'open') {
        if (this.fallbackTimer !== null) {
          window.clearTimeout(this.fallbackTimer);
          this.fallbackTimer = null;
        }
        this.setTransport('webrtc');
      }
    };

    telemetry.addEventListener('open', checkChannelsOpen);
    events.addEventListener('open', checkChannelsOpen);

    events.addEventListener('message', (ev) => {
      try {
        const packet = JSON.parse(String(ev.data)) as HostEventPacket;
        this.handleIncomingHostEvent(packet);
      } catch {
        // Ignorar
      }
    });

    pc.addEventListener('icecandidate', (ev) => {
      if (ev.candidate) {
        this.sendSignaling({
          type: 'rtc_ice',
          targetId: hostId,
          candidate: ev.candidate.toJSON(),
        });
      }
    });

    pc.addEventListener('connectionstatechange', () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.setTransport('ws-fallback');
        }
      }
    });

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.sendSignaling({
        type: 'rtc_offer',
        targetId: hostId,
        sdp: offer,
      });
    } catch {
      this.setTransport('ws-fallback');
    }
  }

  private handleIncomingHostEvent(packet: HostEventPacket): void {
    if (packet.type === 'pong') {
      const rtt = Math.max(1, Math.round(performance.now() - packet.clientTs));
      this.callbacks.onRttUpdate(rtt);
      return;
    }
    this.callbacks.onHostEvent(packet);
  }

  private startPingLoop(): void {
    if (this.pingInterval !== null) window.clearInterval(this.pingInterval);
    this.pingInterval = window.setInterval(() => {
      this.sendEvent({ type: 'ping', clientTs: performance.now() });
    }, 1500);
  }
}
