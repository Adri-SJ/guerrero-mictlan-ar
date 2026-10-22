import * as THREE from "three";
import { MindARThree } from "mindar-face-three";

const $ = (id) => document.getElementById(id);

let mindarThree = null;
let faceMeshAR = null;
let faceMeshDetector = null;
let gestureLoopStarted = false;
let processingFace = false;
let lastFaceProcess = 0;
let audioCtx = null;

const backgroundMusic = new Audio("./assets/audio/musicafondo.mp3");
backgroundMusic.loop = true;
backgroundMusic.preload = "auto";
backgroundMusic.volume = 0.16;

const blinkAudio = new Audio("./assets/audio/ojos-calavera.mp3");
blinkAudio.preload = "auto";
blinkAudio.volume = 0.82;

function playBlinkFile() {
  try {
    blinkAudio.pause();
    blinkAudio.currentTime = 0;
    blinkAudio.play().catch(() => {});
  } catch {}
}

let petalBurstRequested = false;
let petalGroup = null;
const activePetals = [];

const gestureState = {
  mouth: false,
  blink: false,
  tracking: false
};

let selectedMask = "floral";

function ensureAudio() {
  if (!audioCtx) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    audioCtx = new AudioCtx();
  }

  if (audioCtx.state === "suspended") {
    audioCtx.resume().catch(() => {});
  }

  return audioCtx;
}

function tone(freq, duration = 0.08, type = "sine", volume = 0.03, endFreq = null, delay = 0) {
  const ctx = ensureAudio();
  if (!ctx) return;

  const startAt = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(freq, startAt);

  if (endFreq) {
    osc.frequency.exponentialRampToValueAtTime(
      Math.max(1, endFreq),
      startAt + duration
    );
  }

  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(volume, startAt + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(startAt);
  osc.stop(startAt + duration + 0.02);
}

function noiseBurst({
  duration = 0.12,
  volume = 0.03,
  highpass = 400,
  lowpass = 6000,
  delay = 0
} = {}) {
  const ctx = ensureAudio();
  if (!ctx) return;

  const startAt = ctx.currentTime + delay;
  const length = Math.max(1, Math.floor(ctx.sampleRate * duration));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);

  for (let i = 0; i < length; i++) {
    const decay = 1 - i / length;
    data[i] = (Math.random() * 2 - 1) * decay;
  }

  const source = ctx.createBufferSource();
  source.buffer = buffer;

  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = highpass;

  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = lowpass;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(volume, startAt);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

  source.connect(hp);
  hp.connect(lp);
  lp.connect(gain);
  gain.connect(ctx.destination);

  source.start(startAt);
  source.stop(startAt + duration + 0.02);
}

function playMouthSound() {
  // Fallback sintetizado si el archivo no está disponible.
  // Golpe mecánico + resonancia grave, como una máscara de metal abriéndose.
  noiseBurst({
    duration: 0.16,
    volume: 0.035,
    highpass: 700,
    lowpass: 4200
  });

  tone(150, 0.18, "triangle", 0.04, 82);
  tone(310, 0.08, "square", 0.018, 205, 0.015);
  tone(78, 0.20, "sine", 0.035, 54, 0.025);

  // Pequeño cierre metálico secundario.
  noiseBurst({
    duration: 0.08,
    volume: 0.018,
    highpass: 1800,
    lowpass: 7000,
    delay: 0.09
  });
}

function playBlinkSound() {
  playBlinkFile();
  return;

  // Fallback sintetizado si el archivo no está disponible.
  // Flash energético corto, más limpio que un beep simple.
  tone(760, 0.055, "sine", 0.022, 1280);
  tone(1520, 0.035, "sine", 0.013, 980, 0.018);

  noiseBurst({
    duration: 0.045,
    volume: 0.012,
    highpass: 3200,
    lowpass: 9000
  });
}

