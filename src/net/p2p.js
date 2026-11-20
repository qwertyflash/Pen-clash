// A direct WebRTC data channel between two players. On the same Wi-Fi this usually
// connects device-to-device, which is much faster than going through a relay.
// Signalling messages travel over the relay via sendSignal().
const ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];

export const p2pSupported = () => typeof RTCPeerConnection === 'function';

export function createLink(initiator, sendSignal, { onOpen, onMessage, onClose }) {
  const pc = new RTCPeerConnection({ iceServers: ICE });
  let dc = null, open = false, closed = false, lastRx = performance.now();
  const queued = [];

  const fail = () => {
    if (closed) return;
    closed = true; clearTimeout(timer);
    const was = open; open = false;
    try { dc && dc.close(); } catch { /* */ }
    try { pc.close(); } catch { /* */ }
    onClose(was);
  };
  const setup = (ch) => {
    dc = ch;
    ch.onopen = () => { open = true; lastRx = performance.now(); clearTimeout(timer); onOpen(); };
    ch.onmessage = (e) => { lastRx = performance.now(); onMessage(e.data); };
    ch.onclose = fail;
    ch.onerror = fail;
  };
  pc.onicecandidate = (e) => { if (e.candidate) sendSignal({ c: e.candidate.toJSON() }); };
  pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed' || pc.connectionState === 'closed') fail(); };
  // Give up on the direct link if it hasn't opened in 12 s; the relay keeps working.
  const timer = setTimeout(() => { if (!open) fail(); }, 12000);

  if (initiator) {
    setup(pc.createDataChannel('game', { ordered: true }));
    pc.createOffer()
      .then((o) => pc.setLocalDescription(o))
      .then(() => sendSignal({ sdp: pc.localDescription.toJSON() }))
      .catch(fail);
  } else {
    pc.ondatachannel = (e) => setup(e.channel);
  }

  return {
    get open() { return open && dc && dc.readyState === 'open'; },
    get idleMs() { return performance.now() - lastRx; },
    send(s) { try { dc.send(s); } catch { fail(); } },
    close: fail,
    async signal(d) {
      try {
        if (d.sdp) {
          await pc.setRemoteDescription(d.sdp);
          for (const c of queued.splice(0)) await pc.addIceCandidate(c).catch(() => {});
          if (d.sdp.type === 'offer') {
            await pc.setLocalDescription(await pc.createAnswer());
            sendSignal({ sdp: pc.localDescription.toJSON() });
          }
        } else if (d.c) {
          if (pc.remoteDescription) await pc.addIceCandidate(d.c).catch(() => {});
          else queued.push(d.c);
        }
      } catch { fail(); }
    },
  };
}
