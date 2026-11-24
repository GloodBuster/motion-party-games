import {
  DATA_CHANNEL_EVENTS,
  DATA_CHANNEL_TELEMETRY,
  PacketOrderingGuard,
  type ClientToServerMessage,
  type ControllerEventPacket,
  type HostEventPacket,
  type PlayerSummary,
  type SensorTelemetryPacket,
  type ServerToClientMessage,
  type TransportMode,
} from '@motion-party/shared';

interface PeerSession {
  id: string;
  name: string;
  color: string;
  transport: TransportMode;
  pc: RTCPeerConnection | null;
  telemetryChannel: RTCDataChannel | null;
  eventsChannel: RTCDataChannel | null;
  guard: PacketOrderingGuard;
  packetsInWindow: number;
  hz: number;
  lastWindowStart: number;
}

export interface TelemetryStats {
  peerId: string;
  transport: TransportMode;
  hz: number;
  dropped: number;
  packet: SensorTelemetryPacket;
}

export interface HostNetworkCallbacks {
  onRoomCreated: (roomCode: string) => void;
  onPeersChange: (peers: PlayerSummary[]) => void;
  onTelemetry: (stats: TelemetryStats) => void;
  onControllerEvent: (peerId: string, event: ControllerEventPacket) => void;
  onError: (message: string) => void;
}

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

export class HostNetwork {
  private ws: WebSocket | null = null;
  private readonly peers = new Map<string, PeerSession>();
  private readonly callbacks: HostNetworkCallbacks;
  private roomCode: string | null = null;

  constructor(callbacks: HostNetworkCallbacks) {
    this.callbacks = callbacks;
  }

  getRoomCode(): string | null {
    return this.roomCode;
  }

  connect(): void {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);
    this.ws = ws;

    ws.addEventListener('open', () => {
      this.sendSignaling({ type: 'create_room' });
    });

