import os from 'node:os';

export interface NetworkInfo {
  lanIps: string[];
  primaryIp: string | null;
}

const VIRTUAL_IFACE_PATTERN = /(vethernet|wsl|docker|virtualbox|vmware|hyper-v|loopback|tailscale|zerotier|hamachi|bluetooth)/i;

/**
 * Detecta las direcciones IPv4 LAN del equipo priorizando Wi-Fi / Ethernet reales
 * sobre adaptadores virtuales (WSL, Docker, Hyper-V) para generar códigos QR útiles.
 */
export function getLanNetworkInfo(): NetworkInfo {
  const interfaces = os.networkInterfaces();
  const candidates: Array<{ address: string; priority: number }> = [];

  for (const [name, entries] of Object.entries(interfaces)) {
    if (!entries) continue;
    const isVirtual = VIRTUAL_IFACE_PATTERN.test(name);

    for (const entry of entries) {
      if (entry.family !== 'IPv4' || entry.internal) continue;
      const addr = entry.address;

      let priority = isVirtual ? 10 : 50;
      if (!isVirtual && /^192\.168\./.test(addr)) priority = 100;
      else if (!isVirtual && /^10\./.test(addr)) priority = 90;
      else if (!isVirtual && /^172\.(1[6-9]|2\d|3[01])\./.test(addr)) priority = 80;
      if (/wi-?fi|wlan|ethernet/i.test(name) && !isVirtual) priority += 10;

      candidates.push({ address: addr, priority });
    }
  }

  candidates.sort((a, b) => b.priority - a.priority);
  const lanIps = [...new Set(candidates.map((c) => c.address))];

  return {
    lanIps,
    primaryIp: lanIps[0] ?? null,
  };
}
