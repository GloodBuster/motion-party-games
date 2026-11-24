import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import type { ClientToServerMessage, ServerToClientMessage } from '@motion-party/shared';
import { createSignalingServer, type SignalingServerInstance } from '../src/server.js';

function connectWs(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function nextMessage(ws: WebSocket): Promise<ServerToClientMessage> {
  return new Promise((resolve) => {
    ws.once('message', (data) => {
      resolve(JSON.parse(data.toString()) as ServerToClientMessage);
    });
  });
}

function sendMsg(ws: WebSocket, msg: ClientToServerMessage): void {
  ws.send(JSON.stringify(msg));
}

describe('signaling-server integration', () => {
  let server: SignalingServerInstance | null = null;

  afterEach(async () => {
    if (server) {
      await server.close();
      server = null;
    }
  });

  it('creates rooms, joins controllers, forwards WebRTC offers and fallback telemetry', async () => {
    server = await createSignalingServer(0, '127.0.0.1');

    // Health & network-info endpoints
    const healthRes = await fetch(`http://127.0.0.1:${server.port}/api/health`);
    expect(healthRes.status).toBe(200);
    const healthJson = (await healthRes.json()) as { ok: boolean; rooms: number };
    expect(healthJson.ok).toBe(true);

    const hostWs = await connectWs(server.port);
    const createdPromise = nextMessage(hostWs);
    sendMsg(hostWs, { type: 'create_room' });
    const created = await createdPromise;
    expect(created.type).toBe('room_created');
    if (created.type !== 'room_created') return;

    const controllerWs = await connectWs(server.port);
    const joinedPromise = nextMessage(controllerWs);
    const peerJoinedPromise = nextMessage(hostWs);

    sendMsg(controllerWs, {
      type: 'join_room',
      roomCode: created.roomCode.toLowerCase(),
      playerName: 'Jose',
    });

    const joined = await joinedPromise;
    const peerJoined = await peerJoinedPromise;

    expect(joined.type).toBe('room_joined');
    expect(peerJoined.type).toBe('peer_joined');
    if (joined.type !== 'room_joined' || peerJoined.type !== 'peer_joined') return;

    // WebRTC offer forwarding controller -> host
    const offerReceivedPromise = nextMessage(hostWs);
    sendMsg(controllerWs, {
      type: 'rtc_offer',
      targetId: joined.hostId,
      sdp: { type: 'offer', sdp: 'v=0-mock' },
    });
    const offerReceived = await offerReceivedPromise;
    expect(offerReceived).toEqual({
      type: 'rtc_offer',
      fromId: joined.peerId,
      sdp: { type: 'offer', sdp: 'v=0-mock' },
    });

    // Fallback telemetry relay controller -> host
    const telemetryReceivedPromise = nextMessage(hostWs);
    sendMsg(controllerWs, {
      type: 'relay_telemetry',
      packet: {
        type: 'telemetry',
        seq: 1,
        ts: 12345,
        pitch: 12,
        roll: -8,
        yawRate: 0,
        rollRate: -20,
        accelMag: 6.4,
        forwardAccel: 5.5,
        holding: true,
      },
    });
    const telemetryReceived = await telemetryReceivedPromise;
    expect(telemetryReceived.type).toBe('relay_telemetry');

    // Disconnect notification
    const leftPromise = nextMessage(hostWs);
    controllerWs.close();
    const left = await leftPromise;
    expect(left).toEqual({ type: 'peer_left', peerId: joined.peerId });

    hostWs.close();
  });

  it('returns ROOM_NOT_FOUND when joining a nonexistent room', async () => {
    server = await createSignalingServer(0, '127.0.0.1');
    const ws = await connectWs(server.port);
    const errPromise = nextMessage(ws);
    sendMsg(ws, { type: 'join_room', roomCode: 'ZZZZ', playerName: 'Test' });
    const err = await errPromise;
    expect(err.type).toBe('error');
    if (err.type === 'error') {
      expect(err.code).toBe('ROOM_NOT_FOUND');
    }
    ws.close();
  });
});
