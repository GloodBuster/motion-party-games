import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import type { ClientToServerMessage, ServerToClientMessage } from '@motion-party/shared';
import { getLanNetworkInfo } from './network.js';
import { RoomManager } from './room-manager.js';

export interface SignalingServerInstance {
  httpServer: http.Server;
  wss: WebSocketServer;
  roomManager: RoomManager;
  port: number;
  close(): Promise<void>;
}

export async function createSignalingServer(
  port = 3001,
  host = '0.0.0.0',
): Promise<SignalingServerInstance> {
  const roomManager = new RoomManager();

  const httpServer = http.createServer((req, res) => {
    const url = req.url ?? '/';
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (url.startsWith('/api/health')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, rooms: roomManager.getRoomCount() }));
      return;
    }

    if (url.startsWith('/api/network-info')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(getLanNetworkInfo()));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (socket: WebSocket) => {
    const peerId = roomManager.createPeerId();
    const transport = {
      send(message: ServerToClientMessage): void {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify(message));
        }
      },
    };

    socket.on('message', (raw) => {
      try {
        const parsed = JSON.parse(raw.toString()) as ClientToServerMessage;
        if (!parsed || typeof parsed.type !== 'string') return;
        roomManager.handleMessage(peerId, transport, parsed);
      } catch {
        transport.send({
          type: 'error',
          code: 'INVALID_JSON',
          message: 'Mensaje mal formado.',
        });
      }
    });

    socket.on('close', () => {
      roomManager.removePeer(peerId);
    });

    socket.on('error', () => {
      roomManager.removePeer(peerId);
    });
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, host, () => {
      httpServer.off('error', reject);
      resolve();
    });
  });

  const address = httpServer.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;

  return {
    httpServer,
    wss,
    roomManager,
    port: actualPort,
    close: async () => {
      for (const client of wss.clients) {
        client.terminate();
      }
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}
