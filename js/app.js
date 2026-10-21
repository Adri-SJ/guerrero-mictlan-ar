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
  canvas.width=1024; canvas.height=1024;
  const ctx=canvas.getContext("2d");
  ctx.clearRect(0,0,1024,1024);

  // Base uniforme: el FaceMesh se encarga de seguir la forma real del rostro.
  const base=ctx.createRadialGradient(512,470,120,512,520,610);
  base.addColorStop(0,"rgba(88,24,18,.46)");
  base.addColorStop(.48,"rgba(38,12,11,.60)");
  base.addColorStop(1,"rgba(5,5,6,.74)");
  ctx.fillStyle=base;
  ctx.fillRect(0,0,1024,1024);

  // Vetas de obsidiana suaves: decorativas, sin intentar dibujar ojos/nariz en UV.
  ctx.strokeStyle="rgba(178,48,30,.28)";
  ctx.lineWidth=8;
  [
    [250,210,390,380],
    [774,210,634,380],
    [210,565,370,660],
    [814,565,654,660],
    [330,790,445,845],
    [694,790,579,845]
  ].forEach(([x1,y1,x2,y2])=>{
    ctx.beginPath();
    ctx.moveTo(x1,y1);
    ctx.lineTo(x2,y2);
    ctx.stroke();
  });

  // Filetes dorados generales.
  ctx.strokeStyle="rgba(205,166,88,.34)";
  ctx.lineWidth=7;
  ctx.beginPath();
  ctx.arc(512,330,230,Math.PI*.15,Math.PI*.85);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(512,680,255,Math.PI*1.12,Math.PI*1.88);
  ctx.stroke();

  // Acabado tipo piedra pulida.
  const gloss=ctx.createLinearGradient(0,120,0,900);
  gloss.addColorStop(0,"rgba(255,255,255,.09)");
  gloss.addColorStop(.42,"rgba(255,255,255,.012)");
  gloss.addColorStop(1,"rgba(255,255,255,0)");
  ctx.fillStyle=gloss;
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

  mindarThree=new MindARThree({container:$("scene-root")});
  const {renderer,scene,camera}=mindarThree;

  scene.add(new THREE.HemisphereLight(0xffffff,0x24110a,1.3));
  const key=new THREE.DirectionalLight(0xffffff,1.0); key.position.set(.5,1,1.4); scene.add(key);

  faceMeshAR=mindarThree.addFaceMesh();
  faceMeshAR.material=new THREE.MeshStandardMaterial({
    map:buildMaskTexture(),transparent:true,opacity:.70,roughness:.38,metalness:.42,
    side:THREE.DoubleSide,emissive:new THREE.Color(0x120302),emissiveIntensity:.14,depthWrite:false
  });
  scene.add(faceMeshAR);

  // Detalles colocados sobre landmarks reales del rostro.
  const redGlow=new THREE.MeshStandardMaterial({
    color:0x8d2118,
    emissive:0x7a130d,
    emissiveIntensity:.55,
    metalness:.58,
    roughness:.28,
    side:THREE.DoubleSide
  });

  const goldGlow=new THREE.MeshStandardMaterial({
    color:0xc49a48,
    emissive:0x4d2d06,
    emissiveIntensity:.34,
    metalness:.86,
    roughness:.22,
    side:THREE.DoubleSide
  });

  // Marcos de ojos: anclados a cada ojo real.
  const leftEyeAnchor=mindarThree.addAnchor(159);
  const rightEyeAnchor=mindarThree.addAnchor(386);

  const eyeGeometry=new THREE.RingGeometry(.048,.068,40);

  const leftEyeOrnament=new THREE.Mesh(eyeGeometry,redGlow.clone());
  leftEyeOrnament.scale.set(1.55,.72,1);
  leftEyeOrnament.rotation.z=-.12;
  leftEyeOrnament.position.set(0,0,.06);
  leftEyeAnchor.group.add(leftEyeOrnament);

  const rightEyeOrnament=new THREE.Mesh(eyeGeometry,redGlow.clone());
  rightEyeOrnament.scale.set(1.55,.72,1);
  rightEyeOrnament.rotation.z=.12;
  rightEyeOrnament.position.set(0,0,.06);
  rightEyeAnchor.group.add(rightEyeOrnament);

  // Nariz / centro ritual.
  const noseAnchor=mindarThree.addAnchor(1);
  const noseShape=new THREE.Shape();
  noseShape.moveTo(0,.075);
  noseShape.lineTo(-.055,-.055);
  noseShape.lineTo(.055,-.055);
  noseShape.closePath();
  const nosePiece=new THREE.Mesh(new THREE.ShapeGeometry(noseShape),goldGlow);
  nosePiece.position.set(0,-.01,.065);
  noseAnchor.group.add(nosePiece);

  // Boca / mandíbula: pieza separada para poder reaccionar al gesto.
  const mouthAnchor=mindarThree.addAnchor(13);
  const mouthGroup=new THREE.Group();
  mouthGroup.position.set(0,-.075,.055);

  const jawPlate=new THREE.Mesh(
    new THREE.BoxGeometry(.34,.09,.028),
    new THREE.MeshStandardMaterial({
      color:0x101011,
      metalness:.72,
      roughness:.3,
      emissive:0x280604,
      emissiveIntensity:.18
    })
  );
  mouthGroup.add(jawPlate);

  const mouthLine=new THREE.Mesh(
    new THREE.BoxGeometry(.21,.018,.018),
    redGlow.clone()
  );
  mouthLine.position.set(0,.022,.022);
  mouthGroup.add(mouthLine);

  mouthAnchor.group.add(mouthGroup);

  // Corona/penacho oscuro, no interactivo pero da silueta de guerrero.
  const foreheadAnchor=mindarThree.addAnchor(10);
  const headdress=new THREE.Group();
  headdress.position.set(0,.16,.01);

  const stone=new THREE.MeshStandardMaterial({color:0x111214,metalness:.55,roughness:.34});
  const bronze=new THREE.MeshStandardMaterial({color:0x9b6c2e,metalness:.8,roughness:.24,emissive:0x281300,emissiveIntensity:.18});

  const crown=new THREE.Mesh(new THREE.SphereGeometry(.235,32,20),stone);
  crown.scale.set(1.35,.74,1.02); crown.position.set(0,.11,-.08); headdress.add(crown);

  const band=new THREE.Mesh(new THREE.BoxGeometry(.62,.055,.08),bronze);
  band.position.set(0,-.01,.045); headdress.add(band);

  [-.22,0,.22].forEach((x,i)=>{
    const spike=new THREE.Mesh(new THREE.ConeGeometry(.023,.22,16),bronze);
    spike.position.set(x,.29+(i===1?.04:0),.03);
    spike.rotation.z=x<0?.28:x>0?-.28:0;
    headdress.add(spike);
  });

  foreheadAnchor.group.add(headdress);

  await mindarThree.start();

  renderer.setAnimationLoop(()=>{
    const mat=faceMeshAR.material;
    if(gestureState.mouth){ mat.emissive.setHex(0x6e1609); mat.emissiveIntensity=.92; }
    else if(gestureState.blink){ mat.emissive.setHex(0x7a220e); mat.emissiveIntensity=.72; }
    else if(gestureState.brow){ mat.emissive.setHex(0x6b4a16); mat.emissiveIntensity=.70; }
    else { mat.emissive.setHex(0x120302); mat.emissiveIntensity=.14; }

    const eyeTarget=gestureState.blink?1.24:1;
    leftEyeOrnament.scale.lerp(new THREE.Vector3(1.55*eyeTarget,.72*eyeTarget,1),.22);
    rightEyeOrnament.scale.lerp(new THREE.Vector3(1.55*eyeTarget,.72*eyeTarget,1),.22);

    const jawTargetY=gestureState.mouth?-.13:-.075;
    mouthGroup.position.y+=(jawTargetY-mouthGroup.position.y)*.24;
    {
      const targetRot=gestureState.mouth?.18:0;
      mouthGroup.rotation.x+=(targetRot-mouthGroup.rotation.x)*.18;
    }

    const target=gestureState.brow?1.18:1;
    headdress.scale.lerp(new THREE.Vector3(target,target,target),.12);

    renderer.render(scene,camera);
  });

  startGestureLoop();
}

$("start-camera").addEventListener("click",startAR);
