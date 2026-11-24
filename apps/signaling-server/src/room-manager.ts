import crypto from 'node:crypto';
import type { ClientToServerMessage, ServerToClientMessage } from '@motion-party/shared';

export interface PeerTransport {
  send(message: ServerToClientMessage): void;
}

interface PeerRecord {
  id: string;
  role: 'host' | 'controller';
  roomCode: string;
  playerName?: string;
  color?: string;
  transport: PeerTransport;
}

interface RoomRecord {
  code: string;
  hostId: string;
  controllers: Set<string>;
  colorCursor: number;
}

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const PLAYER_COLORS = ['#38bdf8', '#fb7185', '#4ade80', '#facc15'];
const MAX_CONTROLLERS_PER_ROOM = 4;

export class RoomManager {
  private readonly rooms = new Map<string, RoomRecord>();
  private readonly peers = new Map<string, PeerRecord>();

  getRoomCount(): number {
    return this.rooms.size;
  }

  createPeerId(): string {
    return crypto.randomBytes(6).toString('hex');
  }

  private generateRoomCode(): string {
    for (let attempt = 0; attempt < 50; attempt++) {
      let code = '';
      for (let i = 0; i < 4; i++) {
        code += CODE_ALPHABET[crypto.randomInt(0, CODE_ALPHABET.length)];
      }
      if (!this.rooms.has(code)) {
        return code;
      }
    }
    throw new Error('Could not allocate unique room code.');
  }

  handleMessage(peerId: string, transport: PeerTransport, msg: ClientToServerMessage): void {
    switch (msg.type) {
      case 'create_room': {
        this.removePeer(peerId);
        const roomCode = this.generateRoomCode();
        this.rooms.set(roomCode, {
          code: roomCode,
          hostId: peerId,
          controllers: new Set(),
          colorCursor: 0,
        });
        this.peers.set(peerId, {
          id: peerId,
          role: 'host',
          roomCode,
          transport,
        });
        transport.send({ type: 'room_created', roomCode, hostId: peerId });
        return;
      }

      case 'join_room': {
        this.removePeer(peerId);
        const normalizedCode = msg.roomCode.trim().toUpperCase();
        const room = this.rooms.get(normalizedCode);
        if (!room) {
          transport.send({
            type: 'error',
            code: 'ROOM_NOT_FOUND',
            message: `No se encontró la sala "${normalizedCode}".`,
          });
          return;
        }

        if (room.controllers.size >= MAX_CONTROLLERS_PER_ROOM) {
          transport.send({
            type: 'error',
            code: 'ROOM_FULL',
            message: 'La sala ya alcanzó el máximo de 4 jugadores.',
          });
          return;
        }

        const host = this.peers.get(room.hostId);
        if (!host) {
          this.rooms.delete(normalizedCode);
          transport.send({
            type: 'error',
            code: 'HOST_UNAVAILABLE',
            message: 'La pantalla principal de esta sala ya no está conectada.',
          });
          return;
        }

        const cleanName =
          msg.playerName.trim().slice(0, 18) || `Jugador ${room.controllers.size + 1}`;
        const color = PLAYER_COLORS[room.colorCursor % PLAYER_COLORS.length]!;
        room.colorCursor += 1;
        room.controllers.add(peerId);

        this.peers.set(peerId, {
          id: peerId,
          role: 'controller',
          roomCode: normalizedCode,
          playerName: cleanName,
          color,
          transport,
        });

        transport.send({
          type: 'room_joined',
          roomCode: normalizedCode,
          peerId,
          hostId: room.hostId,
          playerName: cleanName,
          color,
        });

        host.transport.send({
          type: 'peer_joined',
          peerId,
          playerName: cleanName,
          color,
        });
        return;
      }

      case 'rtc_offer':
      case 'rtc_answer':
      case 'rtc_ice': {
        const sender = this.peers.get(peerId);
        const target = this.peers.get(msg.targetId);
        if (!sender || !target || sender.roomCode !== target.roomCode) {
          return;
        }
        if (msg.type === 'rtc_offer') {
          target.transport.send({ type: 'rtc_offer', fromId: peerId, sdp: msg.sdp });
        } else if (msg.type === 'rtc_answer') {
          target.transport.send({ type: 'rtc_answer', fromId: peerId, sdp: msg.sdp });
        } else {
          target.transport.send({ type: 'rtc_ice', fromId: peerId, candidate: msg.candidate });
        }
        return;
      }

      case 'relay_telemetry': {
        const sender = this.peers.get(peerId);
        if (!sender) return;
        const room = this.rooms.get(sender.roomCode);
        if (!room) return;
        const targetId = msg.targetId ?? (sender.role === 'controller' ? room.hostId : undefined);
        if (!targetId) return;
        const target = this.peers.get(targetId);
        if (!target || target.roomCode !== sender.roomCode) return;
        target.transport.send({
          type: 'relay_telemetry',
          fromId: peerId,
          packet: msg.packet,
        });
        return;
      }

      case 'relay_event': {
        const sender = this.peers.get(peerId);
        if (!sender) return;
        const room = this.rooms.get(sender.roomCode);
        if (!room) return;

        if (msg.targetId) {
          const target = this.peers.get(msg.targetId);
          if (target && target.roomCode === sender.roomCode) {
            target.transport.send({
              type: 'relay_event',
              fromId: peerId,
              packet: msg.packet,
            });
          }
          return;
        }

        if (sender.role === 'controller') {
          const host = this.peers.get(room.hostId);
          host?.transport.send({
            type: 'relay_event',
            fromId: peerId,
            packet: msg.packet,
          });
        } else {
          for (const controllerId of room.controllers) {
            this.peers.get(controllerId)?.transport.send({
              type: 'relay_event',
              fromId: peerId,
              packet: msg.packet,
            });
          }
        }
        return;
      }
    }
  }

  removePeer(peerId: string): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    this.peers.delete(peerId);

    const room = this.rooms.get(peer.roomCode);
    if (!room) return;

    if (peer.role === 'host') {
      for (const controllerId of room.controllers) {
        const controller = this.peers.get(controllerId);
        controller?.transport.send({ type: 'host_disconnected' });
        this.peers.delete(controllerId);
      }
      this.rooms.delete(peer.roomCode);
    } else {
      room.controllers.delete(peerId);
      const host = this.peers.get(room.hostId);
      host?.transport.send({ type: 'peer_left', peerId });
    }
  }
}
