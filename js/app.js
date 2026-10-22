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

const gestureState = { mouth:false, blink:false, brow:false, tracking:false };

function ensureAudio(){
  if(!audioCtx){
    const Ctx=window.AudioContext||window.webkitAudioContext;
    if(!Ctx) return null;
    audioCtx=new Ctx();
  }
  if(audioCtx.state==="suspended") audioCtx.resume().catch(()=>{});
  return audioCtx;
}

function tone(freq,duration=.08,type="sine",volume=.03,endFreq=null,delay=0){
  const ctx=ensureAudio(); if(!ctx) return;
  const start=ctx.currentTime+delay;
  const osc=ctx.createOscillator();
  const gain=ctx.createGain();
  osc.type=type;
  osc.frequency.setValueAtTime(freq,start);
  if(endFreq) osc.frequency.exponentialRampToValueAtTime(Math.max(1,endFreq),start+duration);
  gain.gain.setValueAtTime(.0001,start);
  gain.gain.exponentialRampToValueAtTime(volume,start+.01);
  gain.gain.exponentialRampToValueAtTime(.0001,start+duration);
  osc.connect(gain); gain.connect(ctx.destination);
  osc.start(start); osc.stop(start+duration+.02);
}

function noiseBurst(duration=.12,volume=.02,delay=0){
  const ctx=ensureAudio(); if(!ctx) return;
  const start=ctx.currentTime+delay;
  const len=Math.floor(ctx.sampleRate*duration);
  const buffer=ctx.createBuffer(1,len,ctx.sampleRate);
  const data=buffer.getChannelData(0);
  for(let i=0;i<len;i++) data[i]=(Math.random()*2-1)*(1-i/len);
  const source=ctx.createBufferSource(); source.buffer=buffer;
  const filter=ctx.createBiquadFilter(); filter.type="bandpass"; filter.frequency.value=1800; filter.Q.value=.7;
  const gain=ctx.createGain(); gain.gain.setValueAtTime(volume,start); gain.gain.exponentialRampToValueAtTime(.0001,start+duration);
  source.connect(filter); filter.connect(gain); gain.connect(ctx.destination);
  source.start(start); source.stop(start+duration+.02);
}

function mouthSound(){ noiseBurst(.18,.035); tone(135,.22,"triangle",.045,72); tone(70,.22,"sine",.035,48,.03); }
function blinkSound(){ tone(520,.07,"sine",.025,1280); tone(1100,.05,"triangle",.016,720,.02); }
function browSound(){ noiseBurst(.25,.022); tone(220,.2,"triangle",.03,660); tone(520,.18,"sine",.018,980,.04); }

function dist2D(a,b){ return Math.hypot(a.x-b.x,a.y-b.y); }

function buildMaskTexture(){
  const canvas=document.createElement("canvas");
  canvas.width=1024;
  canvas.height=1024;

  const ctx=canvas.getContext("2d");
  ctx.clearRect(0,0,1024,1024);

  // Capa uniforme: si esto está bien, debe cubrir exactamente el FaceMesh.
  const gradient=ctx.createRadialGradient(512,470,120,512,520,620);
  gradient.addColorStop(0,"rgba(105,24,18,.72)");
  gradient.addColorStop(.55,"rgba(48,12,11,.78)");
  gradient.addColorStop(1,"rgba(8,7,8,.84)");

  ctx.fillStyle=gradient;
  ctx.fillRect(0,0,1024,1024);

  const texture=new THREE.CanvasTexture(canvas);
  texture.colorSpace=THREE.SRGBColorSpace;
  texture.needsUpdate=true;
  return texture;
}
function setTracking(active){
  if(gestureState.tracking===active) return;
  gestureState.tracking=active;
  document.body.classList.toggle("tracking",active);
  $("tracking-state").textContent=active?"Rostro detectado":"Buscando rostro…";
}

