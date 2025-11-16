let socket;
let playerId = null;
let username = null;
let latestState = null;
const sonarBlips = [];
let sweepAngle = 0;
let lastFrameTime = performance.now();
const SWEEP_SPEED = 0.8;
const BLIP_FADE_MS = 1500;
let SONAR_RANGE_CLIENT = 500;

// DOM references
const loginOverlay = document.getElementById("login-overlay");
const mainUi = document.getElementById("main-ui");
const usernameInput = document.getElementById("username-input");
const joinBtn = document.getElementById("join-btn");
const statusText = document.getElementById("status-text");
const systemMessages = document.getElementById("system-messages");
const sonarList = document.getElementById("sonar-list");
const pingBtn = document.getElementById("ping-btn");
const fireBtn = document.getElementById("fire-btn");

const speedSlider = document.getElementById("speed-slider");
const depthSlider = document.getElementById("depth-slider");
const headingLabel = document.getElementById("heading-label");
const speedLabel = document.getElementById("speed-label");
const depthLabel = document.getElementById("depth-label");
const headingDial = document.getElementById("heading-dial");
const headingPointer = document.getElementById("heading-pointer");
const respawnPanel = document.getElementById("respawn-panel");
const respawnMessage = document.getElementById("respawn-message");
const respawnTimer = document.getElementById("respawn-timer");
const respawnBtn = document.getElementById("respawn-btn");

const mapCanvas = document.getElementById("map-canvas");
const mapCtx = mapCanvas.getContext("2d");
const sonarCanvas = document.getElementById("sonar-canvas");
const sonarCtx = sonarCanvas.getContext("2d");

let currentHeading = 0;
let headingDialActive = false;
let respawnAvailableAt = null;
let respawnCountdownInterval = null;

updateHeadingDisplay(currentHeading);

function connectSocket() {
  if (socket) return;
  socket = io();

  socket.on("connected", (data) => {
    statusText.textContent = data.message;
  });

  socket.on("joined", (data) => {
    playerId = data.id;
    username = data.username;
    statusText.textContent = `You are ${username}`;
  });

  socket.on("state_update", (data) => {
    latestState = data;
    if (data.max_depth) {
      depthSlider.max = data.max_depth;
    }
    if (data.sonar_range) {
      SONAR_RANGE_CLIENT = data.sonar_range;
    }
    handleRespawnState(data.you);
  });

  socket.on("system_message", (data) => {
    addMessage(data.message);
  });

  socket.on("sub_hit", (data) => {
    if (data.attacker_username) {
      addMessage(`🔥 ${data.victim_username} was hit by ${data.attacker_username}!`);
    } else {
      addMessage(`🔥 ${data.victim_username} was hit!`);
    }
  });

  socket.on("hit_confirmed", (data) => {
    addMessage(`✅ Direct hit on ${data.victim_username}!`);
  });

  socket.on("you_were_hit", (data) => {
    const message = data.by_username
      ? `You were hit by ${data.by_username}! Sub lost. Request a new hull once the crew is ready.`
      : "You were hit! Sub lost. Request a new hull once the crew is ready.";
    showRespawnPanel(data.respawn_available_at, message);
  });

  socket.on("respawn_ready", () => {
    respawnAvailableAt = null;
    updateRespawnCountdown();
  });

  socket.on("respawn_confirmed", () => {
    hideRespawnPanel();
    addMessage("✅ You have respawned at a new location.");
  });

  socket.on("respawn_not_ready", (data) => {
    if (data.message) {
      addMessage(data.message);
    }
  });

  socket.on("sonar_result", (data) => {
    const now = performance.now();
    sonarBlips.length = 0;
    if (data.contacts.length === 0) {
      sonarList.textContent = "No contacts.";
    } else {
      sonarList.innerHTML = "";
    }
    data.contacts.forEach((c) => {
      sonarBlips.push({
        distance: c.distance,
        bearing: c.bearing,
        depth: c.depth,
        username: c.username,
        lastDetectedAt: now,
      });
      const p = document.createElement("p");
      p.textContent = `${c.username}: ${c.distance} m at ${c.bearing}°, depth ${c.depth} m`;
      sonarList.appendChild(p);
    });
  });

  socket.on("sonar_ping_detected", (data) => {
    addMessage(`Sonar ping detected from ${data.pinging_username}!`);
  });

  socket.on("torpedo_fired", () => {
    addMessage("Torpedo away!");
  });
}

function addMessage(text) {
  const p = document.createElement("p");
  p.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
  systemMessages.appendChild(p);
  systemMessages.scrollTop = systemMessages.scrollHeight;
}

joinBtn.addEventListener("click", () => {
  const name = usernameInput.value.trim() || "Captain";
  loginOverlay.classList.add("hidden");
  mainUi.classList.remove("hidden");
  connectSocket();
  socket.emit("join_game", { username: name });
});

