const headingInput = document.getElementById('headingInput');
const headingInputValue = document.getElementById('headingInputValue');
const desiredHeadingLabel = document.getElementById('desiredHeadingLabel');
const actualHeadingLabel = document.getElementById('actualHeadingLabel');
const telemetryHeadingValue = document.getElementById('telemetryHeadingValue');
const desiredNeedle = document.getElementById('desiredNeedle');
const actualNeedle = document.getElementById('actualNeedle');
const depthValue = document.getElementById('depthValue');
const speedValue = document.getElementById('speedValue');
const mapHeadingLabel = document.getElementById('mapHeadingLabel');
const submarine = document.getElementById('submarine');
const tubeGrid = document.getElementById('tubeGrid');

const state = {
  desiredHeading: 0,
  actualHeading: 0,
  depth: 120,
  speed: 16,
  torpedoes: Array.from({ length: 4 }, (_, idx) => ({
    id: idx + 1,
    status: 'empty',
    progress: 0,
    timer: null
  }))
};

function normalizeHeading(value) {
  return ((value % 360) + 360) % 360;
}

function updateHeadingLabels() {
  headingInputValue.textContent = `${state.desiredHeading}°`;
  desiredHeadingLabel.textContent = `${state.desiredHeading}°`;
  actualHeadingLabel.textContent = `${state.actualHeading.toFixed(0)}°`;
  telemetryHeadingValue.textContent = `${state.actualHeading.toFixed(0)}°`;
  mapHeadingLabel.textContent = `${state.actualHeading.toFixed(0)}°`;
}

function updateNeedles() {
  desiredNeedle.style.transform = `translate(-50%, -100%) rotate(${state.desiredHeading}deg)`;
  actualNeedle.style.transform = `translate(-50%, -100%) rotate(${state.actualHeading}deg)`;
  const rotation = `translate(-50%, -50%) rotate(${state.actualHeading}deg)`;
  submarine.style.transform = `${rotation}`;
}

function gentlyAdjustActualHeading() {
  const diff = normalizeHeading(state.desiredHeading - state.actualHeading);
  const step = diff > 180 ? -1 : 1;
  const magnitude = diff > 180 ? 360 - diff : diff;
  const adjustment = Math.min(magnitude, 2) * step;
  state.actualHeading = normalizeHeading(state.actualHeading + adjustment * 0.5);
}

function updateTelemetry() {
  // Simulate small drift in depth and speed to keep UI lively
  state.depth = Math.max(30, state.depth + (Math.random() - 0.5) * 2);
  state.speed = Math.max(3, state.speed + (Math.random() - 0.5) * 0.4);
  depthValue.textContent = `${state.depth.toFixed(1)} m`;
  speedValue.textContent = `${state.speed.toFixed(1)} kts`;
}

function renderTubes() {
  tubeGrid.innerHTML = '';
  state.torpedoes.forEach(tube => {
    const card = document.createElement('div');
    card.className = 'tube-card';

    const header = document.createElement('div');
    header.className = 'tube-header';
    const title = document.createElement('h3');
    title.textContent = `Tube ${tube.id}`;

    const badge = document.createElement('span');
    badge.className = `badge ${tube.status}`;
    if (tube.status === 'loaded') badge.classList.add('ready');
    if (tube.status === 'loading') badge.classList.add('loading');
    badge.textContent = tube.status === 'loaded' ? 'Ready' : tube.status === 'loading' ? 'Loading' : 'Empty';

    header.appendChild(title);
    header.appendChild(badge);
    card.appendChild(header);

    const progressBar = document.createElement('div');
    progressBar.className = 'progress-bar';
    const fill = document.createElement('div');
    fill.className = 'progress-fill';
    fill.style.width = `${tube.progress}%`;
    progressBar.appendChild(fill);
    card.appendChild(progressBar);

    const controls = document.createElement('div');
    controls.className = 'controls';
    const loadBtn = document.createElement('button');
    loadBtn.textContent = tube.status === 'loading' ? 'Loading…' : 'Load';
    loadBtn.className = 'load';
    loadBtn.disabled = tube.status === 'loading' || tube.status === 'loaded';
    loadBtn.addEventListener('click', () => startLoading(tube.id));

    const fireBtn = document.createElement('button');
    fireBtn.textContent = 'Fire';
    fireBtn.className = 'fire';
    if (tube.status === 'loaded') fireBtn.classList.add('ready');
    fireBtn.disabled = tube.status !== 'loaded';
    fireBtn.addEventListener('click', () => fireTube(tube.id));

    controls.appendChild(loadBtn);
    controls.appendChild(fireBtn);
    card.appendChild(controls);

    tubeGrid.appendChild(card);
  });
}

function startLoading(id) {
  const tube = state.torpedoes.find(t => t.id === id);
  if (!tube || tube.status === 'loading' || tube.status === 'loaded') return;
  tube.status = 'loading';
  tube.progress = 0;
  renderTubes();

  const totalTime = 5000;
  const interval = 200;
  const steps = totalTime / interval;
  let currentStep = 0;

  tube.timer = setInterval(() => {
    currentStep += 1;
    tube.progress = Math.min(100, (currentStep / steps) * 100);
    if (currentStep >= steps) {
      clearInterval(tube.timer);
      tube.status = 'loaded';
      tube.timer = null;
      tube.progress = 100;
      renderTubes();
    } else {
      renderTubes();
    }
  }, interval);
}

function fireTube(id) {
  const tube = state.torpedoes.find(t => t.id === id);
  if (!tube || tube.status !== 'loaded') return;
  tube.status = 'empty';
  tube.progress = 0;
  renderTubes();
}

headingInput.addEventListener('input', (e) => {
  state.desiredHeading = normalizeHeading(Number(e.target.value));
  updateHeadingLabels();
  updateNeedles();
});

function loop() {
  gentlyAdjustActualHeading();
  updateTelemetry();
  updateHeadingLabels();
  updateNeedles();
  requestAnimationFrame(loop);
}

updateHeadingLabels();
renderTubes();
loop();
