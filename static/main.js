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
let PASSIVE_SONAR_RANGE_CLIENT = 750;
let SUB_MAX_SPEED_CLIENT = 20;
const DEPTH_ARROW_TOLERANCE = 1;

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

const depthSlider = document.getElementById("depth-slider");
// Old labels removed/replaced by actuals panel
const speedLabel = document.getElementById("speed-label");
const depthLabel = document.getElementById("depth-label");
const speedTelegraph = document.getElementById("speed-telegraph");

// New Heading Dial Elements
const headingDial = document.getElementById("heading-dial");
const headingRing = document.getElementById("heading-ring");
const headingInner = document.getElementById("heading-inner");

// New Actuals Panel Elements
const actualHeadingEl = document.getElementById("actual-heading");
const actualSpeedEl = document.getElementById("actual-speed");
const actualDepthEl = document.getElementById("actual-depth");

const respawnPanel = document.getElementById("respawn-panel");
const respawnMessage = document.getElementById("respawn-message");
const respawnTimer = document.getElementById("respawn-timer");
const respawnBtn = document.getElementById("respawn-btn");

const mapCanvas = document.getElementById("map-canvas");
const mapCtx = mapCanvas.getContext("2d");
const sonarCanvas = document.getElementById("sonar-canvas");
const sonarCtx = sonarCanvas.getContext("2d");

let currentHeadingOrder = 0; // The commanded heading (outer ring)
let currentHeadingActual = 0; // The actual heading (inner dial)
let currentSpeedOrder = 0;
let headingDialActive = false;
let respawnAvailableAt = null;
let respawnCountdownInterval = null;
const SPEED_ORDERS = [
  { label: "All Stop", value: 0 },
  { label: "1/4 Ahead", value: 1 },
  { label: "1/2 Ahead", value: 2 },
  { label: "3/4 Ahead", value: 3 },
  { label: "Full Ahead", value: 4 },
  { label: "Rev", value: -1 }, // Added reverse just in case, though not in UI yet
];
// Filter to just positive for telegraph for now
const UI_SPEED_ORDERS = SPEED_ORDERS.filter(o => o.value >= 0);

const speedOrderButtons = [];
const MAX_SPEED_ORDER_VALUE = UI_SPEED_ORDERS[UI_SPEED_ORDERS.length - 1].value;

updateHeadingRing(currentHeadingOrder);
initializeSpeedTelegraph();

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
    if (data.passive_sonar_range) {
      PASSIVE_SONAR_RANGE_CLIENT = data.passive_sonar_range;
    }
    if (typeof data.sub_max_speed === "number") {
      SUB_MAX_SPEED_CLIENT = data.sub_max_speed;
    }

    // Update Actuals
    if (data.you && data.you.alive) {
      updateActualsDisplay(data.you);
      // Sync inner dial to actual heading
      if (typeof data.you.heading === "number") {
        currentHeadingActual = data.you.heading;
        updateHeadingInner(currentHeadingActual);
      }
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

// Heading Dial Interaction (Outer Ring)
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

depthSlider.addEventListener("input", () => {
  // depthLabel.textContent = `Depth: ${depthSlider.value} m`; // Removed old label update
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
    heading: currentHeadingOrder,
    speed: speedOrderToActual(currentSpeedOrder),
    depth: parseFloat(depthSlider.value),
  });
}

function speedOrderToActual(orderValue) {
  if (!SUB_MAX_SPEED_CLIENT) return 0;
  const clamped = Math.max(0, Math.min(orderValue, MAX_SPEED_ORDER_VALUE));
  const ratio = clamped / MAX_SPEED_ORDER_VALUE;
  return ratio * SUB_MAX_SPEED_CLIENT;
}

function actualSpeedToOrder(actualSpeed) {
  if (!SUB_MAX_SPEED_CLIENT) return 0;
  const clamped = Math.max(0, Math.min(actualSpeed, SUB_MAX_SPEED_CLIENT));
  const ratio = clamped / SUB_MAX_SPEED_CLIENT;
  return ratio * MAX_SPEED_ORDER_VALUE;
}

function normalizeHeading(value) {
  return ((value % 360) + 360) % 360;
}

function headingToCardinal(angle) {
  const directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return directions[Math.round(angle / 45) % 8];
}