headingDial.addEventListener("pointerdown", (event) => {
  headingDialActive = true;
  headingDial.setPointerCapture(event.pointerId);
  updateHeadingFromPointer(event);
});

headingDial.addEventListener("pointermove", (event) => {
  if (!headingDialActive) return;
  updateHeadingFromPointer(event);
});

headingDial.addEventListener("pointerup", (event) => {
  if (!headingDialActive) return;
  headingDialActive = false;
  headingDial.releasePointerCapture(event.pointerId);
});

headingDial.addEventListener("pointerleave", (event) => {
  if (!headingDialActive) return;
  headingDialActive = false;
  headingDial.releasePointerCapture(event.pointerId);
});

speedSlider.addEventListener("input", () => {
  speedLabel.textContent = `Speed: ${speedSlider.value} kn`;
  sendControls();
});

depthSlider.addEventListener("input", () => {
  depthLabel.textContent = `Depth: ${depthSlider.value} m`;
  sendControls();
});

pingBtn.addEventListener("click", () => {
  socket.emit("sonar_ping");
});

fireBtn.addEventListener("click", () => {
  socket.emit("fire_torpedo");
});

respawnBtn.addEventListener("click", () => {
  if (!socket || respawnBtn.disabled) return;
  respawnBtn.disabled = true;
  socket.emit("request_respawn");
});

function sendControls() {
  if (!socket) return;
  socket.emit("update_controls", {
    heading: currentHeading,
    speed: parseFloat(speedSlider.value),
    depth: parseFloat(depthSlider.value),
  });
}

function normalizeHeading(value) {
  return ((value % 360) + 360) % 360;
}

function headingToCardinal(angle) {
  const directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return directions[Math.round(angle / 45) % 8];
}

function updateHeadingDisplay(angle) {
  const normalized = normalizeHeading(angle);
  headingLabel.textContent = `Heading: ${Math.round(normalized)}° (${headingToCardinal(normalized)})`;
  headingPointer.style.transform = `rotate(${normalized}deg)`;
}

function syncHeadingFromServer(angle) {
  currentHeading = normalizeHeading(angle);
  updateHeadingDisplay(currentHeading);
}

function setHeading(angle) {
  currentHeading = normalizeHeading(angle);
  updateHeadingDisplay(currentHeading);
  sendControls();
}

function updateHeadingFromPointer(event) {
  const rect = headingDial.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const dx = event.clientX - cx;
  const dy = event.clientY - cy;
  const angle = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
  setHeading(angle);
}

function showRespawnPanel(respawnAtSeconds, message, ready = false) {
  if (message) {
    respawnMessage.textContent = message;
  }
  respawnPanel.classList.remove("hidden");
  if (respawnCountdownInterval) {
    clearInterval(respawnCountdownInterval);
  }
  if (ready) {
    respawnAvailableAt = null;
  } else if (respawnAtSeconds) {
    respawnAvailableAt = respawnAtSeconds * 1000;
  } else {
    respawnAvailableAt = null;
  }
  updateRespawnCountdown();
  respawnCountdownInterval = setInterval(updateRespawnCountdown, 500);
}

function hideRespawnPanel() {
  if (respawnCountdownInterval) {
    clearInterval(respawnCountdownInterval);
    respawnCountdownInterval = null;
  }
  respawnPanel.classList.add("hidden");
  respawnTimer.textContent = "";
  respawnAvailableAt = null;
  respawnBtn.disabled = true;
}

function handleRespawnState(you) {
  if (!you) return;
  if (you.alive) {
    hideRespawnPanel();
    if (!headingDialActive && typeof you.heading === "number") {
      syncHeadingFromServer(you.heading);
    }
    return;
  }
  const message = respawnMessage.textContent || "You were hit.";
  showRespawnPanel(you.respawn_at, message, you.respawn_ready);
}

function updateRespawnCountdown() {
  if (respawnPanel.classList.contains("hidden")) return;
  if (respawnAvailableAt === null) {
    respawnTimer.textContent = "Ready to respawn.";
    respawnBtn.disabled = false;
    return;
  }
  const remaining = respawnAvailableAt - Date.now();
  if (remaining <= 0) {
    respawnAvailableAt = null;
    respawnTimer.textContent = "Ready to respawn.";
    respawnBtn.disabled = false;
  } else {
    respawnTimer.textContent = `Respawn available in ${Math.ceil(remaining / 1000)}s`;
    respawnBtn.disabled = true;
  }
}

