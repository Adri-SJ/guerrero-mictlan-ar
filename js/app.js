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

const gestureState = {
  mouth: false,
  blink: false,
  brow: false,
  tracking: false
};

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

function buildMaskTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, 1024, 1024);

  const base = ctx.createRadialGradient(512, 470, 120, 512, 520, 600);
  base.addColorStop(0, "rgba(244,236,214,0.96)");
  base.addColorStop(0.68, "rgba(229,216,190,0.94)");
  base.addColorStop(1, "rgba(181,163,137,0.86)");
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
      ctx.fillStyle = i % 2 === 0 ? "rgba(236,121,24,0.98)" : "rgba(246,158,35,0.98)";
      ctx.beginPath();
      ctx.ellipse(0, -112, 26, 56, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.strokeStyle = "rgba(144,42,31,0.96)";
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

  ctx.fillStyle = "rgba(67,126,82,0.92)";
  [[420,340],[604,340],[270,610],[754,610]].forEach(([x,y])=>{
    ctx.beginPath();
    ctx.ellipse(x,y,15,34,0.6,0,Math.PI*2);
    ctx.fill();
  });

  ctx.fillStyle = "rgba(205,76,116,0.92)";
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
  gloss.addColorStop(0, "rgba(255,255,255,0.12)");
  gloss.addColorStop(0.5, "rgba(255,255,255,0.02)");
  gloss.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gloss;
  ctx.fillRect(100, 120, 824, 760);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
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
    $("mouth-state").textContent = "Boca abierta";
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

function animateBrow(active) {
  if (gestureState.brow === active) return;
  gestureState.brow = active;

  if (active) {
    playBrowSound();
    $("brow-state").textContent = "Cejas arriba";
  } else {
    $("brow-state").textContent = "Cejas";
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

  const leftBrowGap = dist2D(landmarks[105], landmarks[159]);
  const rightBrowGap = dist2D(landmarks[334], landmarks[386]);

  const leftBrowRatio = leftEyeWidth > 0 ? leftBrowGap / leftEyeWidth : 0;
  const rightBrowRatio = rightEyeWidth > 0 ? rightBrowGap / rightEyeWidth : 0;
  const browRatio = (leftBrowRatio + rightBrowRatio) / 2;

  animateMouth(mouthRatio > 0.18);
  animateBlink(leftEyeRatio < 0.17 && rightEyeRatio < 0.17);
  animateBrow(browRatio > 0.72);
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
    roughness: 0.42,
    metalness: 0.3,
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

  await mindarThree.start();

  renderer.setAnimationLoop((time) => {
    if (faceMeshAR) {
      const mat = faceMeshAR.material;

      if (gestureState.mouth) {
        mat.emissive.setHex(0x7a2d0c);
        mat.emissiveIntensity = 0.50;
      } else if (gestureState.blink) {
        mat.emissive.setHex(0xb35a12);
        mat.emissiveIntensity = 0.66;
      } else if (gestureState.brow) {
        mat.emissive.setHex(0x7d4f14);
        mat.emissiveIntensity = 0.54;
      } else {
        mat.emissive.setHex(0x24170d);
        mat.emissiveIntensity = 0.10;
      }
    }

    const flowerTarget = gestureState.brow ? 1.22 : 1;
    flowerGroup.scale.lerp(new THREE.Vector3(flowerTarget, flowerTarget, flowerTarget), 0.14);

    renderer.render(scene, camera);
  });

  startGestureLoop();
}

$("start-camera").addEventListener("click", startAR);
