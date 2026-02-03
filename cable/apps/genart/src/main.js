import "./style.css";

const canvas = document.querySelector("#canvas");
const hudApp = document.querySelector("#hud-app");
const hudStatus = document.querySelector("#hud-status");
const hudControls = document.querySelector("#hud-controls");

const palettes = {
  aurora: ["#8bd3ff", "#7fffd4", "#c8fffc", "#4fe0ff"],
  ember: ["#ffb36b", "#ff5f6d", "#ffd166", "#ff8fab"],
  neon: ["#7c5cff", "#00e5ff", "#00f5a0", "#f9f871"],
  tide: ["#6aa8ff", "#8bd3ff", "#b7f6ff", "#5ef2c1"],
};

const controlSchema = [
  {
    id: "speed",
    label: "Drift",
    type: "range",
    min: 0.2,
    max: 2.4,
    step: 0.05,
    value: 1,
  },
  {
    id: "density",
    label: "Swarm",
    type: "range",
    min: 200,
    max: 1600,
    step: 50,
    value: 900,
  },
  {
    id: "field",
    label: "Field",
    type: "range",
    min: 0.0006,
    max: 0.004,
    step: 0.0002,
    value: 0.0018,
  },
  {
    id: "stroke",
    label: "Glow",
    type: "range",
    min: 0.3,
    max: 1.6,
    step: 0.05,
    value: 0.9,
  },
  {
    id: "palette",
    label: "Palette",
    type: "select",
    value: "aurora",
    options: Object.keys(palettes).map((key) => ({
      value: key,
      label: key,
    })),
  },
  {
    id: "mode",
    label: "Mode",
    type: "select",
    value: "flow",
    options: [
      { value: "flow", label: "Flow" },
      { value: "orbital", label: "Orbital" },
      { value: "rift", label: "Rift" },
    ],
  },
  {
    id: "pulse",
    label: "Pulse",
    type: "button",
  },
];

const state = {
  speed: 1,
  density: 900,
  field: 0.0018,
  stroke: 0.9,
  palette: "aurora",
  mode: "flow",
  pulse: 0,
};

const particles = [];
let width = 0;
let height = 0;
let ctx = canvas.getContext("2d");
let lastTime = performance.now();

function syncHud() {
  hudControls.textContent = `drift ${state.speed.toFixed(2)} | swarm ${
    state.density
  } | field ${state.field.toFixed(4)} | ${state.palette} • ${state.mode}`;
}

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  width = window.innerWidth;
  height = window.innerHeight;
  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  rebuildParticles();
}

function rebuildParticles() {
  particles.length = 0;
  for (let i = 0; i < state.density; i += 1) {
    particles.push(makeParticle());
  }
}

function makeParticle() {
  return {
    x: Math.random() * width,
    y: Math.random() * height,
    vx: 0,
    vy: 0,
    hue: Math.random(),
    life: Math.random() * 200 + 100,
  };
}

function fieldAngle(x, y, t) {
  const nx = x * state.field;
  const ny = y * state.field;
  if (state.mode === "orbital") {
    return Math.sin(nx + t * 0.6) * 2 + Math.cos(ny - t * 0.8);
  }
  if (state.mode === "rift") {
    return Math.sin((nx + ny) * 1.6 - t) + Math.cos(nx * 2.1 + t * 0.4);
  }
  return (
    Math.sin(nx * 1.2 + t) +
    Math.cos(ny * 1.1 - t * 0.7) +
    Math.sin((nx + ny) * 0.5 + t * 0.3)
  );
}

function step(time) {
  const delta = Math.min(64, time - lastTime);
  lastTime = time;
  const t = time * 0.0005 * state.speed;
  ctx.fillStyle = "rgba(6, 10, 18, 0.08)";
  ctx.fillRect(0, 0, width, height);

  const palette = palettes[state.palette] ?? palettes.aurora;
  const lineWidth = state.stroke;
  ctx.lineWidth = lineWidth;
  ctx.globalCompositeOperation = "lighter";

  for (let i = 0; i < particles.length; i += 1) {
    const p = particles[i];
    const angle = fieldAngle(p.x, p.y, t);
    const speed = 0.5 + state.speed * 0.9;
    p.vx = Math.cos(angle) * speed;
    p.vy = Math.sin(angle) * speed;
    const nx = p.x + p.vx;
    const ny = p.y + p.vy;

    const color = palette[Math.floor(p.hue * palette.length) % palette.length];
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(nx, ny);
    ctx.stroke();

    p.x = nx;
    p.y = ny;
    p.life -= 1;

    if (
      p.life <= 0 ||
      p.x < -30 ||
      p.x > width + 30 ||
      p.y < -30 ||
      p.y > height + 30
    ) {
      particles[i] = makeParticle();
    }
  }

  ctx.globalCompositeOperation = "source-over";
  requestAnimationFrame(step);
}

function applyControl(controlId, value) {
  if (controlId === "pulse") {
    state.pulse = Date.now();
    rebuildParticles();
    return;
  }
  if (controlId in state) {
    state[controlId] = value;
    if (controlId === "density") {
      rebuildParticles();
    }
    syncHud();
  }
}

function coerceValue(control, value) {
  if (control.type === "range") return Number(value);
  if (control.type === "toggle") return Boolean(value);
  return value;
}

function boot() {
  const params = new URLSearchParams(window.location.search);
  const appId = params.get("appId") || "gen-art";
  const wsParam = params.get("ws");
  const wsUrl =
    wsParam ||
    `${window.location.protocol === "https:" ? "wss" : "ws"}://${
      window.location.host
    }/ws`;

  hudApp.textContent = `app: ${appId}`;

  resize();
  window.addEventListener("resize", resize);
  syncHud();
  requestAnimationFrame(step);

  let socket;
  try {
    socket = new WebSocket(wsUrl);
  } catch {
    hudStatus.textContent = "ws: offline";
    return;
  }

  socket.addEventListener("open", () => {
    hudStatus.textContent = "ws: live";
    socket.send(
      JSON.stringify({
        type: "controls",
        appId,
        controls: controlSchema,
      })
    );
  });

  socket.addEventListener("message", (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type !== "control" || msg.appId !== appId) return;
      const control = controlSchema.find((item) => item.id === msg.controlId);
      if (!control) return;
      applyControl(control.id, coerceValue(control, msg.value));
    } catch {
      // ignore
    }
  });

  socket.addEventListener("close", () => {
    hudStatus.textContent = "ws: offline";
  });
}

boot();