// Update the Outer Ring (Commanded Heading)
function updateHeadingRing(angle) {
  const normalized = normalizeHeading(angle);
  // Rotate the ring so the marker points to the desired heading relative to "North" (Up)
  // If North is Up (0 deg), and we want to head East (90 deg), we rotate the ring -90 deg?
  // Or do we rotate the ring such that "East" is at the top?
  // Let's assume "North Up" display. The ring rotates.
  // If I want to go East (90), I turn the ring so 'E' is at the top? No, that's heading indicator.
  // If it's a "Set Heading" dial, usually you rotate a bug/marker to the heading.
  // My CSS has a marker at the top of the ring.
  // So if I rotate the ring, the marker rotates with it.
  // If I want heading 90, I rotate the ring 90 degrees clockwise.
  headingRing.style.transform = `rotate(${normalized}deg)`;
}

// Update the Inner Dial (Actual Heading)
function updateHeadingInner(angle) {
  const normalized = normalizeHeading(angle);
  // If the inner dial is a compass, it should rotate opposite to heading to keep North pointing North?
  // Or if it's a directional gyro, it shows the heading.
  // Let's make it show the heading by rotating it.
  // If heading is 90 (East), the needle should point East?
  // The CSS has a needle pointing UP.
  // So if we rotate the inner div 90 deg, the needle points Right (East).
  headingInner.style.transform = `rotate(${normalized}deg)`;
}

function updateActualsDisplay(you) {
  if (typeof you.heading === "number") {
    actualHeadingEl.textContent = Math.round(you.heading).toString().padStart(3, '0');
  }
  if (typeof you.speed === "number") {
    // Convert m/s to knots or just display raw? Game uses arbitrary units.
    // Let's assume 1 unit = 1 knot for simplicity or just show the value.
    actualSpeedEl.textContent = Math.round(you.speed).toString().padStart(2, '0');
  }
  if (typeof you.depth === "number") {
    actualDepthEl.textContent = Math.round(you.depth).toString().padStart(3, '0');
  }
}

function setHeadingOrder(angle) {
  currentHeadingOrder = normalizeHeading(angle);
  updateHeadingRing(currentHeadingOrder);
  sendControls();
}

function updateHeadingFromPointer(event) {
  const rect = headingDial.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const dx = event.clientX - cx;
  const dy = event.clientY - cy;
  const angle = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
  setHeadingOrder(angle);
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
    // We don't sync commanded heading from server for now, to avoid fighting user input
    // But we could if we wanted to restore state on reconnect.
    // For now, let's just sync speed order if it matches.
    if (typeof you.speed === "number") {
      syncSpeedFromServer(you.speed);
    }
    return;
  }
  const message = respawnMessage.textContent || "You were hit.";
  showRespawnPanel(you.respawn_at, message, you.respawn_ready);
}

function initializeSpeedTelegraph() {
  UI_SPEED_ORDERS.forEach((order) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "telegraph-order";
    button.textContent = order.label;
    button.dataset.speedValue = order.value;
    button.addEventListener("click", () => {
      setSpeedOrder(order.value);
    });
    speedTelegraph.appendChild(button);
    speedOrderButtons.push(button);
  });
  updateSpeedDisplay(currentSpeedOrder);
}

function setSpeedOrder(value) {
  if (currentSpeedOrder === value) return;
  currentSpeedOrder = value;
  updateSpeedDisplay(value);
  sendControls();
}

function syncSpeedFromServer(value) {
  const approxOrder = actualSpeedToOrder(value);
  const order = findClosestSpeedOrder(approxOrder);
  currentSpeedOrder = order.value;
  updateSpeedDisplay(order.value);
}

function findClosestSpeedOrder(value) {
  const target = typeof value === "number" ? value : 0;
  return UI_SPEED_ORDERS.reduce((closest, order) => {
    const diff = Math.abs(order.value - target);
    const bestDiff = Math.abs(closest.value - target);
    return diff < bestDiff ? order : closest;
  });
}

