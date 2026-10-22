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

const gestureAudio = {
  mouth: new Audio("./assets/audio/boca.mp3"),
  blink: new Audio("./assets/audio/ojos.mp3"),
  brow: new Audio("./assets/audio/cejas.mp3")
};

gestureAudio.mouth.preload = "auto";
gestureAudio.blink.preload = "auto";
gestureAudio.brow.preload = "auto";

gestureAudio.mouth.volume = 0.78;
gestureAudio.blink.volume = 0.72;
gestureAudio.brow.volume = 0.76;

gestureAudio.mouth.playbackRate = 1.08;
gestureAudio.blink.playbackRate = 1.0;
gestureAudio.brow.playbackRate = 1.0;

function playGestureAudio(name) {
  const audio = gestureAudio[name];
  if (!audio) return false;

  try {
    audio.pause();
    audio.currentTime = 0;
    audio.play().catch(() => {});
    return true;
  } catch {
    return false;
  }
}

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
  if (playGestureAudio("mouth")) return;

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
  if (playGestureAudio("blink")) return;

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
  if (playGestureAudio("brow")) return;

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

  // Base: laca negra/rojo vino, más uniforme para que se lea como UNA máscara.
  const base = ctx.createRadialGradient(512, 470, 90, 512, 520, 570);
  base.addColorStop(0, "rgba(92,18,16,0.88)");
  base.addColorStop(0.48, "rgba(51,10,11,0.90)");
  base.addColorStop(1, "rgba(12,10,10,0.94)");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 1024, 1024);

  // Sombra perimetral para dar volumen sin usar geometría pesada.
  const edge = ctx.createRadialGradient(512, 500, 250, 512, 520, 590);
  edge.addColorStop(0, "rgba(0,0,0,0)");
  edge.addColorStop(0.72, "rgba(0,0,0,0.10)");
  edge.addColorStop(1, "rgba(0,0,0,0.68)");
  ctx.fillStyle = edge;
  ctx.fillRect(0, 0, 1024, 1024);

  // Frente tipo kabuto / ceja superior continua.
  ctx.fillStyle = "rgba(12,12,13,0.96)";
  ctx.beginPath();
  ctx.moveTo(170, 245);
  ctx.quadraticCurveTo(340, 175, 512, 235);
  ctx.quadraticCurveTo(684, 175, 854, 245);
  ctx.lineTo(810, 350);
  ctx.quadraticCurveTo(650, 305, 512, 335);
  ctx.quadraticCurveTo(374, 305, 214, 350);
  ctx.closePath();
  ctx.fill();

  // Lamas rojas bajo la frente.
  ctx.strokeStyle = "rgba(139,32,27,0.95)";
  ctx.lineWidth = 18;
  ctx.beginPath();
  ctx.moveTo(205, 340);
  ctx.quadraticCurveTo(360, 300, 470, 342);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(819, 340);
  ctx.quadraticCurveTo(664, 300, 554, 342);
  ctx.stroke();

  // Nariz / puente central tipo menpō.
  ctx.fillStyle = "rgba(20,20,21,0.98)";
  ctx.beginPath();
  ctx.moveTo(512, 355);
  ctx.lineTo(578, 535);
  ctx.lineTo(512, 610);
  ctx.lineTo(446, 535);
  ctx.closePath();
  ctx.fill();

  // Pómulos curvos.
  ctx.fillStyle = "rgba(43,12,13,0.97)";
  ctx.beginPath();
  ctx.moveTo(165, 500);
  ctx.quadraticCurveTo(280, 455, 435, 520);
  ctx.lineTo(395, 700);
  ctx.quadraticCurveTo(285, 725, 175, 645);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(859, 500);
  ctx.quadraticCurveTo(744, 455, 589, 520);
  ctx.lineTo(629, 700);
  ctx.quadraticCurveTo(739, 725, 849, 645);
  ctx.closePath();
  ctx.fill();

  // Mandíbula amplia y unificada.
  ctx.fillStyle = "rgba(13,13,14,0.98)";
  ctx.beginPath();
  ctx.moveTo(230, 680);
  ctx.quadraticCurveTo(340, 755, 512, 742);
  ctx.quadraticCurveTo(684, 755, 794, 680);
  ctx.lineTo(742, 865);
  ctx.quadraticCurveTo(630, 955, 512, 970);
  ctx.quadraticCurveTo(394, 955, 282, 865);
  ctx.closePath();
  ctx.fill();

  // "Boca" estilizada del menpō.
  ctx.fillStyle = "rgba(118,28,24,0.95)";
  ctx.beginPath();
  ctx.moveTo(365, 760);
  ctx.quadraticCurveTo(512, 815, 659, 760);
  ctx.lineTo(635, 815);
  ctx.quadraticCurveTo(512, 855, 389, 815);
  ctx.closePath();
  ctx.fill();

  // Colmillos / dientes.
  ctx.fillStyle = "rgba(219,204,167,0.96)";
  [[415, 787],[470, 803],[554, 803],[609, 787]].forEach(([x,y], i) => {
    ctx.beginPath();
    const dir = (i < 2) ? 1 : -1;
    ctx.moveTo(x, y);
    ctx.lineTo(x + 20 * dir, y + 56);
    ctx.lineTo(x - 17 * dir, y + 12);
    ctx.closePath();
    ctx.fill();
  });

  // Filetes dorados laterales.
  ctx.strokeStyle = "rgba(202,162,83,0.95)";
  ctx.lineWidth = 12;

  ctx.beginPath();
  ctx.moveTo(188, 475);
  ctx.quadraticCurveTo(155, 590, 190, 705);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(836, 475);
  ctx.quadraticCurveTo(869, 590, 834, 705);
  ctx.stroke();

  // Emblema frontal.
  ctx.strokeStyle = "rgba(205,166,88,0.98)";
  ctx.lineWidth = 24;
  ctx.beginPath();
  ctx.arc(512, 235, 64, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = "rgba(205,166,88,0.98)";
  ctx.beginPath();
  ctx.moveTo(512, 120);
  ctx.lineTo(452, 240);
  ctx.lineTo(572, 240);
  ctx.closePath();
  ctx.fill();

  // Marcas diagonales tipo armadura.
  ctx.strokeStyle = "rgba(176,49,39,0.55)";
  ctx.lineWidth = 9;
  [
    [235, 575, 330, 540],
    [250, 620, 345, 585],
    [789, 575, 694, 540],
    [774, 620, 679, 585]
  ].forEach(([x1, y1, x2, y2]) => {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  });

  // OJOS: perforaciones reales para que se vean los ojos del usuario.
  ctx.save();
  ctx.globalCompositeOperation = "destination-out";

  ctx.beginPath();
  ctx.ellipse(350, 445, 118, 66, -0.12, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.ellipse(674, 445, 118, 66, 0.12, 0, Math.PI * 2);
  ctx.fill();

  // Pequeña abertura central de boca para que la animación sea más natural.
  ctx.beginPath();
  ctx.ellipse(512, 786, 118, 28, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();

  // Bordes rojos alrededor de los ojos después del recorte.
  ctx.strokeStyle = "rgba(187,43,34,0.98)";
  ctx.lineWidth = 28;

  ctx.beginPath();
  ctx.ellipse(350, 445, 128, 76, -0.12, 0, Math.PI * 2);
  ctx.stroke();

  ctx.beginPath();
  ctx.ellipse(674, 445, 128, 76, 0.12, 0, Math.PI * 2);
  ctx.stroke();

  // Highlight sutil para dar acabado lacado.
  const gloss = ctx.createLinearGradient(0, 150, 0, 820);
  gloss.addColorStop(0, "rgba(255,255,255,0.10)");
  gloss.addColorStop(0.45, "rgba(255,255,255,0.015)");
  gloss.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gloss;
  ctx.fillRect(120, 130, 784, 760);

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

  Object.values(gestureAudio).forEach((audio) => {
    audio.load();
  });

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

  // Kabuto simple para completar la silueta samurái.
  const foreheadAnchor = mindarThree.addAnchor(10);

  const kabutoGroup = new THREE.Group();
  kabutoGroup.position.set(0, 0.13, 0.01);

  const blackMetal = new THREE.MeshStandardMaterial({
    color: 0x151515,
    metalness: 0.82,
    roughness: 0.28,
    emissive: 0x100505,
    emissiveIntensity: 0.10
  });

  const redLacquer = new THREE.MeshStandardMaterial({
    color: 0x5a1113,
    metalness: 0.58,
    roughness: 0.34,
    emissive: 0x1c0506,
    emissiveIntensity: 0.08
  });

  const goldMetal = new THREE.MeshStandardMaterial({
    color: 0xc8a35b,
    metalness: 0.92,
    roughness: 0.18,
    emissive: 0x3a2608,
    emissiveIntensity: 0.32,
    side: THREE.DoubleSide
  });

  // Cúpula principal.
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(0.23, 32, 24),
    blackMetal
  );
  dome.scale.set(1.55, 0.92, 1.18);
  dome.position.set(0, 0.10, -0.09);
  kabutoGroup.add(dome);

  // Visera frontal.
  const brim = new THREE.Mesh(
    new THREE.BoxGeometry(0.70, 0.065, 0.095),
    redLacquer
  );
  brim.position.set(0, -0.02, 0.05);
  kabutoGroup.add(brim);

  // Protectores laterales.
  const sideGeometry = new THREE.BoxGeometry(0.11, 0.27, 0.06);

  const sideLeft = new THREE.Mesh(sideGeometry, redLacquer);
  sideLeft.position.set(-0.31, -0.045, 0.01);
  sideLeft.rotation.z = 0.24;
  kabutoGroup.add(sideLeft);

  const sideRight = new THREE.Mesh(sideGeometry, redLacquer);
  sideRight.position.set(0.31, -0.045, 0.01);
  sideRight.rotation.z = -0.24;
  kabutoGroup.add(sideRight);

  // Maedate frontal.
  const crestRing = new THREE.Mesh(
    new THREE.RingGeometry(0.045, 0.062, 32),
    goldMetal
  );
  crestRing.position.set(0, 0.12, 0.165);
  kabutoGroup.add(crestRing);

  const crestShape = new THREE.Shape();
  crestShape.moveTo(0, 0.085);
  crestShape.lineTo(-0.042, 0);
  crestShape.lineTo(0.042, 0);
  crestShape.closePath();

  const crestTip = new THREE.Mesh(
    new THREE.ShapeGeometry(crestShape),
    goldMetal
  );
  crestTip.position.set(0, 0.19, 0.166);
  kabutoGroup.add(crestTip);

  // Cuernos sencillos para dar la silueta típica samurái.
  const hornGeometry = new THREE.ConeGeometry(0.022, 0.22, 16);

  const hornLeft = new THREE.Mesh(hornGeometry, goldMetal);
  hornLeft.position.set(-0.15, 0.31, 0.04);
  hornLeft.rotation.z = 0.48;
  kabutoGroup.add(hornLeft);

  const hornRight = new THREE.Mesh(hornGeometry, goldMetal);
  hornRight.position.set(0.15, 0.31, 0.04);
  hornRight.rotation.z = -0.48;
  kabutoGroup.add(hornRight);

  foreheadAnchor.group.add(kabutoGroup);

  await mindarThree.start();

  renderer.setAnimationLoop((time) => {
    if (faceMeshAR) {
      const mat = faceMeshAR.material;

      if (gestureState.mouth) {
        mat.emissive.setHex(0x381006);
        mat.emissiveIntensity = 0.58;
      } else if (gestureState.blink) {
        mat.emissive.setHex(0x5a0505);
        mat.emissiveIntensity = 0.85;
      } else if (gestureState.brow) {
        mat.emissive.setHex(0x3a2608);
        mat.emissiveIntensity = 0.7;
      } else {
        mat.emissive.setHex(0x170606);
        mat.emissiveIntensity = 0.18;
      }
    }

    crestRing.rotation.z += 0.006;

    if (gestureState.brow) {
      crestRing.scale.lerp(new THREE.Vector3(1.18, 1.18, 1.18), 0.18);
      crestTip.scale.lerp(new THREE.Vector3(1.18, 1.18, 1.18), 0.18);
    } else {
      crestRing.scale.lerp(new THREE.Vector3(1, 1, 1), 0.18);
      crestTip.scale.lerp(new THREE.Vector3(1, 1, 1), 0.18);
    }

    renderer.render(scene, camera);
  });

  startGestureLoop();
}

$("start-camera").addEventListener("click", startAR);
