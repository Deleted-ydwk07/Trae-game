const state = {
  running: false,
  globalTime: 180,
  tTime: 30,
  tRunning: false,
  speed: 0,
  steer: 0,
  yaw: 0,
  pos: new THREE.Vector3(0, 0.5, 0),
  score: 100,
  failReason: '',
  passed: { hill: false, t: false, accel: false, emerg: false },
  hillStopDetected: false,
  hillStartDeadline: 0,
  hillLastZ: 0,
  suddenActive: false,
  suddenWindow: 0,
  suddenTimer: 0,
  cameraMode: 'fp'
};

const canvas = document.getElementById('game');
const hudSpeed = document.getElementById('hud-speed');
const hudTimer = document.getElementById('hud-timer');
const hudSection = document.getElementById('hud-section');
const hudScore = document.getElementById('hud-score');
const overlay = document.getElementById('overlay');
const overlayText = document.getElementById('overlay-text');
const btnStart = document.getElementById('btn-start');
const btnRetry = document.getElementById('btn-retry');
const btnView = document.getElementById('btn-view');
const suddenIndicator = document.getElementById('sudden');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.shadowMap.enabled = true;
renderer.setPixelRatio(window.devicePixelRatio || 1);
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xbdd7ff);

const sky = new THREE.Mesh(
  new THREE.BoxGeometry(2000, 2000, 2000),
  new THREE.MeshBasicMaterial({ color: 0xbdd7ff, side: THREE.BackSide })
);
scene.add(sky);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 2000);
camera.position.set(0, 12, 24);

const hemi = new THREE.HemisphereLight(0xffffff, 0x445566, 1.0);
scene.add(hemi);

const dir = new THREE.DirectionalLight(0xffffff, 1.4);
dir.position.set(40, 80, 40);
dir.castShadow = true;
dir.shadow.mapSize.set(2048, 2048);
dir.shadow.camera.near = 1;
dir.shadow.camera.far = 200;
dir.shadow.camera.left = -80;
dir.shadow.camera.right = 80;
dir.shadow.camera.top = 80;
dir.shadow.camera.bottom = -80;
scene.add(dir);

const groundMat = new THREE.MeshPhongMaterial({ color: 0x24364a });
const ground = new THREE.Mesh(new THREE.PlaneGeometry(1000, 1000), groundMat);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const axes = new THREE.AxesHelper(5);
axes.position.set(0, 0.01, 0);
scene.add(axes);

const grid = new THREE.GridHelper(100, 20, 0x888888, 0x444444);
grid.position.y = 0.001;
scene.add(grid);

let carGroup = new THREE.Group();
let fallbackGroup = null;
let carReady = false;
let wheels = [];
let frontWheels = [];
let rearWheels = [];
const wheelBase = 2.2;
const maxSteerAngle = 0.25;
const wheelRadius = 0.35;
const steerSpeed = 3.0;

function createFallbackCar() {
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1.8, 0.8, 3.0),
    new THREE.MeshPhongMaterial({ color: 0x2dd36f })
  );
  body.castShadow = true;
  carGroup.add(body);

  const mkWheel = (x, z) => {
    const w = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35, 0.35, 0.3, 16),
      new THREE.MeshPhongMaterial({ color: 0x111111 })
    );
    w.rotation.z = Math.PI / 2;
    w.position.set(x, -0.3, z);
    w.castShadow = true;
    carGroup.add(w);
    wheels.push(w);
    if (z < 0) frontWheels.push(w); else rearWheels.push(w);
  };

  mkWheel(-0.8, -1.1);
  mkWheel(0.8, -1.1);
  mkWheel(-0.8, 1.1);
  mkWheel(0.8, 1.1);

  carGroup.position.copy(state.pos);
  carGroup.rotation.y = state.yaw;
  scene.add(carGroup);
  fallbackGroup = carGroup;
  carReady = true;
}

createFallbackCar();

if (THREE.GLTFLoader) {
  const gltfLoader = new THREE.GLTFLoader();
  gltfLoader.load(
    'assets/car.glb',
    g => {
      if (fallbackGroup) { scene.remove(fallbackGroup); fallbackGroup = null; wheels = []; frontWheels = []; rearWheels = []; }
      carGroup = g.scene;
      carGroup.traverse(o => {
        if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
        if (o.name && o.name.toLowerCase().includes('wheel')) {
          wheels.push(o);
          if (o.position && o.position.z < 0) frontWheels.push(o); else rearWheels.push(o);
        }
      });
      carGroup.position.copy(state.pos);
      carGroup.rotation.y = state.yaw;
      scene.add(carGroup);
      carReady = true;
    },
    () => {},
    err => {}
  );
}