function updateSpeedDisplay(value) {
  const order = findClosestSpeedOrder(value);
  // const actualSpeed = speedOrderToActual(order.value); // Not used in label anymore
  // speedLabel.textContent = ... // Removed
  speedOrderButtons.forEach((btn) => {
    const btnValue = parseFloat(btn.dataset.speedValue);
    btn.classList.toggle("active", btnValue === order.value);
  });
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

  if (latestState.passive_contacts) {
    mapCtx.fillStyle = "rgba(255, 0, 0, 0.3)"; // Faint red for passive
    latestState.passive_contacts.forEach((contact) => {
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

    // Draw Submarine Shape
    mapCtx.fillStyle = "#00ff6a";

    // Body (Ellipse)
    mapCtx.beginPath();
    mapCtx.ellipse(0, 0, 15, 6, 0, 0, Math.PI * 2);
    mapCtx.fill();

    // Tower (Circle/Rect)
    mapCtx.fillStyle = "#00cc55";
    mapCtx.beginPath();
    mapCtx.arc(4, 0, 4, 0, Math.PI * 2); // Offset slightly forward
    mapCtx.fill();

    // Periscope/Direction indicator
    mapCtx.strokeStyle = "#00ff6a";
    mapCtx.lineWidth = 2;
    mapCtx.beginPath();
    mapCtx.moveTo(0, 0);
    mapCtx.lineTo(20, 0); // Line pointing forward
    mapCtx.stroke();

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

  const playerDepth = latestState?.you?.depth ?? null;
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

    if (typeof playerDepth === "number" && typeof blip.depth === "number") {
      const depthDiff = blip.depth - playerDepth;
      if (depthDiff < -DEPTH_ARROW_TOLERANCE) {
        drawDepthArrow(sonarCtx, x, y, -1, alpha);
      } else if (depthDiff > DEPTH_ARROW_TOLERANCE) {
        drawDepthArrow(sonarCtx, x, y, 1, alpha);
      }
    }
  });

  // Draw passive contacts
  if (latestState && latestState.passive_contacts) {
    latestState.passive_contacts.forEach((contact) => {
      const blipAngleRad = ((contact.bearing - 90) * Math.PI) / 180;
      const r = maxRadius * Math.min(contact.distance / SONAR_RANGE_CLIENT, 1.0); // Scale to active sonar range for display consistency? 
      // Or should it scale to passive range? 
      // If passive range > active range, and we scale to active, distant blips will be off screen.
      // But the sonar screen usually represents a fixed range.
      // Let's assume the sonar screen shows up to the MAX of both ranges, or just clamp to edge?
      // Actually, let's scale to SONAR_RANGE_CLIENT for now, so things outside active range are at the edge or off?
      // Wait, if passive range is 750 and active is 500, we want to see the 750 ones.
      // So the display radius should probably represent the larger range?
      // But `drawSonar` rings are just visual.
      // Let's stick to SONAR_RANGE_CLIENT for the "main" display scale, 
      // but if passive is further, maybe we should increase the display scale?
      // For now, let's just clamp them to the edge if they are far, or let them be drawn further out?
      // The canvas is cleared, so drawing outside maxRadius might be clipped or look weird if it goes over UI.
      // Let's scale based on PASSIVE_SONAR_RANGE_CLIENT if it's larger, or just stick to SONAR_RANGE_CLIENT and let them be far.
      // Let's use SONAR_RANGE_CLIENT as the reference for "1.0" radius.
      // If distance > SONAR_RANGE_CLIENT, it will be > maxRadius.
      // Let's clamp to maxRadius for now to keep it on screen, or maybe just let it go off?
      // Better: Draw them where they are relative to the center.

      const x = cx + Math.cos(blipAngleRad) * r;
      const y = cy + Math.sin(blipAngleRad) * r;

      // Only draw if within canvas bounds (roughly)
      if (r <= maxRadius + 10) {
        sonarCtx.fillStyle = `rgba(0, 255, 0, 0.2)`; // Faint green/ghostly
        sonarCtx.beginPath();
        sonarCtx.arc(x, y, 4, 0, Math.PI * 2);
        sonarCtx.fill();

        // Optional: Depth arrow for passive too?
        if (typeof playerDepth === "number" && typeof contact.depth === "number") {
          const depthDiff = contact.depth - playerDepth;
          if (depthDiff < -DEPTH_ARROW_TOLERANCE) {
            drawDepthArrow(sonarCtx, x, y, -1, 0.3);
          } else if (depthDiff > DEPTH_ARROW_TOLERANCE) {
            drawDepthArrow(sonarCtx, x, y, 1, 0.3);
          }
        }
      }
    });
  }
}

function drawDepthArrow(ctx, x, y, direction, alpha) {
  ctx.fillStyle = `rgba(255,255,255,${Math.max(0, Math.min(1, alpha + 0.2))})`;
  ctx.beginPath();
  if (direction < 0) {
    ctx.moveTo(x, y - 10);
    ctx.lineTo(x - 4, y - 2);
    ctx.lineTo(x + 4, y - 2);
  } else {
    ctx.moveTo(x, y + 10);
    ctx.lineTo(x - 4, y + 2);
    ctx.lineTo(x + 4, y + 2);
  }
  ctx.closePath();
  ctx.fill();
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
