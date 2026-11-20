// Relay over a public MQTT-over-WebSocket broker. Both players connect *out* to the
// broker, so this works on any static host and almost any network.
import mqtt from 'mqtt';

const DEFAULT_BROKERS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
  'wss://test.mosquitto.org:8081/mqtt',
];

function tryBroker(url, clientId, topic, protocolVersion) {
  return new Promise((res, rej) => {
    let done = false;
    const c = mqtt.connect(url, {
      clientId,
      clean: true,
      keepalive: 20,
      connectTimeout: 7000,
      reconnectPeriod: 2000,
      protocolVersion,
      will: { topic, payload: JSON.stringify({ k: 'x', id: clientId }), qos: 0, retain: false },
    });
    const fail = (e) => { if (done) return; done = true; clearTimeout(t); try { c.end(true); } catch { /* */ } rej(e); };
    const t = setTimeout(() => fail(new Error('timeout')), 8000);
    c.once('connect', () => { if (done) return; done = true; clearTimeout(t); res(c); });
    c.once('error', fail);
  });
}

/**
 * Connect to the first broker that answers. Returns a bus:
 * { name, send(str), onMessage(fn), onReconnect(fn), close() }
 */
export async function connectMqtt(code, myId, onStatus, brokers = window.MQTT_BROKERS || DEFAULT_BROKERS) {
  const topic = 'penclash/v2/' + code.toLowerCase();
  let cli = null, used = '';
  for (const url of brokers) {
    onStatus?.('Connecting to relay server (' + new URL(url).hostname + ')…');
    // MQTT 5 lets the broker skip echoing our own messages; fall back to 3.1.1 if refused.
    for (const v of [5, 4]) {
      try { cli = await tryBroker(url, myId, topic, v); used = url; break; }
      catch (e) { if (e && e.message === 'timeout') break; /* unreachable: next broker */ }
    }
    if (cli) break;
  }
  if (!cli) throw new Error('Could not reach any relay server. Check your internet connection (some office or school Wi-Fi blocks these), then try again.');

  let onMsg = () => {}, onRe = () => {}, closed = false;
  // noLocal: the broker does not echo our own messages back to us (halves the traffic we receive).
  const sub = () => new Promise((res, rej) =>
    cli.subscribe(topic, cli.options.protocolVersion === 5 ? { qos: 1, nl: true } : { qos: 1 }, (e) => (e ? rej(new Error('The relay server refused the match channel. Try again.')) : res())));
  cli.on('error', () => { /* reconnect handles it */ });
  cli.on('message', (_t, buf) => onMsg(buf.toString()));
  cli.on('connect', () => { if (!closed) sub().then(() => onRe(), () => {}); });
  await sub();

  return {
    name: 'relay',
    host: new URL(used).hostname,
    get connected() { return cli.connected; },
    send(s) { try { if (cli.connected) cli.publish(topic, s, { qos: 1 }); } catch { /* */ } },
    onMessage(fn) { onMsg = fn; },
    onReconnect(fn) { onRe = fn; },
    close(lastWords) {
      closed = true;
      try { if (lastWords && cli.connected) cli.publish(topic, lastWords, { qos: 0 }); cli.end(false); } catch { /* */ }
    },
  };
}