    ws.addEventListener('message', (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as ServerToClientMessage;
        void this.handleSignalingMessage(msg);
      } catch {
        // Ignorar JSON mal formado
      }
    });

    ws.addEventListener('error', () => {
      this.callbacks.onError('Error conectando con el servidor de señalización.');
    });

    ws.addEventListener('close', () => {
      window.setTimeout(() => this.connect(), 2500);
    });
  }

  getPeers(): PlayerSummary[] {
    return [...this.peers.values()].map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      connected: true,
      transport: p.transport,
    }));
  }

  sendToPeer(peerId: string, packet: HostEventPacket): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;

    if (peer.eventsChannel && peer.eventsChannel.readyState === 'open') {
      try {
        peer.eventsChannel.send(JSON.stringify(packet));
        return;
      } catch {
        // Usar fallback WebSocket
      }
    }

    this.sendSignaling({
      type: 'relay_event',
      targetId: peerId,
      packet,
    });
  }

  broadcastEvent(packet: HostEventPacket): void {
    for (const peerId of this.peers.keys()) {
      this.sendToPeer(peerId, packet);
    }
  }

  private emitPeersChange(): void {
    this.callbacks.onPeersChange(this.getPeers());
  }

  private sendSignaling(msg: ClientToServerMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private async handleSignalingMessage(msg: ServerToClientMessage): Promise<void> {
    switch (msg.type) {
      case 'room_created': {
        this.roomCode = msg.roomCode;
        this.callbacks.onRoomCreated(msg.roomCode);
        return;
      }

      case 'peer_joined': {
        this.peers.set(msg.peerId, {
          id: msg.peerId,
          name: msg.playerName,
          color: msg.color,
          transport: 'connecting',
          pc: null,
          telemetryChannel: null,
          eventsChannel: null,
          guard: new PacketOrderingGuard(),
          packetsInWindow: 0,
          hz: 0,
          lastWindowStart: performance.now(),
        });
        this.emitPeersChange();
        return;
      }

      case 'peer_left': {
        const peer = this.peers.get(msg.peerId);
        if (peer) {
          peer.telemetryChannel?.close();
          peer.eventsChannel?.close();
          peer.pc?.close();
          this.peers.delete(msg.peerId);
          this.emitPeersChange();
        }
        return;
      }

      case 'rtc_offer': {
        await this.handleOffer(msg.fromId, msg.sdp);
        return;
      }

      case 'rtc_ice': {
        const peer = this.peers.get(msg.fromId);
        if (peer?.pc && msg.candidate) {
          try {
            await peer.pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
          } catch {
            // Candidato tardío
          }
        }
        return;
      }

      case 'relay_telemetry': {
        const peer = this.peers.get(msg.fromId);
        if (!peer) return;
        if (peer.transport !== 'webrtc') {
          peer.transport = 'ws-fallback';
          this.emitPeersChange();
        }
        this.processTelemetry(peer, msg.packet);
        return;
      }

      case 'relay_event': {
        const peer = this.peers.get(msg.fromId);
        if (!peer) return;
        if (peer.transport === 'connecting') {
          peer.transport = 'ws-fallback';
          this.emitPeersChange();
        }
        this.processControllerEvent(peer, msg.packet as ControllerEventPacket);
        return;
      }

      case 'error': {
        this.callbacks.onError(msg.message);
        return;
      }
    }
  }

  private async handleOffer(peerId: string, sdp: RTCSessionDescriptionInit): Promise<void> {
    const peer = this.peers.get(peerId);
    if (!peer || typeof RTCPeerConnection === 'undefined') return;

    peer.pc?.close();
    const pc = new RTCPeerConnection(RTC_CONFIG);
    peer.pc = pc;

    pc.addEventListener('icecandidate', (ev) => {
      if (ev.candidate) {
        this.sendSignaling({
          type: 'rtc_ice',
          targetId: peerId,
          candidate: ev.candidate.toJSON(),
        });
      }
    });

    pc.addEventListener('datachannel', (ev) => {
      const channel = ev.channel;
      if (channel.label === DATA_CHANNEL_TELEMETRY) {
        peer.telemetryChannel = channel;
        channel.addEventListener('open', () => this.refreshPeerTransport(peer));
        channel.addEventListener('message', (msgEv) => {
          try {
            const packet = JSON.parse(String(msgEv.data)) as SensorTelemetryPacket;
            this.processTelemetry(peer, packet);
          } catch {
            // Ignorar paquete corrupto
          }
        });
      } else if (channel.label === DATA_CHANNEL_EVENTS) {
        peer.eventsChannel = channel;
        channel.addEventListener('open', () => this.refreshPeerTransport(peer));
        channel.addEventListener('message', (msgEv) => {
          try {
            const packet = JSON.parse(String(msgEv.data)) as ControllerEventPacket;
            this.processControllerEvent(peer, packet);
          } catch {
            // Ignorar
          }
        });
      }
    });

    pc.addEventListener('connectionstatechange', () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        peer.transport = 'ws-fallback';
        this.emitPeersChange();
      }
    });

    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    this.sendSignaling({
      type: 'rtc_answer',
      targetId: peerId,
      sdp: answer,
    });
  }

  private refreshPeerTransport(peer: PeerSession): void {
    if (
      peer.telemetryChannel?.readyState === 'open' &&
      peer.eventsChannel?.readyState === 'open'
    ) {
      peer.transport = 'webrtc';
      this.emitPeersChange();
    }
  }

  private processTelemetry(peer: PeerSession, packet: SensorTelemetryPacket): void {
    // Descartar paquetes viejos o fuera de orden
    if (!peer.guard.accept(packet)) {
      return;
    }

    peer.packetsInWindow += 1;
    const now = performance.now();
    const elapsed = now - peer.lastWindowStart;
    if (elapsed >= 1000) {
      peer.hz = Math.round((peer.packetsInWindow * 1000) / elapsed);
      peer.packetsInWindow = 0;
      peer.lastWindowStart = now;
    }

    this.callbacks.onTelemetry({
      peerId: peer.id,
      transport: peer.transport,
      hz: peer.hz,
      dropped: peer.guard.getStats().dropped,
      packet,
    });
  }

  private processControllerEvent(peer: PeerSession, event: ControllerEventPacket): void {
    if (event.type === 'ping') {
      this.sendToPeer(peer.id, {
        type: 'pong',
        clientTs: event.clientTs,
        hostTs: performance.now(),
      });
      return;
    }
    this.callbacks.onControllerEvent(peer.id, event);
  }
}
