# Chiba Cable Remote Protocol (Concise Guide)

This is a lightweight, app-agnostic control protocol over WebSocket. Any artwork/app can:

1) Register its control schema.
2) Receive control updates from the phone remote.
3) (Optional) mirror its screen via a server-side capture.

---
## 1) Connect to the WS

Use the same WS server as the guide:

```
ws(s)://<HOST>/ws
```

You can pass it to your app via query params:

```
?ws=ws://localhost:8787/ws&appId=my-art
```

---
## 2) Register controls (app -> server)

Send this once on connect. The server stores the schema and the phone remote fetches it.

```json
{
  "type": "controls",
  "appId": "my-art",
  "controls": [
    { "id": "speed", "label": "Speed", "type": "range", "min": 0.2, "max": 3, "step": 0.1, "value": 1.0 },
    { "id": "palette", "label": "Palette", "type": "select", "options": [
      { "value": "aurora", "label": "Aurora" },
      { "value": "ember", "label": "Ember" }
    ], "value": "aurora" },
    { "id": "noise", "label": "Noise", "type": "toggle", "value": true },
    { "id": "pulse", "label": "Pulse", "type": "button" }
  ]
}
```

Types supported: `range`, `select`, `toggle`, `button`.

---
## 3) Receive control updates (server -> app)

The remote sends:

```json
{
  "type": "control",
  "appId": "my-art",
  "controlId": "speed",
  "value": 1.6
}
```

Your app should apply the value to its state and redraw.

---
## 4) Quick JS wiring (copy/paste)

```js
const params = new URLSearchParams(location.search);
const appId = params.get("appId") || "my-art";
const wsUrl =
  params.get("ws") ||
  `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;

const socket = new WebSocket(wsUrl);
socket.addEventListener("open", () => {
  socket.send(JSON.stringify({
    type: "controls",
    appId,
    controls: [ /* ... */ ]
  }));
});

socket.addEventListener("message", (event) => {
  const msg = JSON.parse(event.data);
  if (msg.type !== "control" || msg.appId !== appId) return;
  // apply msg.controlId + msg.value
});
```

---
## 5) Phone remote usage

Open:

```
/remote?app=<appId>
```

Example:

```
http://localhost:5173/remote?app=gen-art
```

The remote pulls the schema from:

```
GET /api/controls/:appId
```

---
## 6) Screen mirroring options

### Option A: Direct embed (simplest)
If your app is reachable by URL, add it directly to the guide as a program URL.

### Option B: Server-side capture (works for popups/cross-origin)
Use a headless browser (Playwright) to:
1) Open the app.
2) Dismiss modals.
3) Screenshot or stream it.

This repo already has a working example: `apps/server/src/village-capture.ts`.
You can copy that pattern and serve:

```
/my-app.jpg   (single frames)
/my-app       (HTML that refreshes frames)
```

If you need continuous video, consider an MJPEG endpoint or an ffmpeg RTSP bridge.

---
## 7) Sensors (mic/accelerometer) as controls

The phone remote can capture sensors and send them as `control` messages:

```json
{ "type": "control", "appId": "my-art", "controlId": "tiltX", "value": -0.12 }
{ "type": "control", "appId": "my-art", "controlId": "micLevel", "value": 0.64 }
```

Treat them like any other control input in your app.

---
## 8) Conventions

- `appId` must be unique and stable.
- Use short, lowercase `controlId` strings.
- Always filter incoming messages by `appId`.
- Keep controls small (5-10). Too many makes the remote hard to use.

---
## 9) Debug checklist

- Open the app once so it registers its controls.
- Verify `/api/controls/<appId>` returns JSON.
- Confirm the app and remote point at the same WS host.
- If the remote is on a phone, replace `localhost` with your LAN IP.