function animateMouth(active){
  if(gestureState.mouth===active) return;
  gestureState.mouth=active;
  if(active){ mouthSound(); $("mouth-state").textContent="Fuego ritual"; }
  else $("mouth-state").textContent="Boca";
}
function animateBlink(active){
  if(gestureState.blink===active) return;
  gestureState.blink=active;
  if(active){ blinkSound(); $("blink-state").textContent="Mirada activa"; }
  else $("blink-state").textContent="Ojos";
}
function animateBrow(active){
  if(gestureState.brow===active) return;
  gestureState.brow=active;
  if(active){ browSound(); $("brow-state").textContent="Sello activo"; }
  else $("brow-state").textContent="Cejas";
}

function evaluateGestures(lm){
  if(!lm||lm.length<468){ setTracking(false); return; }
  setTracking(true);
  const mouthRatio=dist2D(lm[13],lm[14])/Math.max(.001,dist2D(lm[78],lm[308]));
  const leftEyeRatio=dist2D(lm[159],lm[145])/Math.max(.001,dist2D(lm[33],lm[133]));
  const rightEyeRatio=dist2D(lm[386],lm[374])/Math.max(.001,dist2D(lm[362],lm[263]));
  const brow=((dist2D(lm[105],lm[159])/Math.max(.001,dist2D(lm[33],lm[133])))+(dist2D(lm[334],lm[386])/Math.max(.001,dist2D(lm[362],lm[263]))))/2;
  animateMouth(mouthRatio>.18);
  animateBlink(leftEyeRatio<.17&&rightEyeRatio<.17);
  animateBrow(brow>.72);
}

function initGestureDetection(){
  if(!window.FaceMesh||faceMeshDetector) return;
  faceMeshDetector=new FaceMesh({locateFile:(file)=>`https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`});
  faceMeshDetector.setOptions({maxNumFaces:1,refineLandmarks:true,minDetectionConfidence:.55,minTrackingConfidence:.55});
  faceMeshDetector.onResults((r)=>evaluateGestures(r.multiFaceLandmarks?.[0]));
}

function startGestureLoop(){
  if(gestureLoopStarted) return;
  gestureLoopStarted=true;
  initGestureDetection();
  const tick=async(time)=>{
    const video=document.querySelector("video");
    if(faceMeshDetector&&video&&video.readyState>=2&&!processingFace&&time-lastFaceProcess>95){
      processingFace=true; lastFaceProcess=time;
      try{ await faceMeshDetector.send({image:video}); }catch(e){ console.warn(e); }
      finally{ processingFace=false; }
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

async function startAR(){
  if(mindarThree) return;

  ensureAudio();

  $("intro").classList.add("hidden");
  $("ar-shell").classList.remove("hidden");

  mindarThree=new MindARThree({
    container:$("scene-root")
  });

  const {renderer,scene,camera}=mindarThree;

  scene.add(new THREE.HemisphereLight(0xffffff,0x2a1110,1.35));

  const key=new THREE.DirectionalLight(0xffffff,1.0);
  key.position.set(.5,1,1.5);
  scene.add(key);

  // Misma configuración base del proyecto Samurai que ya sabemos que funciona.
  faceMeshAR=mindarThree.addFaceMesh();

  faceMeshAR.material=new THREE.MeshStandardMaterial({
    map:buildMaskTexture(),
    transparent:true,
    opacity:.82,
    roughness:.42,
    metalness:.25,
    side:THREE.DoubleSide,
    emissive:new THREE.Color(0x160403),
    emissiveIntensity:.12,
    depthWrite:false
  });

  scene.add(faceMeshAR);

  await mindarThree.start();

  renderer.setAnimationLoop(()=>{
    if(faceMeshAR){
      const mat=faceMeshAR.material;

      if(gestureState.mouth){
        mat.emissive.setHex(0x671308);
        mat.emissiveIntensity=.65;
      }else if(gestureState.blink){
        mat.emissive.setHex(0x7a1d0c);
        mat.emissiveIntensity=.72;
      }else if(gestureState.brow){
        mat.emissive.setHex(0x735017);
        mat.emissiveIntensity=.60;
      }else{
        mat.emissive.setHex(0x160403);
        mat.emissiveIntensity=.12;
      }
    }

    renderer.render(scene,camera);
  });

  startGestureLoop();
}
$("start-camera").addEventListener("click",startAR);