function drawMap() {
  mapCtx.fillStyle = "#00121d";
  mapCtx.fillRect(0, 0, mapCanvas.width, mapCanvas.height);
  if (!latestState || !latestState.world_size) return;
  const scale = mapCanvas.width / latestState.world_size;

  if (latestState.torpedoes) {
    mapCtx.fillStyle = "yellow";
    latestState.torpedoes.forEach((torp) => {
      const x = torp.x * scale;
      const y = torp.y * scale;
      mapCtx.beginPath();
      mapCtx.arc(x, y, 3, 0, Math.PI * 2);
      mapCtx.fill();
    });
  }

  if (latestState.sonar_contacts) {
    mapCtx.fillStyle = "red";
    latestState.sonar_contacts.forEach((contact) => {
      const x = contact.x * scale;
      const y = contact.y * scale;
      mapCtx.beginPath();
      mapCtx.arc(x, y, 4, 0, Math.PI * 2);
      mapCtx.fill();
    });
  }

  if (latestState.you && latestState.you.alive) {
    const you = latestState.you;
    const x = you.x * scale;
    const y = you.y * scale;
    mapCtx.save();
    mapCtx.translate(x, y);
    mapCtx.rotate(((you.heading - 90) * Math.PI) / 180);
    mapCtx.fillStyle = "#00ff6a";
    mapCtx.beginPath();
    mapCtx.moveTo(10, 0);
    mapCtx.lineTo(-10, -6);
    mapCtx.lineTo(-10, 6);
    mapCtx.closePath();
    mapCtx.fill();
    mapCtx.restore();
  }
}

function drawSonar(now) {
  const w = sonarCanvas.width;
  const h = sonarCanvas.height;
  const cx = w / 2;
  const cy = h / 2;
  const maxRadius = Math.min(cx, cy) - 5;

  sonarCtx.clearRect(0, 0, w, h);
  sonarCtx.fillStyle = "#001b00";
  sonarCtx.fillRect(0, 0, w, h);

  sonarCtx.strokeStyle = "rgba(0,255,0,0.35)";
  sonarCtx.lineWidth = 1;
  const rings = 6;
  for (let i = 1; i <= rings; i++) {
    const r = (maxRadius * i) / rings;
    sonarCtx.beginPath();
    sonarCtx.arc(cx, cy, r, 0, Math.PI * 2);
    sonarCtx.stroke();
  }
  const spokes = 8;
  for (let i = 0; i < spokes; i++) {
    const angle = (i / spokes) * Math.PI * 2;
    sonarCtx.beginPath();
    sonarCtx.moveTo(cx, cy);
    sonarCtx.lineTo(cx + Math.cos(angle) * maxRadius, cy + Math.sin(angle) * maxRadius);
    sonarCtx.stroke();
  }

  sonarCtx.save();
  sonarCtx.translate(cx, cy);
  sonarCtx.rotate(sweepAngle - Math.PI / 2);
  const gradient = sonarCtx.createLinearGradient(0, 0, maxRadius, 0);
  gradient.addColorStop(0, "rgba(0,255,0,0.6)");
  gradient.addColorStop(1, "rgba(0,255,0,0.0)");
  sonarCtx.strokeStyle = gradient;
  sonarCtx.lineWidth = 2;
  sonarCtx.beginPath();
  sonarCtx.moveTo(0, 0);
  sonarCtx.lineTo(maxRadius, 0);
  sonarCtx.stroke();
  sonarCtx.restore();

  sonarBlips.forEach((blip) => {
    const age = now - blip.lastDetectedAt;
    if (age > BLIP_FADE_MS) return;
    let alpha = 1 - age / BLIP_FADE_MS;
    const blipAngleRad = ((blip.bearing - 90) * Math.PI) / 180;
    const angleDiff = shortestAngleDiff(sweepAngle, blipAngleRad);
    const angleWindow = (10 * Math.PI) / 180;
    if (Math.abs(angleDiff) < angleWindow) {
      alpha = Math.min(1, alpha + 0.4);
    }
    const r = maxRadius * Math.min(blip.distance / SONAR_RANGE_CLIENT, 1.0);
    const x = cx + Math.cos(blipAngleRad) * r;
    const y = cy + Math.sin(blipAngleRad) * r;
    sonarCtx.fillStyle = `rgba(255,0,0,${alpha})`;
    sonarCtx.beginPath();
    sonarCtx.arc(x, y, 4, 0, Math.PI * 2);
    sonarCtx.fill();
  });
}

function shortestAngleDiff(a, b) {
  let diff = (b - a + Math.PI) % (Math.PI * 2) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}

function gameRenderLoop() {
  const now = performance.now();
  const dt = (now - lastFrameTime) / 1000;
  lastFrameTime = now;
  sweepAngle += SWEEP_SPEED * dt;
  if (sweepAngle > Math.PI * 2) sweepAngle -= Math.PI * 2;

  drawMap();
  drawSonar(now);

  requestAnimationFrame(gameRenderLoop);
}

requestAnimationFrame(gameRenderLoop);
