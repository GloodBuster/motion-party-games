import { getLanNetworkInfo } from './network.js';
import { createSignalingServer } from './server.js';

const PORT = Number(process.env.PORT ?? 3001);
const HOST = process.env.HOST ?? '0.0.0.0';

const server = await createSignalingServer(PORT, HOST);
const net = getLanNetworkInfo();

console.log(`[signaling-server] Escuchando en http://${HOST}:${server.port} (WS: /ws)`);
if (net.primaryIp) {
  console.log(`[signaling-server] IP LAN principal detectada: ${net.primaryIp}`);
}

const shutdown = async () => {
  await server.close();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