const walls = [];
const triggers = {};
const course = { hill: { xMin: -3.5, xMax: 3.5, zStart: -40, zEnd: -70, angle: 12 * Math.PI / 180 }, t: {}, accel: {}, sudden: {} };

function addWallBox(x, y, z, w, h, d, color = 0x333333) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshPhongMaterial({ color }));
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  scene.add(m);
  walls.push(m);
  return m;
}

function buildCourse() {
  addWallBox(-5, 0.5, -10, 1, 1, 60);
  addWallBox(5, 0.5, -10, 1, 1, 60);
  addWallBox(0, 0.5, -40, 10, 1, 1);

  const ramp = new THREE.Mesh(new THREE.BoxGeometry(8, 0.6, 30), new THREE.MeshPhongMaterial({ color: 0x355a6a }));
  ramp.position.set(0, 0.3, -55);
  ramp.rotation.x = -course.hill.angle;
  ramp.receiveShadow = true;
  scene.add(ramp);

  const hillStop = new THREE.Mesh(new THREE.BoxGeometry(6, 0.1, 0.3), new THREE.MeshPhongMaterial({ color: 0xffffff }));
  hillStop.position.set(0, 0.8, -66);
  scene.add(hillStop);
  triggers.hillStopLine = new THREE.Box3().setFromObject(hillStop);
  triggers.hillZone = new THREE.Box3(new THREE.Vector3(course.hill.xMin, 0, course.hill.zEnd - 2), new THREE.Vector3(course.hill.xMax, 2, course.hill.zStart + 2));
}

buildCourse();
renderer.render(scene, camera);

function sampleHeight(x, z) {
  if (x >= course.hill.xMin && x <= course.hill.xMax && z <= course.hill.zStart && z >= course.hill.zEnd) {
    const p = (course.hill.zStart - z) / (course.hill.zStart - course.hill.zEnd);
    return 0.5 + Math.sin(course.hill.angle) * p * 2;
  }
  return 0.5;
}

function reset() {
  state.running = false;
  state.globalTime = 180;
  state.tTime = 30;
  state.tRunning = false;
  state.speed = 0;
  state.steer = 0;
  state.yaw = 0;
  state.pos.set(0, 0.5, 0);
  state.score = 100;
  state.failReason = '';
  state.passed.hill = false;
  state.passed.t = false;
  state.passed.accel = false;
  state.passed.emerg = false;
  state.hillStopDetected = false;
  state.hillStartDeadline = 0;
  state.hillLastZ = 0;
  state.suddenActive = false;
  state.suddenWindow = 0;
  state.suddenTimer = 0;
  overlay.classList.add('hidden');
  suddenIndicator.classList.remove('active');
  const fwd = new THREE.Vector3(Math.sin(state.yaw), 0, -Math.cos(state.yaw));
  let eye, look;
  if (state.cameraMode === 'fp') {
    eye = new THREE.Vector3().copy(state.pos).addScaledVector(fwd, 0.9);
    eye.y = state.pos.y + 1.1;
    look = new THREE.Vector3().copy(state.pos).addScaledVector(fwd, 10);
    look.y = state.pos.y + 1.0;
  } else {
    eye = new THREE.Vector3(state.pos.x - Math.sin(state.yaw) * 8, state.pos.y + 4, state.pos.z + Math.cos(state.yaw) * 8);
    look = new THREE.Vector3(state.pos.x, state.pos.y + 1.0, state.pos.z);
  }
  camera.position.copy(eye);
  camera.lookAt(look);
}

reset();

function fail(reason) {
  if (state.failReason) return;
  state.failReason = reason;
  state.running = false;
  overlayText.textContent = 'FAIL: ' + reason;
  overlay.classList.remove('hidden');
}

function passAllIfReady() {
  if (state.passed.hill && state.passed.t && state.passed.accel && state.passed.emerg && !state.failReason) {
    state.running = false;
    overlayText.textContent = 'PASS';
    overlay.classList.remove('hidden');
  }
}

const keys = { ArrowUp: false, ArrowDown: false, ArrowLeft: false, ArrowRight: false };
window.addEventListener('keydown', e => { if (e.code in keys) keys[e.code] = true; });
window.addEventListener('keyup', e => { if (e.code in keys) keys[e.code] = false; });

btnStart.addEventListener('click', () => { reset(); state.running = true; });
btnRetry.addEventListener('click', () => { reset(); state.running = true; });
btnView.addEventListener('click', () => { state.cameraMode = state.cameraMode === 'fp' ? 'tp' : 'fp'; });