function playBrowSound() {
  // Fallback sintetizado si el archivo no está disponible.
  // Whoosh ascendente + brillo ceremonial.
  noiseBurst({
    duration: 0.22,
    volume: 0.022,
    highpass: 500,
    lowpass: 4200
  });

  tone(260, 0.18, "triangle", 0.025, 620);
  tone(520, 0.16, "sine", 0.018, 980, 0.035);
  tone(1040, 0.11, "sine", 0.010, 1460, 0.07);
}
function dist2D(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

function buildMaskTextureFloral() {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, 1024, 1024);

  const base = ctx.createRadialGradient(512, 470, 120, 512, 520, 600);
  base.addColorStop(0, "rgba(255,250,235,0.98)");
  base.addColorStop(0.68, "rgba(246,232,200,0.97)");
  base.addColorStop(1, "rgba(205,181,141,0.91)");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 1024, 1024);

  const edge = ctx.createRadialGradient(512, 500, 280, 512, 520, 620);
  edge.addColorStop(0, "rgba(0,0,0,0)");
  edge.addColorStop(0.78, "rgba(56,39,26,0.05)");
  edge.addColorStop(1, "rgba(40,26,17,0.22)");
  ctx.fillStyle = edge;
  ctx.fillRect(0, 0, 1024, 1024);

  ctx.fillStyle = "rgba(20,18,18,0.96)";
  ctx.beginPath();
  ctx.ellipse(350, 445, 128, 83, -0.10, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(674, 445, 128, 83, 0.10, 0, Math.PI * 2);
  ctx.fill();

  function flowerEye(cx, cy, rotation = 0) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rotation);
    for (let i = 0; i < 12; i++) {
      ctx.save();
      ctx.rotate((Math.PI * 2 * i) / 12);
      ctx.fillStyle = i % 2 === 0 ? "rgba(255,116,20,1)" : "rgba(255,184,38,1)";
      ctx.beginPath();
      ctx.ellipse(0, -112, 26, 56, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.strokeStyle = "rgba(183,39,37,1)";
    ctx.lineWidth = 22;
    ctx.beginPath();
    ctx.ellipse(0, 0, 128, 82, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  flowerEye(350, 445, -0.10);
  flowerEye(674, 445, 0.10);

  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  ctx.beginPath();
  ctx.ellipse(350, 445, 92, 50, -0.10, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(674, 445, 92, 50, 0.10, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = "rgba(23,21,21,0.98)";
  ctx.beginPath();
  ctx.moveTo(512, 545);
  ctx.quadraticCurveTo(465, 595, 488, 650);
  ctx.lineTo(512, 625);
  ctx.lineTo(536, 650);
  ctx.quadraticCurveTo(559, 595, 512, 545);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "rgba(75,63,49,0.92)";
  ctx.lineWidth = 12;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(512, 210);
  ctx.quadraticCurveTo(430, 250, 455, 320);
  ctx.quadraticCurveTo(486, 360, 512, 320);
  ctx.quadraticCurveTo(538, 360, 569, 320);
  ctx.quadraticCurveTo(594, 250, 512, 210);
  ctx.stroke();

  ctx.fillStyle = "rgba(212,83,63,0.96)";
  ctx.beginPath();
  ctx.moveTo(512, 242);
  ctx.quadraticCurveTo(477, 290, 512, 330);
  ctx.quadraticCurveTo(547, 290, 512, 242);
  ctx.fill();

  ctx.fillStyle = "rgba(67,166,92,0.98)";
  [[420,340],[604,340],[270,610],[754,610]].forEach(([x,y])=>{
    ctx.beginPath();
    ctx.ellipse(x,y,15,34,0.6,0,Math.PI*2);
    ctx.fill();
  });

  ctx.fillStyle = "rgba(234,64,130,0.98)";
  [[455,365],[569,365],[315,665],[709,665]].forEach(([x,y])=>{
    ctx.beginPath();
    ctx.arc(x,y,15,0,Math.PI*2);
    ctx.fill();
  });

  ctx.strokeStyle = "rgba(38,34,32,0.96)";
  ctx.lineWidth = 12;
  ctx.beginPath();
  ctx.moveTo(340, 748);
  ctx.quadraticCurveTo(512, 805, 684, 748);
  ctx.stroke();

  ctx.lineWidth = 9;
  [392,432,472,512,552,592,632].forEach((x) => {
    ctx.beginPath();
    ctx.moveTo(x, 735);
    ctx.lineTo(x, 805);
    ctx.stroke();
  });

  const gloss = ctx.createLinearGradient(0, 120, 0, 880);
  gloss.addColorStop(0, "rgba(255,255,255,0.24)");
  gloss.addColorStop(0.45, "rgba(255,255,255,0.05)");
  gloss.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gloss;
  ctx.fillRect(100, 120, 824, 760);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}
function buildMaskTextureRitual() {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 1024;

  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, 1024, 1024);

  // Base hueso más fría y sobria.
  const base = ctx.createRadialGradient(512, 470, 120, 512, 520, 610);
  base.addColorStop(0, "rgba(238,231,213,0.98)");
  base.addColorStop(0.70, "rgba(211,200,177,0.97)");
  base.addColorStop(1, "rgba(151,139,121,0.94)");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 1024, 1024);

  // Sombras laterales.
  const edge = ctx.createRadialGradient(512, 500, 280, 512, 520, 640);
  edge.addColorStop(0, "rgba(0,0,0,0)");
  edge.addColorStop(0.72, "rgba(20,15,12,0.05)");
  edge.addColorStop(1, "rgba(12,9,8,0.34)");
  ctx.fillStyle = edge;
  ctx.fillRect(0, 0, 1024, 1024);

  // Ojos más duros y geométricos.
  ctx.fillStyle = "rgba(14,14,15,0.98)";
  ctx.beginPath();
  ctx.ellipse(350, 445, 132, 84, -0.12, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(674, 445, 132, 84, 0.12, 0, Math.PI * 2);
  ctx.fill();

  // Aros rituales naranjas/rojos.
  ctx.strokeStyle = "rgba(224,92,25,1)";
  ctx.lineWidth = 34;
  ctx.beginPath();
  ctx.ellipse(350, 445, 134, 86, -0.12, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(674, 445, 134, 86, 0.12, 0, Math.PI * 2);
  ctx.stroke();

  // Recortes de ojos.
  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  ctx.beginPath();
  ctx.ellipse(350, 445, 92, 50, -0.12, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(674, 445, 92, 50, 0.12, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Nariz negra.
  ctx.fillStyle = "rgba(18,17,17,0.98)";
  ctx.beginPath();
  ctx.moveTo(512, 545);
  ctx.quadraticCurveTo(468, 595, 489, 651);
  ctx.lineTo(512, 626);
  ctx.lineTo(535, 651);
  ctx.quadraticCurveTo(556, 595, 512, 545);
  ctx.closePath();
  ctx.fill();

  // Frente con símbolo fuerte.
  ctx.strokeStyle = "rgba(55,47,39,0.96)";
  ctx.lineWidth = 14;
  ctx.beginPath();
  ctx.moveTo(512, 215);
  ctx.lineTo(445, 315);
  ctx.lineTo(512, 350);
  ctx.lineTo(579, 315);
  ctx.closePath();
  ctx.stroke();

  ctx.fillStyle = "rgba(223,89,27,0.98)";
  ctx.beginPath();
  ctx.arc(512, 286, 29, 0, Math.PI * 2);
  ctx.fill();

  // Marcas laterales más masculinas/neutras.
  ctx.strokeStyle = "rgba(48,41,36,0.92)";
  ctx.lineWidth = 13;
  [[220,575,330,625],[804,575,694,625],[250,660,365,700],[774,660,659,700]].forEach(([x1,y1,x2,y2])=>{
    ctx.beginPath();
    ctx.moveTo(x1,y1);
    ctx.lineTo(x2,y2);
    ctx.stroke();
  });

  // Boca más sobria.
  ctx.strokeStyle = "rgba(29,27,26,0.98)";
  ctx.lineWidth = 14;
  ctx.beginPath();
  ctx.moveTo(340, 748);
  ctx.quadraticCurveTo(512, 805, 684, 748);
  ctx.stroke();

  ctx.lineWidth = 10;
  [390,430,470,512,554,594,634].forEach((x)=>{
    ctx.beginPath();
    ctx.moveTo(x, 735);
    ctx.lineTo(x, 810);
    ctx.stroke();
  });

  // Grietas naranja/fuego.
  ctx.strokeStyle = "rgba(236,104,28,0.78)";
  ctx.lineWidth = 8;
  [
    [300,305,345,360],
    [724,305,679,360],
    [285,720,340,760],
    [739,720,684,760]
  ].forEach(([x1,y1,x2,y2])=>{
    ctx.beginPath();
    ctx.moveTo(x1,y1);
    ctx.lineTo(x2,y2);
    ctx.stroke();
  });

  // Brillo más seco que la floral.
  const gloss = ctx.createLinearGradient(0, 120, 0, 880);
  gloss.addColorStop(0, "rgba(255,255,255,0.15)");
  gloss.addColorStop(0.5, "rgba(255,255,255,0.025)");
  gloss.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gloss;
  ctx.fillRect(100, 120, 824, 760);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function buildMaskTexture() {
  return selectedMask === "ritual"
    ? buildMaskTextureRitual()
    : buildMaskTextureFloral();
}

function setTracking(active) {
  if (gestureState.tracking === active) return;
  gestureState.tracking = active;

  document.body.classList.toggle("tracking", active);
  $("tracking-state").textContent = active ? "Rostro detectado" : "Buscando rostro…";
}

function animateMouth(active) {
  if (gestureState.mouth === active) return;
  gestureState.mouth = active;

  if (active) {
    playMouthSound();
    $("mouth-state").textContent = "Lluvia de pétalos";
    petalBurstRequested = true;
  } else {
    $("mouth-state").textContent = "Boca";
  }
}
function animateBlink(active) {
  if (gestureState.blink === active) return;
  gestureState.blink = active;

  if (active) {
    playBlinkSound();
    $("blink-state").textContent = "Parpadeo";
  } else {
    $("blink-state").textContent = "Ojos";
  }
}

function evaluateGestures(landmarks) {
  if (!landmarks || landmarks.length < 468) {
    setTracking(false);
    return;
  }

  setTracking(true);

  const mouthOpen = dist2D(landmarks[13], landmarks[14]);
  const mouthWidth = dist2D(landmarks[78], landmarks[308]);
  const mouthRatio = mouthWidth > 0 ? mouthOpen / mouthWidth : 0;

  const leftEyeOpen = dist2D(landmarks[159], landmarks[145]);
  const leftEyeWidth = dist2D(landmarks[33], landmarks[133]);
  const rightEyeOpen = dist2D(landmarks[386], landmarks[374]);
  const rightEyeWidth = dist2D(landmarks[362], landmarks[263]);

  const leftEyeRatio = leftEyeWidth > 0 ? leftEyeOpen / leftEyeWidth : 1;
  const rightEyeRatio = rightEyeWidth > 0 ? rightEyeOpen / rightEyeWidth : 1;

  animateMouth(mouthRatio > 0.18);
  animateBlink(leftEyeRatio < 0.17 && rightEyeRatio < 0.17);
}

function createPetalMesh() {
  const geometry = new THREE.CircleGeometry(0.024, 16);
  const material = new THREE.MeshStandardMaterial({
    color: Math.random() > 0.5 ? 0xff8d1f : 0xffbd35,
    emissive: 0x5a2208,
    emissiveIntensity: 0.18,
    roughness: 0.72,
    transparent: true,
    opacity: 1,
    side: THREE.DoubleSide,
    depthWrite: false,
    depthTest: false
  });

  const petal = new THREE.Mesh(geometry, material);
  petal.renderOrder = 20;
  petal.scale.set(0.95, 1.6, 1);
  return petal;
}

function triggerPetalBurst() {
  if (!petalGroup) return;

  for (let i = 0; i < 40; i++) {
    const petal = createPetalMesh();

    petal.position.set(
      (Math.random() - 0.5) * 0.42,
      -0.02 + Math.random() * 0.10,
      0.035 + Math.random() * 0.025
    );

    petal.rotation.z = Math.random() * Math.PI * 2;
    petal.rotation.x = (Math.random() - 0.5) * 0.5;

    petal.userData = {
      vx: (Math.random() - 0.5) * 0.010,
      vy: 0.010 + Math.random() * 0.012,
      vz: (Math.random() - 0.5) * 0.0015,
      spin: (Math.random() - 0.5) * 0.18,
      life: 1
    };

    petalGroup.add(petal);
    activePetals.push(petal);
  }
}

function updatePetals() {
  for (let i = activePetals.length - 1; i >= 0; i--) {
    const petal = activePetals[i];
    const d = petal.userData;

    petal.position.x += d.vx;
    petal.position.y += d.vy;
    petal.position.z += d.vz;

    d.vy -= 0.00048;

    petal.rotation.z += d.spin;
    petal.rotation.x += d.spin * 0.35;

    d.life -= 0.016;
    petal.material.opacity = Math.max(d.life, 0);

    if (d.life <= 0 || petal.position.y < -0.65) {
      petalGroup.remove(petal);
      petal.geometry.dispose();
      petal.material.dispose();
      activePetals.splice(i, 1);
    }
  }
}

function initGestureDetection() {
  if (!window.FaceMesh || faceMeshDetector) return;

  faceMeshDetector = new FaceMesh({
    locateFile: (file) =>
      `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
  });

  faceMeshDetector.setOptions({
    maxNumFaces: 1,
    refineLandmarks: true,
    minDetectionConfidence: 0.55,
    minTrackingConfidence: 0.55
  });

  faceMeshDetector.onResults((results) => {
    evaluateGestures(results.multiFaceLandmarks?.[0]);
  });
}

function startGestureLoop() {
  if (gestureLoopStarted) return;
  gestureLoopStarted = true;

  initGestureDetection();

  const tick = async (time) => {
    const video = document.querySelector("video");

    if (
      faceMeshDetector &&
      video &&
      video.readyState >= 2 &&
      !processingFace &&
      time - lastFaceProcess > 95
    ) {
      processingFace = true;
      lastFaceProcess = time;

      try {
        await faceMeshDetector.send({ image: video });
      } catch (err) {
        console.warn("No se pudo procesar gesto facial:", err);
      } finally {
        processingFace = false;
      }
    }

    requestAnimationFrame(tick);
  };

  requestAnimationFrame(tick);
}

async function startAR() {
  if (mindarThree) return;

  ensureAudio();

  backgroundMusic.load();
  blinkAudio.load();

  backgroundMusic.currentTime = 0;
  backgroundMusic.play().catch(() => {});

  $("intro").classList.add("hidden");
  $("ar-shell").classList.remove("hidden");

  mindarThree = new MindARThree({
    container: $("scene-root")
  });

  const { renderer, scene, camera } = mindarThree;

  scene.add(new THREE.HemisphereLight(0xffffff, 0x3a2020, 1.35));

  const key = new THREE.DirectionalLight(0xffffff, 1.0);
  key.position.set(0.5, 1, 1.5);
  scene.add(key);

  // FaceMesh real: esta geometría se deforma con toda la cara.
  faceMeshAR = mindarThree.addFaceMesh();

  faceMeshAR.material = new THREE.MeshStandardMaterial({
    map: buildMaskTexture(),
    transparent: true,
    opacity: 0.93,
    roughness: 0.25,
    metalness: 0.08,
    side: THREE.DoubleSide,
    emissive: new THREE.Color(0x170606),
    emissiveIntensity: 0.18,
    depthWrite: false
  });

  scene.add(faceMeshAR);

  const foreheadAnchor = mindarThree.addAnchor(10);
  const flowerGroup = new THREE.Group();
  flowerGroup.position.set(0, 0.13, 0.10);

  const petalMat = new THREE.MeshStandardMaterial({
    color: 0xf09a22,
    emissive: 0x6b2d06,
    emissiveIntensity: 0.22,
    roughness: 0.65,
    side: THREE.DoubleSide
  });

  for (let i = 0; i < 10; i++) {
    const petal = new THREE.Mesh(new THREE.CircleGeometry(0.035, 20), petalMat);
    const a = (Math.PI * 2 * i) / 10;
    petal.position.set(Math.cos(a) * 0.07, Math.sin(a) * 0.07, 0);
    petal.scale.set(1.0, 1.55, 1);
    petal.rotation.z = a + Math.PI / 2;
    flowerGroup.add(petal);
  }

  const flowerCenter = new THREE.Mesh(
    new THREE.CircleGeometry(0.035, 24),
    new THREE.MeshStandardMaterial({
      color: 0x8d2e24,
      emissive: 0x4a120e,
      emissiveIntensity: 0.18,
      roughness: 0.55,
      side: THREE.DoubleSide
    })
  );
  flowerCenter.position.z = 0.005;
  flowerGroup.add(flowerCenter);
  foreheadAnchor.group.add(flowerGroup);

  const petalAnchor = mindarThree.addAnchor(13);
  petalGroup = new THREE.Group();
  petalGroup.position.set(0, -0.03, 0.08);
  petalAnchor.group.add(petalGroup);

  await mindarThree.start();

  renderer.setAnimationLoop((time) => {
    if (faceMeshAR) {
      const mat = faceMeshAR.material;

      if (gestureState.blink) {
        mat.emissive.setHex(0xb35a12);
        mat.emissiveIntensity = 0.66;
      } else {
        mat.emissive.setHex(0x24170d);
        mat.emissiveIntensity = 0.10;
      }
    }

    if (petalBurstRequested) {
      triggerPetalBurst();
      petalBurstRequested = false;
    }

    updatePetals();

    renderer.render(scene, camera);
  });

  startGestureLoop();
}

document.querySelectorAll(".mask-option").forEach((button) => {
  button.addEventListener("click", () => {
    selectedMask = button.dataset.mask || "floral";

    document.querySelectorAll(".mask-option").forEach((item) => {
      item.classList.toggle("active", item === button);
    });
  });
});

$("start-camera").addEventListener("click", startAR);
