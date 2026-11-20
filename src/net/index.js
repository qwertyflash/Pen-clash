// Pick a transport and join a match room.
//  1. Our own relay server (when the page is served by server/index.js) - most reliable.
//  2. Otherwise public MQTT brokers (works on static hosts like Vercel or Netlify).
// Either way the room upgrades to a direct WebRTC link between players when possible.
import { createRoom } from './room.js';
import { connectWs, relayAvailable } from './bus-ws.js';

const RELAY_URL = (import.meta.env.VITE_RELAY_URL || '').replace(/\/$/, '');

export async function joinNetRoom(code, role, onStatus) {
  const myId = role[0] + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  const p2p = !/[?&]nop2p\b/.test(location.search);
  let bus = null;
  const forceMqtt = /[?&]relay=mqtt\b/.test(location.search);
  if (!forceMqtt && (await relayAvailable(RELAY_URL))) {
    try { bus = await connectWs(code, myId, onStatus, RELAY_URL); } catch { bus = null; }
  }
  if (!bus) {
    // Loaded on demand: the MQTT library is most of the download.
    const { connectMqtt } = await import('./bus-mqtt.js');
    bus = await connectMqtt(code, myId, onStatus);
  }
  return createRoom(bus, myId, { p2p });
}