let audioCtx = null;
function beep() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = 'square';
  o.frequency.value = 880;
  g.gain.value = 0.06;
  o.connect(g);
  g.connect(audioCtx.destination);
  o.start();
  setTimeout(() => { o.stop(); }, 200);
}

function update(dt) {
  hudSpeed.textContent = String(Math.round(Math.max(0, state.speed) * 10));
  hudTimer.textContent = String(Math.max(0, Math.floor(state.globalTime)));
  if (state.running) state.globalTime -= dt;
  if (state.globalTime <= 0 && !state.failReason) fail('Time Over');

  const steerTarget = (keys.ArrowLeft ? -1 : 0) + (keys.ArrowRight ? 1 : 0);
  state.steer += (steerTarget - state.steer) * Math.min(1, steerSpeed * dt);
  const steerAngle = state.steer * maxSteerAngle;

  const accel = keys.ArrowUp ? 0.18 : 0;
  const brake = keys.ArrowDown ? 0.22 : 0;
  const baseDrag = 0.010 + state.speed * state.speed * 0.00005;
  state.speed += accel - brake - baseDrag - Math.abs(steerAngle) * Math.max(0, state.speed) * 0.05;
  if (state.speed > 10.5) state.speed = 10.5;
  if (state.speed < -3) state.speed = -3;

  const speedPos = Math.max(0, state.speed);
  const steerEffect = 1 - Math.min(0.6, speedPos / 14);
  state.yaw += (speedPos / wheelBase) * Math.tan(steerAngle * steerEffect) * dt;

  const forward = new THREE.Vector3(Math.sin(state.yaw), 0, -Math.cos(state.yaw));
  if (state.running) state.pos.addScaledVector(forward, state.speed * dt);
  state.pos.y = sampleHeight(state.pos.x, state.pos.z);

  if (carReady) {
    carGroup.position.copy(state.pos);
    carGroup.rotation.y = state.yaw;
    carGroup.rotation.z = -state.steer * 0.08;
    frontWheels.forEach(w => { w.rotation.y = steerAngle; });
    const roll = (state.speed * dt) / wheelRadius;
    wheels.forEach(w => { w.rotation.x += roll; });
  }

  const carBox = new THREE.Box3().setFromObject(carGroup);
  for (let i = 0; i < walls.length; i++) {
    const wb = new THREE.Box3().setFromObject(walls[i]);
    if (carBox.intersectsBox(wb)) { fail('Collision'); break; }
  }

  const onHill = carBox.intersectsBox(triggers.hillZone);
  const onStopLine = carBox.intersectsBox(triggers.hillStopLine);
  if (!state.passed.hill) {
    if (onStopLine && Math.abs(state.speed) < 0.2 && !state.hillStopDetected) {
      state.hillStopDetected = true; state.hillStartDeadline = performance.now() + 5000; state.hillLastZ = state.pos.z;
    }
    if (state.hillStopDetected) {
      if (onHill) {
        if (state.pos.z - state.hillLastZ > 1.2) fail('Hill Backward');
        if (performance.now() > state.hillStartDeadline && !state.passed.hill) fail('Hill Start Timeout');
        if (Math.abs(state.speed) > 0.6) { state.passed.hill = true; }
      }
    }
  }

  hudSection.textContent =
    'Hill ' + (state.passed.hill ? 'Passed' : (state.hillStopDetected ? 'Waiting Start' : 'Ready'));
}

const clock = new THREE.Clock();
function animate() {
  const dt = Math.min(0.033, clock.getDelta());
  update(dt);
  const fwd2 = new THREE.Vector3(Math.sin(state.yaw), 0, -Math.cos(state.yaw));
  let eye2, look2, k;
  if (state.cameraMode === 'fp') {
    eye2 = new THREE.Vector3().copy(state.pos).addScaledVector(fwd2, 0.9);
    eye2.y = state.pos.y + 1.1;
    look2 = new THREE.Vector3().copy(state.pos).addScaledVector(fwd2, 10);
    look2.y = state.pos.y + 1.0;
    k = 0.3;
  } else {
    eye2 = new THREE.Vector3(state.pos.x - Math.sin(state.yaw) * 8, state.pos.y + 4, state.pos.z + Math.cos(state.yaw) * 8);
    look2 = new THREE.Vector3(state.pos.x, state.pos.y + 1.0, state.pos.z);
    k = 0.15;
  }
  camera.position.lerp(eye2, k);
  camera.lookAt(look2);
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
animate();

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});
