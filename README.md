# Pen Clash

Flick-to-fight pen battles. 2 to 4 players: against 1-3 bots, pass & play on one device,
or online with a 4-letter code.

- **Arenas**: Classic Paper, Ice Rink (slippery), Tiny Desk (small), Square Notebook
  (deadly corners) and Eraser Field (fixed erasers to bank shots off).
- **Rules**: turns go round the table. A pen that falls off is out for the round; the
  last pen standing wins the round. First to 3 rounds wins.
- **Live win chance**: the bar under the scores estimates each player's chance to win
  the match from the scoreboard, how close each pen is to the edge, and whose turn it is.
- **New pen every round**: from round 2 everyone picks a pen before the round starts
  (not the one they just used; 15 s, or one is picked for you).
- **Boosters** pop up on the arena; slide over one to collect it. It works for one turn:
  - Freeze: your pen turns to ice, very hard to move, until your next turn.
  - Speed: your next shot is 50% stronger and glides further.
  - Fire: your next shot knocks pens back harder and does double damage.
- **Damage**: every pen shows its damage % and dents where it was hit hard.
- **PEN BREAK**: hit a pen hard 3 times in the same spot and it snaps. It keeps playing
  (shown broken for the rest of the round), but its ink floods the arena: everything
  gets more slippery and pens that slide through it pick up ink stains.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173 (also reachable from phones on your Wi-Fi)
```

For online play during development, run the relay server in a second terminal:

```bash
npm run build && npm start   # http://localhost:3000
```

## Project layout

```
index.html            page markup (screens: menu, setup, online lobby, game)
src/
  main.js             entry: wires up UI, render loop, debug panel
  style.css
  core/               no DOM: constants, arenas, physics (damage, breaks, pickups), boosters, bot AI, win-chance odds
  ui/                 audio, drawing, avatars, camera, menu, pen picker, screens
  game/
    state.js          shared state (current match, online session)
    match.js          rules, rounds, scoring, fixed-step simulation clock
    online.js         online sync (host/guest), connection label, debug text
    render.js, hud.js, input.js
  net/
    index.js          picks a transport and joins a room
    room.js           presence protocol (snapshots, deltas, heartbeats, de-duplication)
    p2p.js            direct WebRTC link between players
    bus-ws.js         relay via our own server
    bus-mqtt.js       relay via public MQTT brokers (for static hosting)
server/index.js       serves dist/ and the WebSocket relay at /ws
tests/                unit tests (node --test)
scripts/e2e.js        two-browser online test with real mouse drags
```

## How online play works

- The **host** creates the match, everyone joins with the code (up to 4 players), and the
  host taps Start. Late joiners watch. If a player disconnects, their pen is removed
  and the others play on.
- The **host** runs the real match. When something changes it sends a small state
  object, plus a keep-alive copy every second, so a lost message is repaired within a second.
- Each shot is sent as *where the pens started + the flick*. Every guest replays the
  shot with the same physics, so motion is smooth without streaming positions, then
  snaps to the host's final positions.
- A guest's flick is re-sent until the host acknowledges it, and is shown immediately
  on the guest's screen.
- Transport, best first:
  1. **Direct link** (WebRTC) between the two devices. On the same Wi-Fi this is usually
     device-to-device with very low lag.
  2. **Game server relay** (`server/index.js`), if the page is served by that server.
  3. **Public MQTT brokers**, when the site is static hosting (Vercel, Netlify...).
- Both players' pages carry a protocol version. If one of them has an old cached
  page, both are told to refresh instead of the match silently getting stuck.

During a match, tap the connection label under the hint (or press **D**) to open a
debug panel that shows the connection path, ping, and what each side is waiting for.
Add `?debug` to the URL to open it from the start.

## Deploy

### Option A: static hosting (Vercel, Netlify)

`vercel.json` and `netlify.toml` are included. Build command `npm run build`, output
`dist`. Online play then goes over public MQTT brokers, plus direct links when possible.

### Option B: Node server (recommended for online play)

Runs the game *and* its own relay, so you don't depend on public brokers.

- **Render**: `render.yaml` is included. New → Blueprint → pick this repo.
- **Docker** (Fly.io, Railway, any VPS): `docker build -t pen-clash . && docker run -p 3000:3000 pen-clash`
- **Plain Node**: `npm ci && npm run build && npm start` (`PORT` env var, default 3000)

To keep the static site but use a relay server deployed elsewhere, build with
`VITE_RELAY_URL=https://your-server.example.com npm run build`.

## Tests

```bash
npm test                      # unit tests
npm run build && npm run test:e2e        # needs: npm i -D playwright && npx playwright install chromium
E2E_DROP=0.3 E2E_P2P=0 npm run test:e2e  # relay drops 30% of messages
E2E_PLAYERS=4 E2E_ARENA=ice npm run test:e2e
E2E_PLAYERS=3 E2E_LEAVE=1 npm run test:e2e  # a player closes their tab mid-match
```
