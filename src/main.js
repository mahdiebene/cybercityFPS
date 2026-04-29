import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import * as SkeletonUtils from "three/examples/jsm/utils/SkeletonUtils.js";

const canvas = document.querySelector("#game");
const MAX_PIXEL_RATIO = 1.25;
const MAX_DYNAMIC_STREET_LIGHTS = 8;
const MAX_DECALS = 28;
const MAX_EFFECTS = 220;
const NAV_CELL_SIZE = 4;
const NAV_AGENT_RADIUS = 0.82;
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x91a0a6);
scene.fog = new THREE.FogExp2(0x8e989b, 0.0085);

const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.08, 500);
camera.rotation.order = "YXZ";

const composer = new EffectComposer(renderer);
composer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
composer.setSize(window.innerWidth, window.innerHeight);
const renderPass = new RenderPass(scene, camera);
const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.18, 0.55, 0.88);
bloomPass.threshold = 0.86;
bloomPass.strength = 0.08;
bloomPass.radius = 0.45;
composer.addPass(renderPass);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());

const clock = new THREE.Clock();
const raycaster = new THREE.Raycaster();
const tmpVec = new THREE.Vector3();
const tmpVec2 = new THREE.Vector3();
const tmpVec3 = new THREE.Vector3();
const flatForward = new THREE.Vector3();
const flatRight = new THREE.Vector3();
const hitNormal = new THREE.Vector3();
const cameraDirection = new THREE.Vector3();

const ui = {
  startScreen: document.querySelector("#start-screen"),
  pauseScreen: document.querySelector("#pause-screen"),
  gameOverScreen: document.querySelector("#game-over-screen"),
  startButton: document.querySelector("#start-button"),
  resumeButton: document.querySelector("#resume-button"),
  restartButton: document.querySelector("#restart-button"),
  finalScore: document.querySelector("#final-score"),
  hud: document.querySelector("#hud"),
  healthLabel: document.querySelector("#health-label"),
  healthFill: document.querySelector("#health-fill"),
  armorLabel: document.querySelector("#armor-label"),
  armorFill: document.querySelector("#armor-fill"),
  wave: document.querySelector("#wave"),
  score: document.querySelector("#score"),
  weaponPanel: document.querySelector("#weapon-panel"),
  weaponName: document.querySelector("#weapon-name"),
  ammo: document.querySelector("#ammo"),
  reloadMeter: document.querySelector("#reload-meter"),
  reloadFill: document.querySelector("#reload-meter span"),
  weaponSlots: document.querySelectorAll("#weapon-slots span"),
  notice: document.querySelector("#notice"),
  damageVignette: document.querySelector("#damage-vignette"),
  crosshair: document.querySelector("#crosshair"),
  hitmarker: document.querySelector("#hitmarker"),
};

const world = {
  size: 168,
  half: 84,
  blockers: [],
  enemyBlockers: [],
  spawnPoints: [],
  lamps: [],
  pickups: [],
  decals: [],
  interactives: [],
  coverNodes: [],
  nav: {
    ready: false,
    dirty: false,
    cellSize: NAV_CELL_SIZE,
    width: 0,
    height: 0,
    originX: 0,
    originZ: 0,
    nodes: [],
    grid: [],
  },
  dynamicStreetLights: 0,
};

const input = {
  keys: new Set(),
  mouseDown: false,
  ads: false,
  fireQueued: false,
  reloadRequested: false,
  switchTo: null,
  pointerLocked: false,
  lookX: 0,
  lookY: 0,
};

const player = {
  position: new THREE.Vector3(0, 1.7, 34),
  velocity: new THREE.Vector3(),
  radius: 0.55,
  height: 1.72,
  yaw: 0,
  pitch: 0,
  health: 100,
  armor: 35,
  score: 0,
  kills: 0,
  onGround: false,
  invulnerable: 0,
  hurtPulse: 0,
  bobTime: 0,
  recoil: 0,
  recoilSide: 0,
  recoilRoll: 0,
  weaponKick: 0,
  weaponKickSide: 0,
  weaponCycle: 0,
  weaponSwitch: 0,
  adsAmount: 0,
  sprintAmount: 0,
  swayX: 0,
  swayY: 0,
  weaponIndex: 0,
  alive: true,
};

const game = {
  state: "menu",
  wave: 1,
  waveCooldown: 0,
  spawnBudget: 6,
  nextSquadId: 1,
  squads: [],
  squadDirectorTimer: 0,
  elapsed: 0,
  shake: 0,
  noticeTimer: 0,
  hudTimer: 0,
  lastNotice: "WASD move, mouse aim, right-click ADS, 1-6 swap, R reload, shoot crates/barrels/relays.",
};

const scopeProfiles = {
  Rifle: { fov: 46, overlay: 0.5 },
  Marksman: { fov: 32, overlay: 0.78 },
  Railgun: { fov: 38, overlay: 0.68 },
};

function makeSurfaceTexture(base, detail, size = 256, repeat = 10, strength = 0.14) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const baseColor = new THREE.Color(base);
  const detailColor = new THREE.Color(detail);
  ctx.fillStyle = `#${baseColor.getHexString()}`;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < size * 10; i += 1) {
    const x = Math.floor(Math.random() * size);
    const y = Math.floor(Math.random() * size);
    const radius = 1 + Math.random() * 2.4;
    const mix = 0.35 + Math.random() * 0.65;
    const c = baseColor.clone().lerp(detailColor, mix);
    ctx.globalAlpha = strength * (0.35 + Math.random() * 0.65);
    ctx.fillStyle = `#${c.getHexString()}`;
    ctx.fillRect(x, y, radius, radius);
  }
  ctx.globalAlpha = 1;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  texture.anisotropy = 8;
  return texture;
}

const surfaceTextures = {
  asphalt: makeSurfaceTexture(0x252a2c, 0x111416, 320, 18, 0.2),
  concrete: makeSurfaceTexture(0x697277, 0x343b40, 256, 7, 0.12),
  facade: makeSurfaceTexture(0x7f898b, 0x4e585c, 256, 5, 0.1),
  darkMetal: makeSurfaceTexture(0x14171a, 0x30363b, 192, 4, 0.1),
};

const materials = {
  asphalt: new THREE.MeshStandardMaterial({ color: 0x2a3032, map: surfaceTextures.asphalt, roughness: 0.94, metalness: 0.02 }),
  sidewalk: new THREE.MeshStandardMaterial({ color: 0x727b80, map: surfaceTextures.concrete, roughness: 0.9 }),
  lane: new THREE.MeshStandardMaterial({ color: 0xb79a58, roughness: 0.72 }),
  rooftop: new THREE.MeshStandardMaterial({ color: 0x252a2d, map: surfaceTextures.darkMetal, roughness: 0.84 }),
  concrete: new THREE.MeshStandardMaterial({ color: 0x858f91, map: surfaceTextures.facade, roughness: 0.86 }),
  glassA: new THREE.MeshStandardMaterial({
    color: 0x5b737f,
    roughness: 0.42,
    metalness: 0.18,
    emissive: 0x07151b,
    emissiveIntensity: 0.08,
  }),
  glassB: new THREE.MeshStandardMaterial({
    color: 0x667273,
    roughness: 0.46,
    metalness: 0.16,
    emissive: 0x0a1214,
    emissiveIntensity: 0.06,
  }),
  trim: new THREE.MeshStandardMaterial({ color: 0xa9aba5, roughness: 0.64, metalness: 0.08 }),
  neon: new THREE.MeshStandardMaterial({
    color: 0xcaa45f,
    emissive: 0xa86f24,
    emissiveIntensity: 0.82,
    roughness: 0.38,
  }),
  cyanNeon: new THREE.MeshStandardMaterial({
    color: 0x7aa3ad,
    emissive: 0x236c84,
    emissiveIntensity: 0.66,
    roughness: 0.42,
  }),
  enemyRed: new THREE.MeshStandardMaterial({
    color: 0x7f2d2d,
    roughness: 0.58,
    metalness: 0.18,
    emissive: 0x160404,
    emissiveIntensity: 0.22,
  }),
  enemyBlue: new THREE.MeshStandardMaterial({
    color: 0x3f5967,
    roughness: 0.58,
    metalness: 0.26,
    emissive: 0x061116,
    emissiveIntensity: 0.22,
  }),
  enemyHeavy: new THREE.MeshStandardMaterial({
    color: 0x625d52,
    roughness: 0.54,
    metalness: 0.36,
    emissive: 0x100b04,
    emissiveIntensity: 0.16,
  }),
  darkMetal: new THREE.MeshStandardMaterial({ color: 0x15191c, map: surfaceTextures.darkMetal, roughness: 0.54, metalness: 0.48 }),
  gunMetal: new THREE.MeshStandardMaterial({ color: 0x242a2d, roughness: 0.48, metalness: 0.64 }),
  gunTrim: new THREE.MeshStandardMaterial({ color: 0x596267, roughness: 0.44, metalness: 0.5 }),
  armSleeve: new THREE.MeshStandardMaterial({ color: 0x18232b, roughness: 0.74, metalness: 0.04 }),
  glove: new THREE.MeshStandardMaterial({ color: 0x11161b, roughness: 0.75, metalness: 0.04 }),
  tire: new THREE.MeshStandardMaterial({ color: 0x111317, roughness: 0.72, metalness: 0.08 }),
  brass: new THREE.MeshStandardMaterial({ color: 0xc99a4a, roughness: 0.36, metalness: 0.62 }),
  boundary: new THREE.MeshStandardMaterial({
    color: 0xb7a15f,
    emissive: 0x7d551b,
    emissiveIntensity: 0.22,
    roughness: 0.45,
    metalness: 0.1,
  }),
  boundaryDark: new THREE.MeshStandardMaterial({ color: 0x222528, roughness: 0.58, metalness: 0.25 }),
  armorPlate: new THREE.MeshStandardMaterial({ color: 0xd3d8dd, roughness: 0.34, metalness: 0.48 }),
  enemyArmorDark: new THREE.MeshStandardMaterial({ color: 0x24313a, roughness: 0.48, metalness: 0.32 }),
  enemyArmorLight: new THREE.MeshStandardMaterial({ color: 0x91a1aa, roughness: 0.44, metalness: 0.26 }),
  muzzle: new THREE.MeshBasicMaterial({ color: 0xfff3ae, transparent: true, opacity: 0 }),
  pickup: new THREE.MeshStandardMaterial({
    color: 0x79f2af,
    emissive: 0x2ddc81,
    emissiveIntensity: 1.0,
    roughness: 0.35,
  }),
};

const weapons = [
  {
    name: "Pistol",
    initialReserve: 72,
    fireRate: 0.24,
    damage: 33,
    range: 90,
    spread: 0.009,
    pellets: 1,
    magazine: 12,
    reserve: 72,
    reloadTime: 0.95,
    recoil: 0.025,
    automatic: false,
    color: 0xf7c95f,
    shotCooldown: 0,
    reloading: 0,
    ammo: 12,
  },
  {
    name: "Rifle",
    initialReserve: 160,
    fireRate: 0.08,
    damage: 17,
    range: 115,
    spread: 0.016,
    pellets: 1,
    magazine: 32,
    reserve: 160,
    reloadTime: 1.25,
    recoil: 0.017,
    automatic: true,
    scoped: true,
    color: 0x72d6ff,
    shotCooldown: 0,
    reloading: 0,
    ammo: 32,
  },
  {
    name: "Shotgun",
    initialReserve: 42,
    fireRate: 0.72,
    damage: 18,
    range: 52,
    spread: 0.075,
    pellets: 8,
    magazine: 6,
    reserve: 42,
    reloadTime: 1.45,
    recoil: 0.075,
    automatic: false,
    color: 0xff8f70,
    shotCooldown: 0,
    reloading: 0,
    ammo: 6,
  },
  {
    name: "SMG",
    initialReserve: 210,
    fireRate: 0.055,
    damage: 11,
    range: 82,
    spread: 0.024,
    pellets: 1,
    magazine: 42,
    reserve: 210,
    reloadTime: 1.15,
    recoil: 0.014,
    automatic: true,
    color: 0x65f08c,
    shotCooldown: 0,
    reloading: 0,
    ammo: 42,
  },
  {
    name: "Marksman",
    initialReserve: 48,
    fireRate: 0.56,
    damage: 74,
    range: 155,
    spread: 0.0055,
    pellets: 1,
    magazine: 8,
    reserve: 48,
    reloadTime: 1.65,
    recoil: 0.055,
    automatic: false,
    scoped: true,
    color: 0xffd36b,
    shotCooldown: 0,
    reloading: 0,
    ammo: 8,
  },
  {
    name: "Railgun",
    initialReserve: 18,
    fireRate: 1.08,
    damage: 122,
    range: 175,
    spread: 0.0025,
    pellets: 1,
    magazine: 3,
    reserve: 18,
    reloadTime: 2.05,
    recoil: 0.095,
    automatic: false,
    scoped: true,
    color: 0x8ff6ff,
    shotCooldown: 0,
    reloading: 0,
    ammo: 3,
  },
];

const enemies = [];
const pendingSpawns = [];
const projectiles = [];
const effects = [];
const weaponRig = new THREE.Group();
const tracerMaterial = new THREE.LineBasicMaterial({
  color: 0xf7c95f,
  transparent: true,
  opacity: 0.78,
});

const assetLibrary = {
  loader: new GLTFLoader(),
  fbxLoader: new FBXLoader(),
  textureLoader: new THREE.TextureLoader(),
  models: {},
  enemyModel: null,
  enemyAnimations: {},
  enemySkins: {},
  propsPlaced: false,
  cityKitPlaced: false,
  modelReady: false,
  animationReady: false,
  audioBuffers: {},
  audioReady: false,
};

function loadPbrTexture(url, repeat = 8, colorSpace = THREE.NoColorSpace) {
  const texture = assetLibrary.textureLoader.load(url, (loaded) => {
    loaded.wrapS = THREE.RepeatWrapping;
    loaded.wrapT = THREE.RepeatWrapping;
    loaded.repeat.set(repeat, repeat);
    loaded.anisotropy = 8;
    loaded.needsUpdate = true;
  });
  texture.colorSpace = colorSpace;
  return texture;
}

function applyPbrMaterials() {
  const asphaltPath = "/assets/textures/pbr/Asphalt001_1K-JPG/Asphalt001_1K-JPG";
  const concretePath = "/assets/textures/pbr/Concrete019_1K-JPG/Concrete019_1K-JPG";
  const metalPath = "/assets/textures/pbr/MetalPlates006_1K-JPG/MetalPlates006_1K-JPG";

  materials.asphalt.map = loadPbrTexture(`${asphaltPath}_Color.jpg`, 18, THREE.SRGBColorSpace);
  materials.asphalt.normalMap = loadPbrTexture(`${asphaltPath}_NormalGL.jpg`, 18);
  materials.asphalt.roughnessMap = loadPbrTexture(`${asphaltPath}_Roughness.jpg`, 18);
  materials.asphalt.normalScale.set(0.45, 0.45);

  [materials.concrete, materials.sidewalk].forEach((material) => {
    material.map = loadPbrTexture(`${concretePath}_Color.jpg`, 7, THREE.SRGBColorSpace);
    material.normalMap = loadPbrTexture(`${concretePath}_NormalGL.jpg`, 7);
    material.roughnessMap = loadPbrTexture(`${concretePath}_Roughness.jpg`, 7);
    material.normalScale.set(0.34, 0.34);
    material.needsUpdate = true;
  });

  [materials.darkMetal, materials.gunMetal, materials.gunTrim, materials.rooftop].forEach((material) => {
    material.map = loadPbrTexture(`${metalPath}_Color.jpg`, 5, THREE.SRGBColorSpace);
    material.normalMap = loadPbrTexture(`${metalPath}_NormalGL.jpg`, 5);
    material.roughnessMap = loadPbrTexture(`${metalPath}_Roughness.jpg`, 5);
    material.metalnessMap = loadPbrTexture(`${metalPath}_Metalness.jpg`, 5);
    material.normalScale.set(0.22, 0.22);
    material.needsUpdate = true;
  });
  materials.asphalt.needsUpdate = true;
}

const modelAssets = {
  Pistol: "/assets/models/kenney-blaster/pistol.glb",
  Rifle: "/assets/models/kenney-blaster/rifle.glb",
  Shotgun: "/assets/models/kenney-blaster/shotgun.glb",
  SMG: "/assets/models/kenney-blaster/smg.glb",
  Marksman: "/assets/models/kenney-blaster/marksman.glb",
  Railgun: "/assets/models/kenney-blaster/railgun.glb",
  crateWide: "/assets/models/kenney-blaster/crate-wide.glb",
  crateMedium: "/assets/models/kenney-blaster/crate-medium.glb",
  targetLarge: "/assets/models/kenney-blaster/target-large.glb",
  roadBarrier: "/assets/models/kenney-city/construction-barrier.glb",
  trafficCone: "/assets/models/kenney-city/construction-cone.glb",
  constructionLight: "/assets/models/kenney-city/construction-light.glb",
  highwaySign: "/assets/models/kenney-city/sign-highway.glb",
  industrialTank: "/assets/models/kenney-city/detail-tank.glb",
  awning: "/assets/models/kenney-city/detail-awning.glb",
  parasol: "/assets/models/kenney-city/detail-parasol-a.glb",
  planter: "/assets/models/kenney-city/planter.glb",
  treeSmall: "/assets/models/kenney-city/tree-small.glb",
};

const enemyCharacterAsset = "/assets/models/kenney-characters/characterMedium.fbx";
const enemySkinAssets = {
  scout: "/assets/models/kenney-characters/Skins/cyborgFemaleA.png",
  trooper: "/assets/models/kenney-characters/Skins/criminalMaleA.png",
  heavy: "/assets/models/kenney-characters/Skins/skaterMaleA.png",
};

const audioAssets = {
  pistol: "/assets/audio/oga-22-pistol.wav",
  magnum: "/assets/audio/oga-22-magnum.wav",
  blackPowder: "/assets/audio/oga-black-powder.wav",
  heavy: "/assets/audio/oga-unknown.wav",
};

const shotClips = {
  Pistol: { buffer: "pistol", offsets: [0.11, 0.56, 0.92, 1.36, 1.71], duration: 0.34, gain: 1.35 },
  Rifle: { buffer: "magnum", offsets: [0.2, 0.9, 1.62], duration: 0.28, gain: 0.86 },
  Shotgun: { buffer: "blackPowder", offsets: [0.11, 0.81, 1.52, 2.23, 2.91, 3.47], duration: 0.72, gain: 1.45 },
  SMG: { buffer: "pistol", offsets: [0.11, 0.56, 0.92, 1.36, 1.71], duration: 0.18, gain: 0.78 },
  Marksman: { buffer: "magnum", offsets: [0.2, 0.9, 1.62], duration: 0.42, gain: 1.18 },
  Railgun: { buffer: "heavy", offsets: [0.1, 0.7, 1.3], duration: 0.58, gain: 1.25 },
};

const weaponView = {
  Pistol: {
    rig: { hip: [0.3, -0.39, -0.78], ads: [0.02, -0.31, -0.76] },
    modelScale: 0.9,
    modelPos: [0, -0.04, -0.13],
    modelRot: [0.03, 0, -0.02],
    grip: {
      rightArm: [[0.28, -0.66, 0.46], [0.07, -0.22, -0.02]],
      rightHand: { position: [0.05, -0.19, -0.08], rotation: [-0.22, 0.08, 0.1], scale: [0.82, 0.78, 1.22] },
      leftArm: [[-0.24, -0.66, 0.2], [-0.08, -0.23, -0.34]],
      leftHand: { position: [-0.07, -0.2, -0.37], rotation: [-0.28, -0.04, 0.12], scale: [0.86, 0.7, 1.15] },
    },
  },
  Rifle: {
    rig: { hip: [0.28, -0.41, -0.88], ads: [0.01, -0.32, -0.84] },
    modelScale: 1.14,
    modelPos: [0.01, -0.04, -0.18],
    modelRot: [0.02, 0, 0],
    grip: {
      rightArm: [[0.28, -0.68, 0.5], [0.08, -0.23, -0.08]],
      rightHand: { position: [0.07, -0.2, -0.13], rotation: [-0.22, 0.06, 0.08], scale: [0.82, 0.74, 1.18] },
      leftArm: [[-0.28, -0.67, 0.08], [-0.08, -0.22, -0.52]],
      leftHand: { position: [-0.07, -0.19, -0.55], rotation: [-0.34, -0.02, 0.14], scale: [0.88, 0.72, 1.22] },
    },
  },
  Shotgun: {
    rig: { hip: [0.3, -0.43, -0.92], ads: [0.01, -0.33, -0.88] },
    modelScale: 1.16,
    modelPos: [0.01, -0.05, -0.2],
    modelRot: [0.02, 0, 0],
    grip: {
      rightArm: [[0.3, -0.7, 0.5], [0.08, -0.24, -0.1]],
      rightHand: { position: [0.07, -0.21, -0.15], rotation: [-0.24, 0.06, 0.08], scale: [0.84, 0.74, 1.2] },
      leftArm: [[-0.3, -0.69, 0.02], [-0.08, -0.23, -0.62]],
      leftHand: { position: [-0.07, -0.2, -0.65], rotation: [-0.36, -0.02, 0.14], scale: [0.9, 0.72, 1.26] },
    },
  },
  SMG: {
    rig: { hip: [0.32, -0.4, -0.82], ads: [0.025, -0.31, -0.8] },
    modelScale: 1.0,
    modelPos: [0.01, -0.04, -0.14],
    modelRot: [0.02, 0, -0.01],
    grip: {
      rightArm: [[0.28, -0.66, 0.44], [0.08, -0.22, -0.04]],
      rightHand: { position: [0.07, -0.19, -0.1], rotation: [-0.22, 0.06, 0.08], scale: [0.82, 0.74, 1.18] },
      leftArm: [[-0.25, -0.66, 0.1], [-0.08, -0.22, -0.42]],
      leftHand: { position: [-0.07, -0.19, -0.44], rotation: [-0.32, -0.02, 0.13], scale: [0.86, 0.72, 1.18] },
    },
  },
  Marksman: {
    rig: { hip: [0.27, -0.43, -1.02], ads: [0.0, -0.34, -0.98] },
    modelScale: 1.08,
    modelPos: [0.0, -0.055, -0.26],
    modelRot: [0.015, 0, 0],
    grip: {
      rightArm: [[0.3, -0.7, 0.52], [0.08, -0.24, -0.12]],
      rightHand: { position: [0.08, -0.21, -0.17], rotation: [-0.24, 0.06, 0.08], scale: [0.84, 0.74, 1.2] },
      leftArm: [[-0.31, -0.69, -0.02], [-0.08, -0.24, -0.72]],
      leftHand: { position: [-0.07, -0.2, -0.76], rotation: [-0.37, -0.02, 0.14], scale: [0.9, 0.72, 1.26] },
    },
  },
  Railgun: {
    rig: { hip: [0.32, -0.46, -1.05], ads: [0.0, -0.35, -1.0] },
    modelScale: 1.14,
    modelPos: [0.0, -0.05, -0.3],
    modelRot: [0.01, 0, 0],
    grip: {
      rightArm: [[0.31, -0.72, 0.52], [0.08, -0.25, -0.16]],
      rightHand: { position: [0.08, -0.22, -0.2], rotation: [-0.25, 0.06, 0.08], scale: [0.86, 0.74, 1.2] },
      leftArm: [[-0.32, -0.71, -0.04], [-0.08, -0.25, -0.78]],
      leftHand: { position: [-0.07, -0.21, -0.82], rotation: [-0.38, -0.02, 0.14], scale: [0.92, 0.72, 1.3] },
    },
  },
};

const audio = {
  ctx: null,
  master: null,
  limiter: null,
  shotBus: null,
  shotShaper: null,
  reverbBus: null,
  reverb: null,
  ambience: null,
  enabled: false,
};

function initAudio() {
  if (audio.ctx) {
    audio.ctx.resume?.();
    return;
  }
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  audio.ctx = new AudioContext();
  audio.master = audio.ctx.createGain();
  audio.shotBus = audio.ctx.createGain();
  audio.shotShaper = audio.ctx.createWaveShaper();
  audio.reverbBus = audio.ctx.createGain();
  audio.reverb = audio.ctx.createConvolver();
  audio.limiter = audio.ctx.createDynamicsCompressor();
  audio.limiter.threshold.value = -11;
  audio.limiter.knee.value = 16;
  audio.limiter.ratio.value = 14;
  audio.limiter.attack.value = 0.003;
  audio.limiter.release.value = 0.12;
  audio.master.gain.value = 1.08;
  audio.shotBus.gain.value = 1;
  audio.reverbBus.gain.value = 0.18;
  audio.shotShaper.curve = makeDistortionCurve(42);
  audio.shotShaper.oversample = "4x";
  audio.reverb.buffer = makeImpulseBuffer(0.55, 2.7);
  audio.shotBus.connect(audio.shotShaper);
  audio.shotShaper.connect(audio.master);
  audio.shotBus.connect(audio.reverbBus);
  audio.reverbBus.connect(audio.reverb);
  audio.reverb.connect(audio.master);
  audio.master.connect(audio.limiter);
  audio.limiter.connect(audio.ctx.destination);
  audio.enabled = true;
  startAmbience();
  loadExternalAudioBuffers().catch((error) => console.warn("Could not load external audio", error));
}

function makeDistortionCurve(amount) {
  const samples = 44100;
  const curve = new Float32Array(samples);
  const deg = Math.PI / 180;
  for (let i = 0; i < samples; i += 1) {
    const x = (i * 2) / samples - 1;
    curve[i] = ((3 + amount) * x * 20 * deg) / (Math.PI + amount * Math.abs(x));
  }
  return curve;
}

function makeImpulseBuffer(duration, decay) {
  const length = Math.max(1, Math.floor(audio.ctx.sampleRate * duration));
  const buffer = audio.ctx.createBuffer(2, length, audio.ctx.sampleRate);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i += 1) {
      data[i] = (rand() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  return buffer;
}

function startAmbience() {
  if (!audio.ctx || audio.ambience) return;
  const hum = audio.ctx.createOscillator();
  const gain = audio.ctx.createGain();
  hum.type = "sine";
  hum.frequency.value = 58;
  gain.gain.value = 0.018;
  hum.connect(gain);
  gain.connect(audio.master);
  hum.start();
  audio.ambience = { hum, gain };
}

function makeNoiseBuffer(duration) {
  const length = Math.max(1, Math.floor(audio.ctx.sampleRate * duration));
  const buffer = audio.ctx.createBuffer(1, length, audio.ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) {
    data[i] = (rand() * 2 - 1) * (1 - i / length);
  }
  return buffer;
}

function playTone(frequency, duration, gainValue, type = "sine", destination = audio.master, slideTo = null, delay = 0) {
  if (!audio.ctx || !audio.enabled) return;
  const now = audio.ctx.currentTime + delay;
  const osc = audio.ctx.createOscillator();
  const gain = audio.ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(frequency, now);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), now + duration);
  gain.gain.setValueAtTime(gainValue, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  osc.connect(gain);
  gain.connect(destination);
  osc.start(now);
  osc.stop(now + duration + 0.03);
}

function playNoise(duration, gainValue, filterFrequency = 900, filterType = "lowpass", destination = audio.master, delay = 0, q = 0.8) {
  if (!audio.ctx || !audio.enabled) return;
  const now = audio.ctx.currentTime + delay;
  const source = audio.ctx.createBufferSource();
  const filter = audio.ctx.createBiquadFilter();
  const gain = audio.ctx.createGain();
  source.buffer = makeNoiseBuffer(duration);
  filter.type = filterType;
  filter.frequency.value = filterFrequency;
  filter.Q.value = q;
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(gainValue, now + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(destination);
  source.start(now);
}

function playMechanicalAction(delay = 0) {
  playTone(1750, 0.018, 0.075, "square", audio.master, 900, delay);
  playTone(820, 0.026, 0.08, "triangle", audio.master, 420, delay + 0.036);
}

function playSample(bufferName, offset = 0, duration = null, gainValue = 1, destination = audio.shotBus ?? audio.master, delay = 0) {
  if (!audio.ctx || !audio.enabled) return false;
  const buffer = assetLibrary.audioBuffers[bufferName];
  if (!buffer) return false;
  const now = audio.ctx.currentTime + delay;
  const source = audio.ctx.createBufferSource();
  const gain = audio.ctx.createGain();
  source.buffer = buffer;
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(gainValue, now + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + (duration ?? buffer.duration));
  source.connect(gain);
  gain.connect(destination);
  source.start(now, offset, duration ?? Math.max(0.01, buffer.duration - offset));
  return true;
}

function playGunSound(weapon) {
  const shotBus = audio.shotBus ?? audio.master;
  const external = shotClips[weapon.name];
  if (external) {
    const offset = external.offsets[Math.floor(rand() * external.offsets.length)];
    const gainBoost = weapon.name === "Railgun" ? 1.34 : weapon.name === "Marksman" ? 1.22 : weapon.name === "Shotgun" ? 1.25 : weapon.name === "Rifle" ? 1.12 : weapon.name === "SMG" ? 0.95 : 1.18;
    const played = playSample(external.buffer, offset, external.duration, external.gain * gainBoost, shotBus);
    if (played) {
      if (weapon.name === "Railgun") {
        playNoise(0.12, 0.62, 2800, "bandpass", shotBus, 0, 1.2);
        playTone(190, 0.18, 0.25, "sawtooth", shotBus, 52, 0.01);
        playTone(64, 0.34, 0.2, "sine", audio.master, 26, 0.018);
        playMechanicalAction(0.18);
        return;
      }
      if (weapon.name === "Marksman") {
        playNoise(0.055, 0.42, 5200, "highpass", shotBus, 0, 0.8);
        playTone(92, 0.18, 0.18, "sine", audio.master, 44, 0.014);
        playMechanicalAction(0.08);
        return;
      }
      playNoise(0.032, weapon.name === "Shotgun" ? 0.54 : 0.32, 6800, "highpass", shotBus, 0, 0.7);
      playNoise(weapon.name === "Shotgun" ? 0.18 : 0.08, weapon.name === "Shotgun" ? 0.58 : 0.32, weapon.name === "Shotgun" ? 520 : 980, "lowpass", shotBus, 0.004, 0.8);
      playTone(weapon.name === "Shotgun" ? 44 : 68, weapon.name === "Shotgun" ? 0.34 : 0.16, weapon.name === "Shotgun" ? 0.36 : 0.18, "sine", audio.master, 28, 0.012);
      playMechanicalAction(weapon.name === "Shotgun" ? 0.14 : 0.04);
      return;
    }
  }
  if (weapon.name === "Pistol") {
    playNoise(0.12, 1.05, 1450, "lowpass", shotBus, 0, 0.95);
    playNoise(0.038, 0.68, 5200, "highpass", shotBus, 0, 0.7);
    playTone(135, 0.12, 0.34, "triangle", shotBus, 48);
    playTone(72, 0.19, 0.2, "sine", audio.master, 42, 0.018);
    playMechanicalAction(0.045);
  } else if (weapon.name === "Rifle") {
    playNoise(0.072, 0.9, 1850, "lowpass", shotBus, 0, 0.85);
    playNoise(0.026, 0.58, 6200, "highpass", shotBus, 0, 0.55);
    playTone(168, 0.075, 0.24, "sawtooth", shotBus, 76);
    playTone(88, 0.11, 0.14, "sine", audio.master, 48, 0.012);
    playMechanicalAction(0.026);
  } else {
    playNoise(0.24, 1.35, 720, "lowpass", shotBus, 0, 0.9);
    playNoise(0.075, 0.82, 3200, "highpass", shotBus, 0.004, 0.8);
    playTone(72, 0.26, 0.42, "triangle", shotBus, 30);
    playTone(42, 0.34, 0.34, "sine", audio.master, 28, 0.02);
    playMechanicalAction(0.11);
  }
}

function playReloadSound() {
  playTone(620, 0.045, 0.14, "square");
  window.setTimeout(() => playTone(340, 0.07, 0.14, "triangle"), 105);
  window.setTimeout(() => playNoise(0.04, 0.1, 1200), 190);
  window.setTimeout(() => playTone(920, 0.035, 0.11, "square"), 420);
  window.setTimeout(() => playMechanicalAction(0), 680);
}

function playReloadStage(weapon, stage) {
  if (stage === "start") {
    playTone(560, 0.035, 0.09, "triangle", audio.master, 340);
    playNoise(0.028, 0.055, 1600, "bandpass");
    return;
  }
  if (stage === "drop") {
    playTone(420, 0.035, 0.12, "triangle", audio.master, 260);
    playNoise(0.035, weapon.name === "Shotgun" ? 0.1 : 0.075, 1800, "bandpass");
    return;
  }
  if (stage === "insert") {
    playTone(760, 0.045, 0.14, "square", audio.master, 380);
    playNoise(0.045, 0.11, 1100, "bandpass");
    return;
  }
  playMechanicalAction(0);
  playTone(1180, 0.025, 0.11, "square", audio.master, 720, 0.035);
}

function playDryFireSound() {
  playTone(1180, 0.018, 0.08, "square", audio.master, 680);
  playTone(480, 0.028, 0.055, "triangle", audio.master, 240, 0.026);
}

function playHitSound() {
  playNoise(0.06, 0.22, 2600, "highpass");
  playTone(190, 0.05, 0.11, "triangle", audio.master, 130);
}

function playEnemyDeathSound() {
  playNoise(0.22, 0.28, 620);
  playTone(155, 0.18, 0.17, "sawtooth", audio.master, 42);
}

function playEnemyShotSound() {
  playTone(650, 0.08, 0.15, "square", audio.master, 360);
  playNoise(0.045, 0.18, 1900);
}

function playPickupSound() {
  playTone(540, 0.08, 0.13, "triangle", audio.master, 880);
  window.setTimeout(() => playTone(880, 0.08, 0.12, "triangle"), 70);
}

function playPlayerDamageSound() {
  playNoise(0.18, 0.36, 360);
  playTone(96, 0.2, 0.16, "sine", audio.master, 54);
}

const enemyTypes = {
  scout: {
    label: "Scout",
    health: 48,
    speed: 4.25,
    radius: 0.48,
    height: 1.55,
    score: 100,
    attackRange: 1.65,
    attackDamage: 9,
    attackRate: 1.1,
    preferredRange: 1.25,
    material: materials.enemyRed,
    accent: 0xf7c95f,
    scale: 0.88,
    ranged: false,
  },
  trooper: {
    label: "Trooper",
    health: 72,
    speed: 2.9,
    radius: 0.54,
    height: 1.75,
    score: 160,
    attackRange: 16,
    attackDamage: 7,
    attackRate: 1.75,
    preferredRange: 12,
    material: materials.enemyBlue,
    accent: 0x72d6ff,
    scale: 1,
    ranged: true,
  },
  heavy: {
    label: "Heavy",
    health: 135,
    speed: 1.85,
    radius: 0.72,
    height: 2.08,
    score: 300,
    attackRange: 2.25,
    attackDamage: 20,
    attackRate: 1.65,
    preferredRange: 1.5,
    material: materials.enemyHeavy,
    accent: 0xff8f70,
    scale: 1.22,
    ranged: false,
  },
};

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const rand = seededRandom(1138);

function loadExternalAssets() {
  Object.entries(modelAssets).forEach(([key, url]) => {
    assetLibrary.loader.load(
      url,
      (gltf) => {
        assetLibrary.models[key] = gltf.scene;
        assetLibrary.modelReady = true;
        if (key === weapons[player.weaponIndex]?.name) rebuildWeaponModel();
        addExternalCityProps();
        addExternalCityKitProps();
      },
      undefined,
      (error) => console.warn(`Could not load model ${key}`, error),
    );
  });

  Object.entries(enemySkinAssets).forEach(([key, url]) => {
    assetLibrary.textureLoader.load(
      url,
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = 4;
        assetLibrary.enemySkins[key] = texture;
      },
      undefined,
      (error) => console.warn(`Could not load enemy skin ${key}`, error),
    );
  });

  assetLibrary.fbxLoader.load(
    enemyCharacterAsset,
    (object) => {
      assetLibrary.enemyModel = object;
      assetLibrary.modelReady = true;
    },
    undefined,
    (error) => console.warn("Could not load enemy character model", error),
  );

  const enemyAnimationAssets = {
    idle: "/assets/vendor/kenney_animated-characters-2/Animations/idle.fbx",
    run: "/assets/vendor/kenney_animated-characters-2/Animations/run.fbx",
  };
  Object.entries(enemyAnimationAssets).forEach(([key, url]) => {
    assetLibrary.fbxLoader.load(
      url,
      (object) => {
        const clip = object.animations?.[0];
        if (clip) {
          assetLibrary.enemyAnimations[key] = clip;
          assetLibrary.animationReady = true;
        }
      },
      undefined,
      (error) => console.warn(`Could not load enemy animation ${key}`, error),
    );
  });
}

async function loadExternalAudioBuffers() {
  if (!audio.ctx || assetLibrary.audioReady) return;
  const entries = await Promise.all(Object.entries(audioAssets).map(async ([key, url]) => {
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    const buffer = await audio.ctx.decodeAudioData(arrayBuffer);
    return [key, buffer];
  }));
  entries.forEach(([key, buffer]) => {
    assetLibrary.audioBuffers[key] = buffer;
  });
  assetLibrary.audioReady = true;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function damp(current, target, lambda, dt) {
  return THREE.MathUtils.lerp(current, target, 1 - Math.exp(-lambda * dt));
}

function roundedBoxGeometry(width, height, depth, radius = 0.025, segments = 2) {
  const maxRadius = Math.min(width, height, depth) * 0.42;
  return new RoundedBoxGeometry(width, height, depth, segments, Math.min(radius, maxRadius));
}

function makeBox(width, height, depth, material, x, y, z, receive = true, cast = true) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  scene.add(mesh);
  return mesh;
}

function addBlocker(x, z, halfX, halfZ, height, mesh = null) {
  const blocker = {
    minX: x - halfX,
    maxX: x + halfX,
    minZ: z - halfZ,
    maxZ: z + halfZ,
    height,
    mesh,
  };
  world.blockers.push(blocker);
  if (height > 1.4) {
    world.enemyBlockers.push(blocker);
  }
  return blocker;
}

function removeBlocker(blocker) {
  if (!blocker) return;
  const blockerIndex = world.blockers.indexOf(blocker);
  if (blockerIndex >= 0) world.blockers.splice(blockerIndex, 1);
  const enemyIndex = world.enemyBlockers.indexOf(blocker);
  if (enemyIndex >= 0) world.enemyBlockers.splice(enemyIndex, 1);
  if (world.nav.ready) world.nav.dirty = true;
}

function restoreBlocker(blocker) {
  if (!blocker) return;
  if (!world.blockers.includes(blocker)) world.blockers.push(blocker);
  if (blocker.height > 1.4 && !world.enemyBlockers.includes(blocker)) world.enemyBlockers.push(blocker);
  if (world.nav.ready) world.nav.dirty = true;
}

function createCity() {
  scene.add(new THREE.HemisphereLight(0xc7d7dc, 0x2f3639, 1.25));
  const ambient = new THREE.AmbientLight(0xffffff, 0.14);
  scene.add(ambient);

  const sun = new THREE.DirectionalLight(0xf2dcc0, 3.15);
  sun.position.set(-48, 58, 28);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -95;
  sun.shadow.camera.right = 95;
  sun.shadow.camera.top = 95;
  sun.shadow.camera.bottom = -95;
  sun.shadow.camera.near = 4;
  sun.shadow.camera.far = 170;
  sun.shadow.bias = -0.00025;
  scene.add(sun);

  const fill = new THREE.DirectionalLight(0x9ab2bd, 0.42);
  fill.position.set(60, 30, -45);
  scene.add(fill);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(230, 230), materials.asphalt);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  for (let lane = -72; lane <= 72; lane += 24) {
    const roadA = makeBox(230, 0.03, 8.5, materials.asphalt, 0, 0.025, lane, true, false);
    const roadB = makeBox(8.5, 0.03, 230, materials.asphalt, lane, 0.03, 0, true, false);
    roadA.material = roadB.material = materials.asphalt;

    const stripeA = makeBox(230, 0.035, 0.22, materials.lane, 0, 0.055, lane, true, false);
    const stripeB = makeBox(0.22, 0.035, 230, materials.lane, lane, 0.06, 0, true, false);
    stripeA.material.emissive = new THREE.Color(0x322308);
    stripeA.material.emissiveIntensity = 0.25;
    stripeB.material = stripeA.material;
  }
  createStreetDetails();

  const sidewalkMat = materials.sidewalk;
  for (let x = -84; x <= 84; x += 24) {
    makeBox(2.4, 0.12, 230, sidewalkMat, x - 6, 0.07, 0, true, false);
    makeBox(2.4, 0.12, 230, sidewalkMat, x + 6, 0.07, 0, true, false);
  }
  for (let z = -84; z <= 84; z += 24) {
    makeBox(230, 0.12, 2.4, sidewalkMat, 0, 0.08, z - 6, true, false);
    makeBox(230, 0.12, 2.4, sidewalkMat, 0, 0.08, z + 6, true, false);
  }

  const buildingMaterials = [materials.concrete, materials.glassA, materials.glassB];
  for (let gx = -72; gx <= 72; gx += 24) {
    for (let gz = -72; gz <= 72; gz += 24) {
      if (Math.abs(gx) < 12 && Math.abs(gz - 24) < 18) continue;
      if ((gx === 0 && gz === 0) || (gx === 24 && gz === 24) || (gx === -24 && gz === 24)) continue;

      const width = 9 + Math.floor(rand() * 7);
      const depth = 9 + Math.floor(rand() * 7);
      const height = 10 + Math.floor(rand() * 34);
      const x = gx + (rand() - 0.5) * 2.6;
      const z = gz + (rand() - 0.5) * 2.6;
      const mat = buildingMaterials[Math.floor(rand() * buildingMaterials.length)];
      const mesh = new THREE.Mesh(roundedBoxGeometry(width, height, depth, 0.08, 2), mat);
      mesh.position.set(x, height / 2, z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      scene.add(mesh);
      addBlocker(x, z, width / 2 + 0.2, depth / 2 + 0.2, height, mesh);

      const roof = makeBox(width + 0.5, 0.45, depth + 0.5, materials.rooftop, x, height + 0.25, z);
      roof.castShadow = true;

      const floors = Math.max(2, Math.floor(height / 4));
      const rows = Math.min(8, floors);
      const cols = Math.max(2, Math.floor(width / 2.8));
      for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < cols; col += 1) {
          if (rand() < 0.22) continue;
          const wx = x - width / 2 - 0.015;
          const wy = 2.7 + row * ((height - 4) / rows);
          const wz = z - depth / 2 + 1.4 + col * ((depth - 2.8) / Math.max(1, cols - 1));
          const windowMesh = makeBox(0.04, 0.95, 0.82, rand() > 0.58 ? materials.neon : materials.cyanNeon, wx, wy, wz, false, false);
          windowMesh.userData.window = true;
          const wx2 = x + width / 2 + 0.015;
          makeBox(0.04, 0.95, 0.82, windowMesh.material, wx2, wy, wz, false, false);
        }
      }

      const faceCols = Math.max(2, Math.floor(width / 2.8));
      for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < faceCols; col += 1) {
          if (rand() < 0.28) continue;
          const wx = x - width / 2 + 1.4 + col * ((width - 2.8) / Math.max(1, faceCols - 1));
          const wy = 2.7 + row * ((height - 4) / rows);
          const frontZ = z - depth / 2 - 0.015;
          const backZ = z + depth / 2 + 0.015;
          const windowMaterial = rand() > 0.62 ? materials.neon : materials.cyanNeon;
          makeBox(0.82, 0.92, 0.04, windowMaterial, wx, wy, frontZ, false, false);
          makeBox(0.82, 0.92, 0.04, windowMaterial, wx, wy, backZ, false, false);
        }
      }

      const trimMaterial = materials.trim;
      makeBox(0.08, height * 0.92, 0.06, trimMaterial, x - width / 2 - 0.03, height * 0.5, z - depth / 2 - 0.03, false, false);
      makeBox(0.08, height * 0.92, 0.06, trimMaterial, x + width / 2 + 0.03, height * 0.5, z - depth / 2 - 0.03, false, false);

      if (rand() > 0.63) {
        const sign = makeBox(width * 0.55, 1.25, 0.15, rand() > 0.5 ? materials.neon : materials.cyanNeon, x, 3.2, z - depth / 2 - 0.08, false, false);
        sign.castShadow = false;
      }
    }
  }

  for (let i = 0; i < 26; i += 1) {
    const axis = i % 2 === 0 ? "x" : "z";
    const lane = -72 + Math.floor(rand() * 7) * 24;
    const offset = -74 + rand() * 148;
    const x = axis === "x" ? offset : lane + (rand() > 0.5 ? 7.2 : -7.2);
    const z = axis === "z" ? offset : lane + (rand() > 0.5 ? 7.2 : -7.2);
    createLamp(x, z);
  }

  for (let i = 0; i < 16; i += 1) {
    const x = -78 + rand() * 156;
    const z = -78 + rand() * 156;
    if (isBlockedAt(x, z, 1.6)) continue;
    const car = createCar(x, z, rand() > 0.5);
    addBlocker(x, z, car.halfX, car.halfZ, 1.45, car.mesh);
  }
  createCoverProps();
  createInteractiveObjects();
  createUrbanDressing();

  const borderSize = world.size + 18;
  const walls = [
    [0, -world.half - 8, borderSize, 2],
    [0, world.half + 8, borderSize, 2],
    [-world.half - 8, 0, 2, borderSize],
    [world.half + 8, 0, 2, borderSize],
  ];
  walls.forEach(([x, z, w, d]) => {
    const mesh = makeBox(w, 7, d, materials.boundaryDark, x, 3.5, z);
    addBlocker(x, z, w / 2, d / 2, 7, mesh);
  });
  createBoundaryMarkers();
  buildCoverNodes();
  buildNavigationGrid();

  createSkyline();
  createSpawnPoints();
}

function createStreetDetails() {
  const grimeMaterial = new THREE.MeshBasicMaterial({
    color: 0x111416,
    transparent: true,
    opacity: 0.16,
    depthWrite: false,
  });
  const crosswalkMaterial = new THREE.MeshStandardMaterial({
    color: 0xb7bab5,
    roughness: 0.92,
    metalness: 0.01,
  });
  for (let x = -48; x <= 48; x += 48) {
    for (let z = -48; z <= 48; z += 48) {
      for (let i = -2; i <= 2; i += 1) {
        const stripeA = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.018, 5.8), crosswalkMaterial);
        stripeA.position.set(x + i * 1.2, 0.082, z - 6.2);
        stripeA.receiveShadow = true;
        scene.add(stripeA);
        const stripeB = new THREE.Mesh(new THREE.BoxGeometry(5.8, 0.018, 0.55), crosswalkMaterial);
        stripeB.position.set(x - 6.2, 0.084, z + i * 1.2);
        stripeB.receiveShadow = true;
        scene.add(stripeB);
      }
    }
  }

  for (let i = 0; i < 95; i += 1) {
    const decal = new THREE.Mesh(
      new THREE.PlaneGeometry(1.4 + Math.random() * 4.8, 0.4 + Math.random() * 1.8),
      grimeMaterial.clone(),
    );
    decal.material.opacity = 0.04 + Math.random() * 0.13;
    decal.position.set(-82 + Math.random() * 164, 0.088, -82 + Math.random() * 164);
    decal.rotation.x = -Math.PI / 2;
    decal.rotation.z = Math.random() * Math.PI;
    scene.add(decal);
  }

  for (let i = 0; i < 18; i += 1) {
    const cover = new THREE.Mesh(
      new THREE.CylinderGeometry(0.34, 0.34, 0.035, 20),
      new THREE.MeshStandardMaterial({ color: 0x161a1d, roughness: 0.6, metalness: 0.42 }),
    );
    cover.position.set(-76 + Math.random() * 152, 0.105, -76 + Math.random() * 152);
    scene.add(cover);
  }
}

function createBoundaryMarkers() {
  const offset = world.half + 6.75;
  const railHeight = 1.2;
  createBoundaryWarningBands(offset);
  const markerData = [
    [0, -offset, world.size + 12, 0.28],
    [0, offset, world.size + 12, 0.28],
    [-offset, 0, 0.28, world.size + 12],
    [offset, 0, 0.28, world.size + 12],
  ];
  markerData.forEach(([x, z, w, d]) => {
    makeBox(w, 0.28, d, materials.boundary, x, railHeight, z, false, false);
    makeBox(w, 0.16, d, materials.boundary, x, railHeight + 2.2, z, false, false);
  });

  for (let x = -72; x <= 72; x += 12) {
    addBoundaryPost(x, -offset);
    addBoundaryPost(x, offset);
  }
  for (let z = -72; z <= 72; z += 12) {
    addBoundaryPost(-offset, z);
    addBoundaryPost(offset, z);
  }

  const cornerGeo = new THREE.BoxGeometry(2.6, 4.2, 2.6);
  for (const x of [-offset, offset]) {
    for (const z of [-offset, offset]) {
      const tower = new THREE.Mesh(cornerGeo, materials.boundary);
      tower.position.set(x, 2.1, z);
      tower.castShadow = true;
      tower.receiveShadow = true;
      scene.add(tower);
      const light = new THREE.PointLight(0xffcf54, 1.5, 18, 2.6);
      light.position.set(x, 4.8, z);
      light.castShadow = false;
      scene.add(light);
      world.lamps.push(light);
    }
  }
}

function createBoundaryWarningBands(offset) {
  const warningMat = new THREE.MeshBasicMaterial({
    color: 0xd4a85c,
    transparent: true,
    opacity: 0.38,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x121518, roughness: 0.72, metalness: 0.18 });
  const inner = offset - 3.15;
  [
    [0, -inner, world.size + 4, 0.18],
    [0, inner, world.size + 4, 0.18],
    [-inner, 0, 0.18, world.size + 4],
    [inner, 0, 0.18, world.size + 4],
  ].forEach(([x, z, w, d]) => {
    makeBox(w, 0.035, d, warningMat, x, 0.115, z, false, false);
    makeBox(w, 0.03, d * 3.4, darkMat, x, 0.105, z, true, false);
  });

  for (let n = -78; n <= 78; n += 12) {
    const chevrons = [
      [n, -inner + 0.42, 2.3, 0.22, 0.68],
      [n, inner - 0.42, 2.3, 0.22, -0.68],
      [-inner + 0.42, n, 0.22, 2.3, -0.68],
      [inner - 0.42, n, 0.22, 2.3, 0.68],
    ];
    chevrons.forEach(([x, z, w, d, rot]) => {
      const mark = makeBox(w, 0.04, d, warningMat, x, 0.145, z, false, false);
      mark.rotation.y = rot;
    });
  }
}

function addBoundaryPost(x, z) {
  const post = makeBox(0.42, 3.1, 0.42, materials.boundary, x, 1.55, z, false, true);
  post.rotation.y = Math.PI * 0.25;
}

function buildCoverNodes() {
  world.coverNodes.length = 0;
  const sideDefinitions = [
    { axis: "x", sign: -1, normal: new THREE.Vector3(-1, 0, 0) },
    { axis: "x", sign: 1, normal: new THREE.Vector3(1, 0, 0) },
    { axis: "z", sign: -1, normal: new THREE.Vector3(0, 0, -1) },
    { axis: "z", sign: 1, normal: new THREE.Vector3(0, 0, 1) },
  ];

  world.blockers.forEach((blocker) => {
    const halfX = (blocker.maxX - blocker.minX) * 0.5;
    const halfZ = (blocker.maxZ - blocker.minZ) * 0.5;
    const width = halfX * 2;
    const depth = halfZ * 2;
    if (blocker.height < 0.9 || blocker.height > 3.9) return;
    if (width > 9.5 || depth > 9.5) return;

    sideDefinitions.forEach((side) => {
      const length = side.axis === "x" ? depth : width;
      const samples = length > 3.4 ? [-0.34, 0, 0.34] : [0];
      samples.forEach((sample) => {
        const clearance = 0.95;
        const x = side.axis === "x"
          ? (side.sign < 0 ? blocker.minX - clearance : blocker.maxX + clearance)
          : THREE.MathUtils.lerp(blocker.minX + 0.55, blocker.maxX - 0.55, sample + 0.5);
        const z = side.axis === "z"
          ? (side.sign < 0 ? blocker.minZ - clearance : blocker.maxZ + clearance)
          : THREE.MathUtils.lerp(blocker.minZ + 0.55, blocker.maxZ - 0.55, sample + 0.5);
        const position = new THREE.Vector3(x, 0, z);
        if (!isTacticalPointClear(position, 0.72)) return;
        if (world.coverNodes.some((node) => node.position.distanceTo(position) < 1.45)) return;
        world.coverNodes.push({
          position,
          normal: side.normal.clone(),
          blocker,
          claimedBy: null,
          heat: 0,
        });
      });
    });
  });
}

function isTacticalPointClear(position, radius = 0.7) {
  if (Math.abs(position.x) > world.half - radius || Math.abs(position.z) > world.half - radius) return false;
  return !isBlockedAt(position.x, position.z, radius);
}

function buildNavigationGrid() {
  const nav = world.nav;
  nav.cellSize = NAV_CELL_SIZE;
  nav.originX = -world.half;
  nav.originZ = -world.half;
  nav.width = Math.ceil(world.size / nav.cellSize);
  nav.height = Math.ceil(world.size / nav.cellSize);
  nav.nodes = [];
  nav.grid = Array.from({ length: nav.height }, () => Array(nav.width).fill(null));

  for (let z = 0; z < nav.height; z += 1) {
    for (let x = 0; x < nav.width; x += 1) {
      const worldX = nav.originX + x * nav.cellSize + nav.cellSize * 0.5;
      const worldZ = nav.originZ + z * nav.cellSize + nav.cellSize * 0.5;
      const walkable = isNavigationPointWalkable(worldX, worldZ);
      const node = {
        x,
        z,
        index: z * nav.width + x,
        position: new THREE.Vector3(worldX, 0, worldZ),
        walkable,
        neighbors: [],
      };
      nav.grid[z][x] = node;
      nav.nodes.push(node);
    }
  }

  for (const node of nav.nodes) {
    if (!node.walkable) continue;
    for (let dz = -1; dz <= 1; dz += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dz === 0) continue;
        const neighbor = getNavNode(node.x + dx, node.z + dz);
        if (!neighbor?.walkable) continue;
        if (dx !== 0 && dz !== 0) {
          const sideA = getNavNode(node.x + dx, node.z);
          const sideB = getNavNode(node.x, node.z + dz);
          if (!sideA?.walkable || !sideB?.walkable) continue;
        }
        node.neighbors.push({
          node: neighbor,
          cost: dx !== 0 && dz !== 0 ? Math.SQRT2 : 1,
        });
      }
    }
  }

  nav.ready = true;
  nav.dirty = false;
}

function ensureNavigationGrid() {
  if (!world.nav.ready || world.nav.dirty) buildNavigationGrid();
}

function isNavigationPointWalkable(x, z) {
  if (Math.abs(x) > world.half - NAV_AGENT_RADIUS || Math.abs(z) > world.half - NAV_AGENT_RADIUS) return false;
  return !world.enemyBlockers.some((blocker) => {
    const closestX = clamp(x, blocker.minX, blocker.maxX);
    const closestZ = clamp(z, blocker.minZ, blocker.maxZ);
    const dx = x - closestX;
    const dz = z - closestZ;
    return dx * dx + dz * dz < NAV_AGENT_RADIUS * NAV_AGENT_RADIUS;
  });
}

function getNavNode(x, z) {
  if (x < 0 || z < 0 || x >= world.nav.width || z >= world.nav.height) return null;
  return world.nav.grid[z]?.[x] ?? null;
}

function getClosestNavNode(position, maxRing = 5) {
  ensureNavigationGrid();
  const nav = world.nav;
  const baseX = Math.floor((position.x - nav.originX) / nav.cellSize);
  const baseZ = Math.floor((position.z - nav.originZ) / nav.cellSize);
  const direct = getNavNode(baseX, baseZ);
  if (direct?.walkable) return direct;

  let best = null;
  let bestDistance = Infinity;
  for (let ring = 1; ring <= maxRing; ring += 1) {
    for (let z = baseZ - ring; z <= baseZ + ring; z += 1) {
      for (let x = baseX - ring; x <= baseX + ring; x += 1) {
        if (Math.abs(x - baseX) !== ring && Math.abs(z - baseZ) !== ring) continue;
        const node = getNavNode(x, z);
        if (!node?.walkable) continue;
        const distance = node.position.distanceToSquared(position);
        if (distance < bestDistance) {
          best = node;
          bestDistance = distance;
        }
      }
    }
    if (best) return best;
  }
  return best;
}

function findNavPath(start, end) {
  const startNode = getClosestNavNode(start);
  const goalNode = getClosestNavNode(end);
  if (!startNode || !goalNode) return [];
  if (startNode === goalNode) return [goalNode.position.clone()];

  const open = [startNode];
  const cameFrom = new Map();
  const gScore = new Map([[startNode, 0]]);
  const fScore = new Map([[startNode, navHeuristic(startNode, goalNode)]]);
  const openSet = new Set(open);
  const closed = new Set();
  let iterations = 0;
  const maxIterations = world.nav.nodes.length;

  while (open.length && iterations < maxIterations) {
    iterations += 1;
    let currentIndex = 0;
    let current = open[0];
    let currentScore = fScore.get(current) ?? Infinity;
    for (let i = 1; i < open.length; i += 1) {
      const candidateScore = fScore.get(open[i]) ?? Infinity;
      if (candidateScore < currentScore) {
        current = open[i];
        currentIndex = i;
        currentScore = candidateScore;
      }
    }

    if (current === goalNode) return smoothNavPath(reconstructNavPath(cameFrom, current), start, end);
    open.splice(currentIndex, 1);
    openSet.delete(current);
    closed.add(current);

    for (const edge of current.neighbors) {
      const neighbor = edge.node;
      if (closed.has(neighbor)) continue;
      const tentative = (gScore.get(current) ?? Infinity) + edge.cost + getNavOccupancyCost(neighbor);
      if (tentative >= (gScore.get(neighbor) ?? Infinity)) continue;
      cameFrom.set(neighbor, current);
      gScore.set(neighbor, tentative);
      fScore.set(neighbor, tentative + navHeuristic(neighbor, goalNode));
      if (!openSet.has(neighbor)) {
        open.push(neighbor);
        openSet.add(neighbor);
      }
    }
  }

  return [];
}

function navHeuristic(a, b) {
  const dx = Math.abs(a.x - b.x);
  const dz = Math.abs(a.z - b.z);
  const diagonal = Math.min(dx, dz);
  return Math.SQRT2 * diagonal + Math.abs(dx - dz);
}

function getNavOccupancyCost(node) {
  let cost = 0;
  for (const enemy of enemies) {
    if (!enemy.alive) continue;
    const distanceSq = enemy.position.distanceToSquared(node.position);
    if (distanceSq < 16) cost += 1.8;
    if (distanceSq < 6.25) cost += 4.5;
  }
  return cost;
}

function reconstructNavPath(cameFrom, current) {
  const path = [current.position.clone()];
  while (cameFrom.has(current)) {
    current = cameFrom.get(current);
    path.push(current.position.clone());
  }
  return path.reverse();
}

function smoothNavPath(path, start, end) {
  if (path.length <= 2) return path.concat([end.clone()]);
  const smoothed = [];
  let anchor = start.clone();
  let index = 0;
  while (index < path.length) {
    let nextIndex = index;
    for (let probe = path.length - 1; probe >= index; probe -= 1) {
      if (hasNavigationLine(anchor, path[probe])) {
        nextIndex = probe;
        break;
      }
    }
    const point = path[nextIndex].clone();
    smoothed.push(point);
    anchor = point;
    index = nextIndex + 1;
  }
  if (!smoothed.length || smoothed[smoothed.length - 1].distanceTo(end) > world.nav.cellSize * 0.7) {
    if (hasNavigationLine(smoothed[smoothed.length - 1] ?? start, end)) smoothed.push(end.clone());
  }
  return smoothed;
}

function hasNavigationLine(from, to) {
  const delta = tmpVec.subVectors(to, from);
  delta.y = 0;
  const distance = delta.length();
  if (distance < 0.01) return true;
  const steps = Math.max(1, Math.ceil(distance / (world.nav.cellSize * 0.42)));
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const x = THREE.MathUtils.lerp(from.x, to.x, t);
    const z = THREE.MathUtils.lerp(from.z, to.z, t);
    if (!isNavigationPointWalkable(x, z)) return false;
  }
  return true;
}

function createLightPool(x, z, width = 5.8, depth = 3.2, color = 0xd0aa63, opacity = 0.16) {
  const pool = new THREE.Mesh(
    new THREE.PlaneGeometry(width, depth),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  pool.position.set(x, 0.095, z);
  pool.rotation.x = -Math.PI / 2;
  pool.rotation.z = rand() * Math.PI;
  scene.add(pool);
  return pool;
}

function createLamp(x, z) {
  const pole = makeBox(0.22, 4.2, 0.22, materials.darkMetal, x, 2.1, z);
  const cap = makeBox(1.4, 0.18, 0.55, materials.neon, x, 4.25, z);
  pole.castShadow = true;
  cap.castShadow = false;
  createLightPool(x, z, 6.2, 3.4, 0xcaa45f, 0.12);
  const halo = new THREE.Mesh(
    new THREE.PlaneGeometry(1.9, 0.8),
    new THREE.MeshBasicMaterial({
      color: 0xcaa45f,
      transparent: true,
      opacity: 0.2,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    }),
  );
  halo.position.set(x, 4.18, z);
  halo.rotation.y = rand() * Math.PI;
  scene.add(halo);
  if (world.dynamicStreetLights < MAX_DYNAMIC_STREET_LIGHTS) {
    const light = new THREE.PointLight(0xffd08a, 0.62, 13, 2.4);
    light.position.set(x, 4.1, z);
    light.castShadow = false;
    scene.add(light);
    world.lamps.push(light);
    world.dynamicStreetLights += 1;
  }
}

function createCar(x, z, alongX) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  group.rotation.y = alongX ? 0 : Math.PI / 2;

  const body = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.8, 1.75), new THREE.MeshStandardMaterial({
    color: rand() > 0.5 ? 0x973e4b : 0x42617d,
    roughness: 0.46,
    metalness: 0.26,
  }));
  body.position.y = 0.55;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.72, 1.35), materials.glassA);
  cabin.position.set(-0.25, 1.18, 0);
  cabin.castShadow = true;
  group.add(cabin);

  const lightA = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.22, 0.5), materials.neon);
  lightA.position.set(1.96, 0.62, -0.48);
  group.add(lightA);
  const lightB = lightA.clone();
  lightB.position.z = 0.48;
  group.add(lightB);

  scene.add(group);
  return { mesh: group, halfX: alongX ? 2.15 : 1.05, halfZ: alongX ? 1.05 : 2.15 };
}

function createCoverProps() {
  const coverSpots = [
    [-18, 18, 0], [18, 18, Math.PI * 0.5], [-38, -14, 0.1], [42, 12, -0.2],
    [-58, 42, Math.PI * 0.5], [58, -42, Math.PI * 0.5], [14, -38, 0],
    [-12, 58, -0.12], [36, 58, 0.08], [-62, -58, 0.2],
  ];
  coverSpots.forEach(([x, z, rot], index) => {
    if (isBlockedAt(x, z, 2.2)) return;
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    group.rotation.y = rot;
    const barrier = new THREE.Mesh(new THREE.BoxGeometry(3.6, 1.25, 0.55), materials.concrete);
    barrier.position.y = 0.62;
    barrier.castShadow = true;
    barrier.receiveShadow = true;
    group.add(barrier);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(3.7, 0.16, 0.58), index % 2 ? materials.boundary : materials.cyanNeon);
    stripe.position.y = 1.08;
    stripe.castShadow = false;
    group.add(stripe);
    if (index % 3 === 0) {
      const crate = new THREE.Mesh(new THREE.BoxGeometry(1.05, 1.05, 1.05), materials.darkMetal);
      crate.position.set(1.75, 0.55, 0.78);
      crate.castShadow = true;
      crate.receiveShadow = true;
      group.add(crate);
      const band = new THREE.Mesh(new THREE.BoxGeometry(1.12, 0.12, 1.12), materials.gunTrim);
      band.position.copy(crate.position);
      band.position.y += 0.28;
      group.add(band);
    }
    scene.add(group);
    addBlocker(x, z, Math.abs(Math.cos(rot)) > 0.5 ? 1.9 : 0.55, Math.abs(Math.cos(rot)) > 0.5 ? 0.55 : 1.9, 1.25, group);
  });
}

function createUrbanDressing() {
  const utilityMat = new THREE.MeshStandardMaterial({ color: 0x253037, roughness: 0.58, metalness: 0.38 });
  const rubberMat = new THREE.MeshStandardMaterial({ color: 0x0e1114, roughness: 0.76, metalness: 0.08 });
  const posterMat = new THREE.MeshBasicMaterial({ color: 0xd4a85c, transparent: true, opacity: 0.72 });

  const addDumpster = (x, z, rot) => {
    if (isBlockedAt(x, z, 1.7)) return;
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    group.rotation.y = rot;
    const body = new THREE.Mesh(roundedBoxGeometry(2.25, 1.15, 1.1, 0.07, 2), utilityMat);
    body.position.y = 0.66;
    body.castShadow = true;
    body.receiveShadow = true;
    const lid = new THREE.Mesh(roundedBoxGeometry(2.35, 0.12, 1.18, 0.035, 2), materials.darkMetal);
    lid.position.set(0, 1.28, -0.03);
    lid.rotation.x = -0.08;
    const decal = new THREE.Mesh(new THREE.PlaneGeometry(0.82, 0.34), posterMat.clone());
    decal.position.set(0, 0.75, -0.565);
    decal.rotation.y = Math.PI;
    group.add(body, lid, decal);
    for (const sx of [-0.78, 0.78]) {
      for (const sz of [-0.42, 0.42]) {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.12, 10), rubberMat);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(sx, 0.13, sz);
        group.add(wheel);
      }
    }
    scene.add(group);
    addBlocker(x, z, Math.abs(Math.cos(rot)) > 0.5 ? 1.3 : 0.75, Math.abs(Math.cos(rot)) > 0.5 ? 0.75 : 1.3, 1.35, group);
  };

  const addBusShelter = (x, z, rot) => {
    if (isBlockedAt(x, z, 2.2)) return;
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    group.rotation.y = rot;
    const back = new THREE.Mesh(roundedBoxGeometry(3.2, 1.75, 0.12, 0.035, 2), materials.glassA);
    back.position.set(0, 1.08, 0.45);
    const roof = new THREE.Mesh(roundedBoxGeometry(3.55, 0.16, 1.12, 0.035, 2), materials.darkMetal);
    roof.position.set(0, 2.02, 0);
    const bench = new THREE.Mesh(roundedBoxGeometry(2.2, 0.16, 0.42, 0.035, 2), materials.gunTrim);
    bench.position.set(0, 0.62, -0.2);
    group.add(back, roof, bench);
    for (const sx of [-1.45, 1.45]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.95, 0.12), materials.darkMetal);
      post.position.set(sx, 0.98, -0.44);
      post.castShadow = true;
      group.add(post);
    }
    scene.add(group);
    addBlocker(x, z, Math.abs(Math.cos(rot)) > 0.5 ? 1.9 : 0.75, Math.abs(Math.cos(rot)) > 0.5 ? 0.75 : 1.9, 2.2, group);
  };

  const addBollardRow = (x, z, rot, count = 5) => {
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    group.rotation.y = rot;
    for (let i = 0; i < count; i += 1) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.7, 10), materials.boundaryDark);
      post.position.set((i - (count - 1) / 2) * 0.72, 0.35, 0);
      post.castShadow = true;
      group.add(post);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.105, 0.05, 10), materials.boundary);
      cap.position.copy(post.position);
      cap.position.y = 0.72;
      group.add(cap);
    }
    scene.add(group);
  };

  [
    [-46, -30, 0.15], [28, 46, Math.PI * 0.5], [64, 18, -0.1], [-64, 58, Math.PI * 0.5],
  ].forEach(([x, z, rot]) => addDumpster(x, z, rot));
  [
    [-20, 31, 0], [32, -20, Math.PI], [-52, -5, Math.PI * 0.5],
  ].forEach(([x, z, rot]) => addBusShelter(x, z, rot));
  [
    [7.5, 7.8, 0, 7], [-31.5, -31.8, 0, 5], [55.6, -7.5, Math.PI * 0.5, 5], [-55.6, 31.5, Math.PI * 0.5, 5],
  ].forEach(([x, z, rot, count]) => addBollardRow(x, z, rot, count));

  const lockers = [
    [-6.5, -43.5, 0.2, "armor"], [41, 50, -0.25, "ammo"], [-47, 18, Math.PI * 0.5, "ammo"],
  ];
  lockers.forEach(([x, z, rot, drop], index) => {
    if (isBlockedAt(x, z, 1.25)) return;
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    group.rotation.y = rot;
    const cabinet = new THREE.Mesh(roundedBoxGeometry(1.0, 1.35, 0.72, 0.06, 3), utilityMat);
    cabinet.position.y = 0.7;
    cabinet.castShadow = true;
    cabinet.receiveShadow = true;
    const screen = new THREE.Mesh(roundedBoxGeometry(0.58, 0.26, 0.045, 0.018, 2), index % 2 ? materials.neon : materials.cyanNeon);
    screen.position.set(0, 0.98, -0.385);
    const handle = new THREE.Mesh(roundedBoxGeometry(0.08, 0.34, 0.07, 0.02, 2), materials.gunTrim);
    handle.position.set(0.34, 0.62, -0.4);
    group.add(cabinet, screen, handle);
    scene.add(group);
    registerInteractive({
      type: "crate",
      group,
      health: 68,
      maxHealth: 68,
      radius: 0.82,
      blocker: addBlocker(x, z, 0.7, 0.55, 1.45, group),
      accent: index % 2 ? 0xf7c95f : 0x72d6ff,
      drop,
    });
  });
}

function createInteractiveObjects() {
  const barrelSpots = [
    [-22, -43], [44, 34], [-55, 8], [31, -58], [60, -18],
  ];
  barrelSpots.forEach(([x, z], index) => {
    if (isBlockedAt(x, z, 1.4)) return;
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    const barrelMat = new THREE.MeshStandardMaterial({
      color: index % 2 ? 0xa74232 : 0xb96a32,
      roughness: 0.44,
      metalness: 0.28,
      emissive: 0x2d0805,
      emissiveIntensity: 0.18,
    });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.05, 18), barrelMat);
    body.position.y = 0.55;
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);
    const bandA = new THREE.Mesh(new THREE.CylinderGeometry(0.435, 0.435, 0.08, 18), materials.boundary);
    bandA.position.y = 0.86;
    group.add(bandA);
    const bandB = bandA.clone();
    bandB.position.y = 0.28;
    group.add(bandB);
    scene.add(group);
    registerInteractive({
      type: "barrel",
      group,
      health: 46,
      maxHealth: 46,
      radius: 0.55,
      blocker: addBlocker(x, z, 0.55, 0.55, 1.15, group),
      accent: 0xff8f70,
    });
  });

  const crateSpots = [
    [12, -20, 0.2], [-36, 42, -0.15], [50, 8, 0.6], [-14, 67, -0.4],
  ];
  crateSpots.forEach(([x, z, rot], index) => {
    if (isBlockedAt(x, z, 1.35)) return;
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    group.rotation.y = rot;
    const crate = new THREE.Mesh(roundedBoxGeometry(1.25, 1.05, 1.25, 0.055, 3), materials.darkMetal);
    crate.position.y = 0.54;
    crate.castShadow = true;
    crate.receiveShadow = true;
    group.add(crate);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.32, 0.13, 1.32), index % 2 ? materials.cyanNeon : materials.neon);
    stripe.position.y = 0.78;
    group.add(stripe);
    const latch = new THREE.Mesh(roundedBoxGeometry(0.32, 0.22, 0.08, 0.025, 2), materials.gunTrim);
    latch.position.set(0, 0.62, -0.67);
    group.add(latch);
    scene.add(group);
    registerInteractive({
      type: "crate",
      group,
      health: 58,
      maxHealth: 58,
      radius: 0.85,
      blocker: addBlocker(x, z, 0.78, 0.78, 1.15, group),
      accent: index % 2 ? 0x72d6ff : 0xf7c95f,
      drop: index % 2 ? "armor" : "ammo",
    });
  });

  createSecurityGate(0, -30, 5.8, -25.6);
}

function registerInteractive(interactive) {
  interactive.active = true;
  interactive.initialHealth = interactive.health;
  interactive.basePosition = interactive.group.position.clone();
  interactive.baseScale = interactive.group.scale.clone();
  interactive.group.traverse((child) => {
    if (child.isMesh && child.material) {
      if (!child.userData.localInteractiveMaterial) {
        child.material = child.material.clone();
        child.userData.localInteractiveMaterial = true;
      }
      child.userData.baseColor = child.material.color?.getHex?.();
      child.userData.baseEmissive = child.material.emissive?.getHex?.();
      child.userData.baseEmissiveIntensity = child.material.emissiveIntensity ?? 0;
    }
  });
  if (interactive.blocker) interactive.blocker.interactive = interactive;
  world.interactives.push(interactive);
  return interactive;
}

function createSecurityGate(gateX, gateZ, terminalX, terminalZ) {
  if (isBlockedAt(gateX, gateZ, 4.5) || isBlockedAt(terminalX, terminalZ, 1)) return;
  const gate = new THREE.Group();
  gate.position.set(gateX, 0, gateZ);
  const postMat = materials.enemyArmorDark;
  const glowMat = materials.cyanNeon;
  const leftPost = new THREE.Mesh(roundedBoxGeometry(0.35, 2.35, 0.35, 0.035, 2), postMat);
  leftPost.position.set(-3.9, 1.18, 0);
  const rightPost = leftPost.clone();
  rightPost.position.x = 3.9;
  const beam = new THREE.Mesh(roundedBoxGeometry(7.4, 0.26, 0.18, 0.035, 2), glowMat);
  beam.position.set(0, 1.35, 0);
  const lower = beam.clone();
  lower.position.y = 0.72;
  gate.add(leftPost, rightPost, beam, lower);
  scene.add(gate);
  const gateBlocker = addBlocker(gateX, gateZ, 4.2, 0.36, 2.5, gate);

  const terminal = new THREE.Group();
  terminal.position.set(terminalX, 0, terminalZ);
  terminal.rotation.y = -0.35;
  const pedestal = new THREE.Mesh(roundedBoxGeometry(0.48, 0.88, 0.42, 0.04, 2), materials.enemyArmorDark);
  pedestal.position.y = 0.44;
  pedestal.castShadow = true;
  terminal.add(pedestal);
  const screen = new THREE.Mesh(roundedBoxGeometry(0.48, 0.28, 0.05, 0.02, 2), materials.cyanNeon);
  screen.position.set(0, 0.78, -0.24);
  terminal.add(screen);
  scene.add(terminal);

  const gateInteractive = registerInteractive({
    type: "gate",
    group: gate,
    health: Infinity,
    maxHealth: Infinity,
    radius: 4.2,
    blocker: gateBlocker,
    accent: 0x72d6ff,
    open: false,
  });
  registerInteractive({
    type: "terminal",
    group: terminal,
    health: 28,
    maxHealth: 28,
    radius: 0.75,
    blocker: addBlocker(terminalX, terminalZ, 0.55, 0.55, 1.1, terminal),
    accent: 0x72d6ff,
    linkedGate: gateInteractive,
  });
}

function resetInteractiveObjects() {
  world.interactives.forEach((interactive) => {
    interactive.active = true;
    interactive.health = interactive.initialHealth;
    interactive.group.visible = true;
    interactive.group.position.copy(interactive.basePosition);
    interactive.group.scale.copy(interactive.baseScale);
    interactive.group.traverse((child) => {
      if (!child.isMesh || !child.material) return;
      if (child.userData.baseColor !== undefined && child.material.color) child.material.color.setHex(child.userData.baseColor);
      if (child.userData.baseEmissive !== undefined && child.material.emissive) {
        child.material.emissive.setHex(child.userData.baseEmissive);
        child.material.emissiveIntensity = child.userData.baseEmissiveIntensity ?? 0;
      }
    });
    if (interactive.type === "gate") interactive.open = false;
    restoreBlocker(interactive.blocker);
  });
}

function addExternalCityProps() {
  if (assetLibrary.propsPlaced || !assetLibrary.models.crateWide || !assetLibrary.models.crateMedium || !assetLibrary.models.targetLarge) return;
  assetLibrary.propsPlaced = true;
  const placements = [
    { key: "crateWide", x: -30, z: 31, s: 1.5, r: 0.2 },
    { key: "crateMedium", x: 30, z: -31, s: 1.35, r: -0.1 },
    { key: "crateWide", x: -54, z: -18, s: 1.35, r: Math.PI * 0.5 },
    { key: "crateMedium", x: 55, z: 35, s: 1.25, r: -0.45 },
    { key: "targetLarge", x: -66, z: 2, s: 1.4, r: Math.PI * 0.5 },
    { key: "targetLarge", x: 66, z: -6, s: 1.4, r: -Math.PI * 0.5 },
  ];
  placements.forEach(({ key, x, z, s, r }) => {
    if (isBlockedAt(x, z, 1.5)) return;
    const model = assetLibrary.models[key].clone(true);
    model.position.set(x, 0, z);
    model.rotation.y = r;
    model.scale.setScalar(s);
    model.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    scene.add(model);
  });
}

function addExternalCityKitProps() {
  const required = ["roadBarrier", "trafficCone", "constructionLight", "industrialTank", "awning", "parasol", "planter", "treeSmall", "highwaySign"];
  if (assetLibrary.cityKitPlaced || required.some((key) => !assetLibrary.models[key])) return;
  assetLibrary.cityKitPlaced = true;
  const placements = [
    { key: "roadBarrier", x: -13.4, z: -54, s: 1.55, r: Math.PI * 0.5, blocker: [1.9, 0.45, 1.2] },
    { key: "roadBarrier", x: -8.8, z: -54, s: 1.55, r: Math.PI * 0.5, blocker: [1.9, 0.45, 1.2] },
    { key: "trafficCone", x: -16.6, z: -51, s: 1.25, r: 0 },
    { key: "trafficCone", x: -5.5, z: -56.8, s: 1.25, r: 0 },
    { key: "constructionLight", x: -11.5, z: -49.4, s: 1.45, r: 0 },
    { key: "industrialTank", x: 49.5, z: -42.5, s: 1.4, r: 0.35, blocker: [1.3, 1.3, 2.4] },
    { key: "industrialTank", x: 55.2, z: -45.8, s: 1.15, r: -0.5, blocker: [1.1, 1.1, 2.0] },
    { key: "awning", x: -25.5, z: 10.2, s: 1.8, r: Math.PI },
    { key: "parasol", x: 18.4, z: 31.6, s: 1.35, r: 0.3, blocker: [0.45, 0.45, 1.7] },
    { key: "planter", x: 15.6, z: 33.6, s: 1.35, r: -0.2, blocker: [0.55, 0.55, 0.8] },
    { key: "planter", x: 21.5, z: 29.7, s: 1.35, r: 0.1, blocker: [0.55, 0.55, 0.8] },
    { key: "treeSmall", x: 58, z: 12, s: 1.8, r: 0, blocker: [0.5, 0.5, 2.4] },
    { key: "treeSmall", x: -52, z: 48, s: 1.9, r: 0, blocker: [0.5, 0.5, 2.4] },
    { key: "highwaySign", x: 4, z: -79, s: 1.4, r: 0, blocker: [1.7, 0.35, 3.8] },
  ];

  placements.forEach(({ key, x, z, s, r, blocker }) => {
    if (isBlockedAt(x, z, blocker ? Math.max(blocker[0], blocker[1]) : 0.4)) return;
    const model = assetLibrary.models[key].clone(true);
    model.position.set(x, 0, z);
    model.rotation.y = r;
    model.scale.setScalar(s);
    model.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    scene.add(model);
    if (blocker) addBlocker(x, z, blocker[0], blocker[1], blocker[2], model);
  });
}

function createSkyline() {
  const ring = new THREE.Group();
  for (let i = 0; i < 72; i += 1) {
    const angle = (i / 72) * Math.PI * 2;
    const radius = 130 + rand() * 45;
    const width = 7 + rand() * 14;
    const depth = 7 + rand() * 14;
    const height = 24 + rand() * 72;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(width, height, depth),
      i % 3 === 0 ? materials.glassB : materials.darkMetal,
    );
    mesh.position.set(Math.cos(angle) * radius, height / 2 - 1, Math.sin(angle) * radius);
    mesh.rotation.y = -angle;
    mesh.receiveShadow = true;
    ring.add(mesh);
  }
  scene.add(ring);
}

function createSpawnPoints() {
  const candidates = [
    [-76, -76], [-48, -82], [-12, -80], [28, -78], [74, -72],
    [-82, -42], [80, -28], [-78, 8], [82, 18], [-74, 55],
    [-36, 78], [8, 82], [48, 76], [78, 58], [-58, 30],
  ];
  candidates.forEach(([x, z]) => {
    if (!isBlockedAt(x, z, 2.3)) {
      world.spawnPoints.push(new THREE.Vector3(x, 0, z));
    }
  });
}

function createWeaponRig() {
  weaponRig.position.set(...weaponView.Pistol.rig.hip);
  camera.add(weaponRig);
  scene.add(camera);
  rebuildWeaponModel();
}

function setWeaponRigScopedHidden(hidden) {
  weaponRig.children.forEach((child) => {
    if (child.name !== "viewmodelLight") child.visible = !hidden;
  });
}

function createEnemyHealthBar(config) {
  const bar = new THREE.Group();
  bar.name = "healthBar";
  bar.position.set(0, config.height + 0.78, 0);
  const background = new THREE.Mesh(
    new THREE.PlaneGeometry(0.94, 0.085),
    new THREE.MeshBasicMaterial({ color: 0x101318, transparent: true, opacity: 0.72, depthWrite: false }),
  );
  const fill = new THREE.Mesh(
    new THREE.PlaneGeometry(0.84, 0.045),
    new THREE.MeshBasicMaterial({ color: 0x65f08c, transparent: true, opacity: 0.95, depthWrite: false }),
  );
  fill.name = "healthFill";
  fill.position.z = 0.004;
  bar.add(background, fill);
  return { bar, fill };
}

function addExternalEnemySuit(group, typeName, config) {
  if (!assetLibrary.enemyModel) return null;

  const suit = SkeletonUtils.clone(assetLibrary.enemyModel);
  suit.name = "enemySuit";
  suit.userData.enemySuit = true;
  const sourceBounds = new THREE.Box3().setFromObject(suit);
  const sourceSize = sourceBounds.getSize(new THREE.Vector3());
  const sourceCenter = sourceBounds.getCenter(new THREE.Vector3());
  const scale = (config.height * (typeName === "heavy" ? 1.02 : 0.96)) / Math.max(0.001, sourceSize.y);
  const skinTexture = assetLibrary.enemySkins[typeName] ?? assetLibrary.enemySkins.trooper;
  const suitMaterial = new THREE.MeshStandardMaterial({
    map: skinTexture ?? null,
    color: skinTexture ? 0xffffff : config.accent,
    roughness: 0.66,
    metalness: 0.06,
  });

  suit.traverse((child) => {
    if (child.isMesh || child.isSkinnedMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
      child.frustumCulled = false;
      child.material = suitMaterial.clone();
    }
  });

  suit.scale.setScalar(scale);
  suit.position.set(
    -sourceCenter.x * scale,
    -sourceBounds.min.y * scale,
    -sourceCenter.z * scale + config.radius * 0.08,
  );
  suit.rotation.y = Math.PI;
  group.add(suit);

  const mixer = new THREE.AnimationMixer(suit);
  const actions = {};
  Object.entries(assetLibrary.enemyAnimations).forEach(([key, clip]) => {
    const action = mixer.clipAction(clip);
    action.enabled = true;
    action.setEffectiveWeight(key === "run" ? 1 : 0);
    action.play();
    actions[key] = action;
  });
  return { suit, mixer, actions };
}

function addExternalWeaponModel(source, weapon) {
  const clone = source.clone(true);
  const baseTint = new THREE.Color(
    weapon.name === "Railgun" ? 0x25363c :
      weapon.name === "Marksman" ? 0x30383a :
        weapon.name === "Shotgun" ? 0x343d3a :
          weapon.name === "Pistol" ? 0x444b50 : 0x30383d,
  );
  const magazineTint = new THREE.Color(0x0f1215);
  const accentGlow = new THREE.Color(weapon.color);
  clone.name = "externalWeapon";
  clone.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = false;
      child.receiveShadow = false;
      if (child.material) {
        child.material = child.material.clone();
        child.material.map = null;
        child.material.color?.copy(child.name.toLowerCase().includes("magazine") ? magazineTint : baseTint);
        child.material.emissive = accentGlow.clone().multiplyScalar(0.035);
        child.material.emissiveIntensity = 0.24;
        child.material.roughness = 0.5;
        child.material.metalness = 0.58;
        child.material.needsUpdate = true;
      }
    }
  });

  const bounds = new THREE.Box3().setFromObject(clone);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  clone.position.sub(center);

  const longest = Math.max(size.x, size.y, size.z);
  const view = weaponView[weapon.name] ?? weaponView.Pistol;
  const modelScale = view.modelScale;
  clone.scale.setScalar(modelScale / Math.max(0.001, longest));
  clone.rotation.set(...view.modelRot);
  clone.position.set(...view.modelPos);
  weaponRig.add(clone);
}

function rebuildWeaponModel() {
  weaponRig.clear();
  const weapon = weapons[player.weaponIndex];
  const viewmodelLight = new THREE.PointLight(0xc8d0d2, 0.58, 2.4, 2.2);
  viewmodelLight.name = "viewmodelLight";
  viewmodelLight.position.set(0.22, 0.18, 0.42);
  weaponRig.add(viewmodelLight);
  const accent = new THREE.MeshStandardMaterial({
    color: weapon.color,
    emissive: weapon.color,
    emissiveIntensity: 0.45,
    roughness: 0.42,
    metalness: 0.24,
  });

  const addBox = (width, height, depth, material, x, y, z, rotation = null) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
    mesh.position.set(x, y, z);
    if (rotation) mesh.rotation.set(rotation.x ?? 0, rotation.y ?? 0, rotation.z ?? 0);
    weaponRig.add(mesh);
    return mesh;
  };
  const addBarrel = (radius, length, x, y, z, material = materials.darkMetal) => {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 18), material);
    mesh.rotation.x = Math.PI / 2;
    mesh.position.set(x, y, z);
    weaponRig.add(mesh);
    return mesh;
  };
  const addScopeOptic = () => {
    if (!weapon.scoped) return;
    const scopeLength = weapon.name === "Rifle" ? 0.38 : weapon.name === "Railgun" ? 0.54 : 0.5;
    const scopeZ = weapon.name === "Rifle" ? -0.2 : -0.26;
    const scopeY = weapon.name === "Rifle" ? 0.34 : 0.36;
    addBox(0.18, 0.045, 0.5, materials.gunTrim, 0, scopeY - 0.1, scopeZ);
    addBarrel(0.072, scopeLength, 0, scopeY, scopeZ, materials.darkMetal);
    addBarrel(0.088, 0.07, 0, scopeY, scopeZ - scopeLength * 0.52, materials.gunTrim);
    addBarrel(0.084, 0.06, 0, scopeY, scopeZ + scopeLength * 0.5, materials.gunTrim);
    const lens = new THREE.Mesh(
      new THREE.CylinderGeometry(0.064, 0.064, 0.014, 20),
      new THREE.MeshBasicMaterial({
        color: 0x9fc8d0,
        transparent: true,
        opacity: 0.38,
        depthWrite: false,
      }),
    );
    lens.rotation.x = Math.PI / 2;
    lens.position.set(0, scopeY, scopeZ - scopeLength * 0.56);
    weaponRig.add(lens);
    const rearGlass = lens.clone();
    rearGlass.position.z = scopeZ + scopeLength * 0.55;
    rearGlass.material = lens.material.clone();
    rearGlass.material.opacity = 0.24;
    weaponRig.add(rearGlass);
  };

  const scale = weapon.name === "Railgun" ? 0.78 : weapon.name === "Marksman" ? 0.76 : weapon.name === "Shotgun" ? 0.78 : weapon.name === "Rifle" ? 0.74 : weapon.name === "SMG" ? 0.7 : 0.7;
  weaponRig.scale.setScalar(scale);

  if (assetLibrary.models[weapon.name]) {
    addExternalWeaponModel(assetLibrary.models[weapon.name], weapon);
    addBox(0.055, 0.028, weapon.name === "Pistol" ? 0.18 : 0.48, materials.darkMetal, 0, 0.165, -0.2);
    addBox(0.07, 0.05, 0.035, materials.darkMetal, 0, 0.205, weapon.name === "Pistol" ? -0.34 : -0.48);
    addBox(0.07, 0.045, 0.035, materials.darkMetal, 0, 0.205, weapon.name === "Pistol" ? 0.0 : -0.02);
    if (weapon.name !== "Pistol") {
      addBox(0.2, 0.07, 0.08, materials.gunTrim, 0, 0.235, -0.18);
      addBox(0.12, 0.045, 0.12, materials.darkMetal, 0, 0.295, -0.18);
      addBox(0.2, 0.035, 0.34, accent, 0, -0.03, -0.36);
    } else {
      addBox(0.12, 0.035, 0.18, accent, 0, -0.04, -0.14);
    }
    if (weapon.name !== "Pistol") {
      addBox(0.52, 0.095, 0.14, materials.darkMetal, 0, -0.08, -0.44);
      addBarrel(0.035, 0.46, 0, 0.07, -0.6);
    }
  } else {
    addBox(0.34, 0.22, 0.78, materials.gunMetal, 0, 0.01, -0.04);
    addBox(0.38, 0.075, 0.62, accent, 0, 0.16, -0.12);
    addBarrel(0.055, 0.68, 0, 0.08, -0.56);
    addBox(0.13, 0.08, 0.08, materials.gunTrim, 0, 0.24, -0.38);
    addBox(0.13, 0.08, 0.08, materials.gunTrim, 0, 0.23, 0.18);
    addBox(0.17, 0.38, 0.2, materials.darkMetal, 0.05, -0.27, 0.18, { x: -0.26 });
    addBox(0.42, 0.12, 0.18, materials.darkMetal, 0, -0.08, -0.16);
    addBox(0.28, 0.13, 0.12, materials.gunTrim, -0.26, -0.32, -0.08, { z: -0.2 });

    if (weapon.name === "Rifle") {
      addBox(0.28, 0.18, 0.52, materials.darkMetal, 0, 0, 0.48);
      addBox(0.2, 0.52, 0.22, materials.gunMetal, 0, -0.34, -0.12, { x: 0.12 });
      addBox(0.38, 0.13, 0.22, materials.gunTrim, 0, 0.32, -0.08);
      addBox(0.12, 0.08, 0.3, materials.darkMetal, 0, 0.45, -0.08);
      addBox(0.42, 0.055, 0.72, materials.gunTrim, 0, 0.23, -0.3);
      addBarrel(0.04, 0.92, 0.09, 0.08, -0.62);
      addBarrel(0.04, 0.92, -0.09, 0.08, -0.62);
      addBox(0.58, 0.11, 0.22, accent, 0, -0.12, -0.42);
    }

    if (weapon.name === "Shotgun") {
      addBarrel(0.065, 0.86, 0.08, 0.08, -0.58);
      addBarrel(0.065, 0.86, -0.08, 0.08, -0.58);
      addBox(0.34, 0.14, 0.54, accent, 0, -0.08, -0.34);
      addBox(0.26, 0.2, 0.62, materials.darkMetal, 0, 0, 0.42);
      addBox(0.58, 0.13, 0.16, materials.gunTrim, 0, -0.16, -0.18);
      addBox(0.18, 0.08, 0.72, materials.gunTrim, 0, 0.22, -0.42);
    }

    if (weapon.name === "Pistol") {
      addBox(0.28, 0.08, 0.26, materials.darkMetal, 0, 0.25, -0.08);
      addBox(0.2, 0.12, 0.16, accent, 0, -0.11, 0.05);
      addBox(0.07, 0.07, 0.08, materials.gunTrim, 0, 0.27, -0.33);
    }
  }
  addScopeOptic();

  const grip = weaponView[weapon.name]?.grip ?? weaponView.Pistol.grip;
  const makeVec = ([x, y, z]) => new THREE.Vector3(x, y, z);
  const addCapsuleBetween = (from, to, radius, material) => {
    const start = makeVec(from);
    const end = makeVec(to);
    const direction = end.clone().sub(start);
    const length = Math.max(0.04, direction.length() - radius * 2);
    const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, length, 6, 12), material);
    mesh.position.copy(start.add(end).multiplyScalar(0.5));
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    weaponRig.add(mesh);
    return mesh;
  };
  const addGlove = ({ position, rotation, scale }) => {
    const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.12, 6, 12), materials.glove);
    mesh.position.set(...position);
    mesh.rotation.set(...rotation);
    mesh.scale.set(...scale);
    weaponRig.add(mesh);
    return mesh;
  };
  addCapsuleBetween(grip.rightArm[0], grip.rightArm[1], 0.065, materials.armSleeve);
  addGlove(grip.rightHand);
  addCapsuleBetween(grip.leftArm[0], grip.leftArm[1], 0.06, materials.armSleeve);
  addGlove(grip.leftHand);

  const muzzle = new THREE.Group();
  muzzle.name = "muzzleFlash";
  muzzle.position.set(0, 0.045, -0.9);
  muzzle.userData.opacity = 0;
  const flashMatA = new THREE.MeshBasicMaterial({
    color: 0xfff0a8,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const flashMatB = new THREE.MeshBasicMaterial({
    color: 0xff7a3a,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const flashA = new THREE.Mesh(new THREE.PlaneGeometry(0.58, 0.58), flashMatA);
  const flashB = new THREE.Mesh(new THREE.PlaneGeometry(0.82, 0.2), flashMatB);
  flashB.rotation.z = Math.PI * 0.25;
  const flashLight = new THREE.PointLight(0xffd28a, 0, 6, 2);
  flashLight.name = "muzzleLight";
  muzzle.add(flashA, flashB, flashLight);
  weaponRig.add(muzzle);
}

function createEnemy(typeName, position, assignment = null) {
  const config = enemyTypes[typeName];
  const group = new THREE.Group();
  group.position.copy(position);
  group.position.y = 0;
  const hitboxes = [];

  const addPart = (geometry, material, x, y, z, rotation = null, limb = "", name = "") => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    if (rotation) mesh.rotation.set(rotation.x ?? 0, rotation.y ?? 0, rotation.z ?? 0);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.limb = limb;
    mesh.userData.baseRotation = mesh.rotation.clone();
    mesh.userData.basePosition = mesh.position.clone();
    if (name) mesh.name = name;
    group.add(mesh);
    return mesh;
  };
  const addHitbox = (part, x, y, z, radius, multiplier) => {
    hitboxes.push({
      part,
      local: new THREE.Vector3(x, y, z),
      radius,
      multiplier,
    });
  };
  const addBox = (name, width, height, depth, material, x, y, z, rotation = null, limb = "") =>
    addPart(roundedBoxGeometry(width, height, depth), material, x, y, z, rotation, limb, name);
  const addCapsule = (name, radius, length, material, x, y, z, rotation = null, limb = "") =>
    addPart(new THREE.CapsuleGeometry(radius, length, 7, 14), material, x, y, z, rotation, limb, name);
  const addCylinder = (name, radiusTop, radiusBottom, height, material, x, y, z, rotation = null, limb = "") =>
    addPart(new THREE.CylinderGeometry(radiusTop, radiusBottom, height, 14), material, x, y, z, rotation, limb, name);

  const eyeMaterial = new THREE.MeshStandardMaterial({
    color: config.accent,
    emissive: config.accent,
    emissiveIntensity: 1.6,
    roughness: 0.28,
  });
  const bodyWidth = config.radius * (typeName === "heavy" ? 1.42 : typeName === "scout" ? 0.92 : 1.16);
  const bodyDepth = config.radius * (typeName === "heavy" ? 0.84 : typeName === "scout" ? 0.56 : 0.68);
  const shoulderWidth = config.radius * (typeName === "heavy" ? 2.05 : typeName === "scout" ? 1.38 : 1.72);
  const waistY = config.height * 0.36;
  const chestY = config.height * 0.68;
  const headY = config.height + config.radius * 0.28;
  const suitRig = addExternalEnemySuit(group, typeName, config);

  const body = addCapsule("torsoCore", bodyWidth * 0.34, config.height * 0.34, materials.enemyArmorDark, 0, chestY, 0);
  body.scale.z = 0.78;
  addBox("ribCage", bodyWidth * 0.64, config.height * 0.4, bodyDepth * 0.46, materials.enemyArmorDark, 0, chestY - 0.02, -bodyDepth * 0.08);
  addBox("frontPlate", bodyWidth * 0.84, config.height * 0.3, 0.09, typeName === "heavy" ? materials.enemyArmorLight : materials.armorPlate, 0, chestY + 0.02, -bodyDepth * 0.62);
  addBox("leftColorPanel", bodyWidth * 0.18, config.height * 0.28, 0.095, config.material, -bodyWidth * 0.28, chestY, -bodyDepth * 0.68);
  addBox("rightColorPanel", bodyWidth * 0.18, config.height * 0.28, 0.095, config.material, bodyWidth * 0.28, chestY, -bodyDepth * 0.68);
  addBox("criticalCore", bodyWidth * 0.3, 0.09, 0.118, eyeMaterial, 0, chestY + 0.08, -bodyDepth * 0.74);
  addBox("collar", shoulderWidth * 0.72, 0.12, bodyDepth * 0.82, materials.enemyArmorDark, 0, config.height * 0.9, -bodyDepth * 0.02);
  addBox("pelvis", bodyWidth * 0.78, 0.2, bodyDepth * 0.72, materials.darkMetal, 0, waistY, -bodyDepth * 0.02);
  addBox("backPowerPack", bodyWidth * 0.36, config.height * 0.18, 0.14, materials.enemyArmorDark, 0, chestY, bodyDepth * 0.48);
  addCylinder("leftBackCanister", 0.035, 0.045, config.height * 0.24, materials.gunTrim, -bodyWidth * 0.19, chestY - 0.02, bodyDepth * 0.6, { x: 0.08 });
  addCylinder("rightBackCanister", 0.035, 0.045, config.height * 0.24, materials.gunTrim, bodyWidth * 0.19, chestY - 0.02, bodyDepth * 0.6, { x: -0.08 });
  addHitbox("torso", 0, chestY, -bodyDepth * 0.06, bodyWidth * 0.5, 1);
  addHitbox("core", 0, chestY + 0.08, -bodyDepth * 0.68, config.radius * 0.24, 1.55);
  addHitbox("pelvis", 0, waistY, 0, config.radius * 0.38, 0.9);

  const head = addBox("helmet", config.radius * 0.64, config.radius * 0.56, config.radius * 0.56, materials.enemyArmorDark, 0, headY, -config.radius * 0.02);
  addBox("helmetStripe", config.radius * 0.34, 0.08, 0.07, config.material, 0, headY + config.radius * 0.2, -config.radius * 0.34);
  addBox("visor", config.radius * 0.5, 0.095, 0.07, eyeMaterial, 0, headY + 0.01, -config.radius * 0.36);
  addBox("brow", config.radius * 0.82, 0.09, config.radius * 0.42, materials.enemyArmorDark, 0, headY + config.radius * 0.32, -config.radius * 0.08);
  addBox("jaw", config.radius * 0.46, 0.12, 0.1, materials.enemyArmorDark, 0, headY - config.radius * 0.34, -config.radius * 0.3);
  addHitbox("head", 0, headY, -config.radius * 0.04, config.radius * 0.38, 2.35);

  const shoulderY = config.height * 0.82;
  const armX = shoulderWidth * 0.48;
  addBox("shoulderBar", shoulderWidth, 0.14, bodyDepth * 0.8, materials.enemyArmorDark, 0, shoulderY, 0);
  addBox("leftShoulder", config.radius * 0.44, 0.23, config.radius * 0.48, materials.enemyArmorLight, -armX, shoulderY, -config.radius * 0.02, { z: 0.18 }, "leftArm");
  addBox("rightShoulder", config.radius * 0.44, 0.23, config.radius * 0.48, materials.enemyArmorLight, armX, shoulderY, -config.radius * 0.02, { z: -0.18 }, "rightArm");
  addCapsule("leftUpperArm", config.radius * 0.095, config.height * 0.3, materials.darkMetal, -armX * 1.03, config.height * 0.62, 0.02, { z: 0.12 }, "leftArm");
  addCapsule("rightUpperArm", config.radius * 0.095, config.height * 0.3, materials.darkMetal, armX * 1.03, config.height * 0.62, 0.02, { z: -0.12 }, "rightArm");
  addCapsule("leftForearm", config.radius * 0.1, config.height * 0.26, config.material, -armX * 1.08, config.height * 0.4, -config.radius * 0.12, { x: -0.26, z: -0.08 }, "leftArm");
  addCapsule("rightForearm", config.radius * 0.1, config.height * 0.26, config.material, armX * 1.08, config.height * 0.4, -config.radius * 0.12, { x: -0.26, z: 0.08 }, "rightArm");
  addBox("leftGlove", config.radius * 0.24, 0.15, config.radius * 0.28, materials.glove, -armX * 1.08, config.height * 0.22, -config.radius * 0.22, null, "leftArm");
  addBox("rightGlove", config.radius * 0.24, 0.15, config.radius * 0.28, materials.glove, armX * 1.08, config.height * 0.22, -config.radius * 0.22, null, "rightArm");
  addHitbox("left arm", -armX, config.height * 0.52, -config.radius * 0.08, config.radius * 0.25, 0.72);
  addHitbox("right arm", armX, config.height * 0.52, -config.radius * 0.08, config.radius * 0.25, 0.72);

  const legX = bodyWidth * 0.25;
  addCapsule("leftThigh", config.radius * 0.11, config.height * 0.34, materials.darkMetal, -legX, config.height * 0.23, 0, null, "leftLeg");
  addCapsule("rightThigh", config.radius * 0.11, config.height * 0.34, materials.darkMetal, legX, config.height * 0.23, 0, null, "rightLeg");
  addBox("leftKnee", config.radius * 0.26, 0.09, config.radius * 0.18, eyeMaterial, -legX, config.height * 0.31, -config.radius * 0.22, null, "leftLeg");
  addBox("rightKnee", config.radius * 0.26, 0.09, config.radius * 0.18, eyeMaterial, legX, config.height * 0.31, -config.radius * 0.22, null, "rightLeg");
  addCapsule("leftShin", config.radius * 0.1, config.height * 0.26, config.material, -legX, config.height * 0.1, -config.radius * 0.02, null, "leftLeg");
  addCapsule("rightShin", config.radius * 0.1, config.height * 0.26, config.material, legX, config.height * 0.1, -config.radius * 0.02, null, "rightLeg");
  addBox("leftBoot", config.radius * 0.35, 0.12, config.radius * 0.55, materials.glove, -legX, 0.05, -config.radius * 0.12, null, "leftLeg");
  addBox("rightBoot", config.radius * 0.35, 0.12, config.radius * 0.55, materials.glove, legX, 0.05, -config.radius * 0.12, null, "rightLeg");
  addHitbox("left leg", -legX, config.height * 0.2, -config.radius * 0.02, config.radius * 0.28, 0.78);
  addHitbox("right leg", legX, config.height * 0.2, -config.radius * 0.02, config.radius * 0.28, 0.78);

  if (typeName === "scout") {
    addBox("scoutChestStripe", bodyWidth * 0.14, config.height * 0.28, 0.11, eyeMaterial, 0, chestY, -bodyDepth * 0.76);
    addBox("scoutHelmetFin", config.radius * 0.12, config.radius * 0.32, config.radius * 0.22, config.material, 0, headY + config.radius * 0.42, -config.radius * 0.02);
    addCylinder("leftCommsWire", 0.006, 0.009, 0.18, materials.enemyArmorDark, -config.radius * 0.25, headY + 0.27, -config.radius * 0.02, { z: 0.42 });
    addCylinder("rightCommsWire", 0.006, 0.009, 0.18, materials.enemyArmorDark, config.radius * 0.25, headY + 0.27, -config.radius * 0.02, { z: -0.42 });
    addPart(new THREE.SphereGeometry(0.022, 10, 8), eyeMaterial, -config.radius * 0.3, headY + 0.34, -config.radius * 0.02, null, "", "leftCommsLight");
    addPart(new THREE.SphereGeometry(0.022, 10, 8), eyeMaterial, config.radius * 0.3, headY + 0.34, -config.radius * 0.02, null, "", "rightCommsLight");
  }

  if (config.ranged) {
    addBox("rifleStock", config.radius * 0.42, 0.16, 0.22, materials.darkMetal, config.radius * 0.34, config.height * 0.55, -config.radius * 0.38, { y: -0.08 }, "rightArm");
    addBox("rifleBody", config.radius * 1.35, 0.15, 0.18, materials.gunMetal, 0, config.height * 0.56, -config.radius * 0.74, { y: 0.02 }, "rightArm");
    addCylinder("rifleBarrel", 0.035, 0.035, config.radius * 0.92, materials.darkMetal, 0, config.height * 0.57, -config.radius * 1.18, { x: Math.PI / 2 }, "rightArm");
    addBox("rifleAccent", config.radius * 0.42, 0.055, 0.08, eyeMaterial, -config.radius * 0.2, config.height * 0.66, -config.radius * 0.74, null, "rightArm");
    addBox("trooperRadio", config.radius * 0.28, config.height * 0.2, 0.09, materials.gunTrim, bodyWidth * 0.42, chestY + 0.02, bodyDepth * 0.42);
    addBox("trooperRankLight", config.radius * 0.24, 0.045, 0.055, eyeMaterial, bodyWidth * 0.42, chestY + config.height * 0.15, bodyDepth * 0.5);
  }

  if (typeName === "heavy") {
    addBox("heavyShield", config.radius * 0.88, config.height * 0.7, 0.12, materials.armorPlate, -config.radius * 1.16, config.height * 0.55, -config.radius * 0.42, { z: 0.08 }, "leftArm");
    addBox("shieldWindow", config.radius * 0.4, 0.12, 0.13, eyeMaterial, -config.radius * 1.16, config.height * 0.72, -config.radius * 0.5, { z: 0.08 }, "leftArm");
    addBox("heavyCollar", config.radius * 1.34, 0.16, config.radius * 0.58, config.material, 0, config.height * 1.0, 0);
    addBox("heavyCore", config.radius * 0.34, 0.34, 0.12, eyeMaterial, 0, chestY + 0.08, -bodyDepth * 0.82);
    addHitbox("shield", -config.radius * 1.16, config.height * 0.55, -config.radius * 0.42, config.radius * 0.42, 0.48);
  }

  const groundRing = new THREE.Mesh(
    new THREE.TorusGeometry(config.radius * 0.78, 0.018, 8, 36),
    new THREE.MeshBasicMaterial({
      color: config.accent,
      transparent: true,
      opacity: 0.48,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  groundRing.name = "enemyGroundRing";
  groundRing.rotation.x = Math.PI / 2;
  groundRing.position.y = 0.035;
  group.add(groundRing);

  const healthBar = createEnemyHealthBar(config);
  group.add(healthBar.bar);
  scene.add(group);
  const squad = assignment?.squadId ? getSquad(assignment.squadId) : null;
  const enemy = {
    typeName,
    config,
    group,
    body,
    head,
    suit: suitRig?.suit ?? null,
    mixer: suitRig?.mixer ?? null,
    actions: suitRig?.actions ?? null,
    animState: "run",
    healthBar: healthBar.bar,
    healthFill: healthBar.fill,
    hitboxes,
    position: group.position,
    velocity: new THREE.Vector3(),
    health: config.health + game.wave * 7,
    maxHealth: config.health + game.wave * 7,
    radius: config.radius,
    attackCooldown: 0.4 + rand() * 0.9,
    retargetTimer: 0,
    pathAngle: rand() * Math.PI * 2,
    tacticalTimer: 0.6 + rand() * 1.2,
    strafeDir: rand() > 0.5 ? 1 : -1,
    squadId: assignment?.squadId ?? null,
    squadRole: assignment?.role ?? getFallbackSquadRole(typeName),
    squadIndex: assignment?.index ?? 0,
    isSquadLeader: assignment?.leader ?? false,
    intent: "advance",
    intentTimer: 0,
    intentPoint: position.clone(),
    coverNode: null,
    lastKnownPlayer: player.position.clone(),
    sightTimer: 0,
    lostSightTimer: 0,
    morale: 1,
    burstShots: 0,
    repositionCooldown: 0.5 + rand() * 1.2,
    flankCommit: 0,
    navPath: [],
    navTarget: null,
    navRefresh: 0,
    navStuckTimer: 0,
    navLastPosition: position.clone(),
    stun: 0,
    hitReact: 0,
    hitReactMax: 0,
    hitVectorLocal: new THREE.Vector3(0, 0, 1),
    limpTimer: 0,
    muzzleLocal: config.ranged ? new THREE.Vector3(0, config.height * 0.57, -config.radius * 1.66) : null,
    alive: true,
  };
  enemies.push(enemy);
  if (squad) squad.members.add(enemy);
}

function resetGame() {
  enemies.splice(0).forEach((enemy) => {
    releaseCoverNode(enemy);
    scene.remove(enemy.group);
  });
  pendingSpawns.length = 0;
  projectiles.splice(0).forEach((projectile) => scene.remove(projectile.mesh));
  effects.splice(0).forEach((effect) => {
    if (effect.object) scene.remove(effect.object);
  });
  world.pickups.splice(0).forEach((pickup) => scene.remove(pickup.group));
  world.decals.splice(0).forEach((decal) => scene.remove(decal));
  resetInteractiveObjects();
  game.squads.length = 0;
  game.nextSquadId = 1;
  game.squadDirectorTimer = 0;

  player.position.set(0, 1.7, 34);
  player.velocity.set(0, 0, 0);
  player.yaw = 0;
  player.pitch = 0;
  player.health = 100;
  player.armor = 35;
  player.score = 0;
  player.kills = 0;
  player.invulnerable = 0;
  player.weaponIndex = 0;
  player.alive = true;
  player.recoil = 0;
  player.recoilSide = 0;
  player.recoilRoll = 0;
  player.weaponKick = 0;
  player.weaponKickSide = 0;
  player.weaponCycle = 0;
  player.weaponSwitch = 0;
  player.adsAmount = 0;
  player.sprintAmount = 0;
  player.swayX = 0;
  player.swayY = 0;
  input.mouseDown = false;
  input.ads = false;
  input.fireQueued = false;
  input.reloadRequested = false;
  input.switchTo = null;
  input.lookX = 0;
  input.lookY = 0;
  weapons.forEach((weapon) => {
    weapon.ammo = weapon.magazine;
    weapon.reserve = weapon.initialReserve;
    weapon.shotCooldown = 0;
    weapon.reloading = 0;
    weapon.reloadStage = 0;
    weapon.reloadProgress = 0;
  });

  game.wave = 1;
  game.waveCooldown = 0;
  game.spawnBudget = 6;
  game.elapsed = 0;
  game.shake = 0;
  game.hudTimer = 0;
  showNotice("Wave 1 incoming. Barrels explode, crates drop gear, relays open gates.");
  rebuildWeaponModel();
  spawnWave();
  updateHud();
}

function setGameState(state) {
  game.state = state;
  ui.startScreen.classList.toggle("hidden", state !== "menu");
  ui.pauseScreen.classList.toggle("hidden", state !== "paused");
  ui.gameOverScreen.classList.toggle("hidden", state !== "gameover");
  ui.hud.classList.toggle("hidden", state === "menu");
}

function startMission() {
  initAudio();
  resetGame();
  setGameState("playing");
  requestPointer();
}

function requestPointer() {
  if (document.pointerLockElement !== canvas) {
    canvas.requestPointerLock?.();
  }
}

function spawnWave() {
  const activeCap = getEnemyCap();
  const count = Math.min(activeCap, 2 + Math.floor(game.wave * 0.55));
  const squad = buildWaveSquad(count);
  const anchor = chooseSpawnPoint();
  const squadPlan = createSquadPlan(squad, anchor, "wave");
  squad.forEach((type, index) => {
    const point = chooseSquadSpawnPoint(anchor, index);
    queueEnemySpawn(type, point, 0.72 + index * 0.52, squadPlan.assignments[index]);
  });
  game.spawnBudget = Math.min(3, Math.max(1, Math.floor(game.wave * 0.62)));
  game.waveCooldown = 5.8;
}

function getEnemyCap() {
  return Math.min(6, 3 + Math.floor(game.wave / 3));
}

function buildWaveSquad(count) {
  const squad = [];
  for (let i = 0; i < count; i += 1) {
    const typeRoll = rand();
    let type = "scout";
    if (game.wave > 1 && (i === count - 1 || typeRoll > 0.52)) type = "trooper";
    if (game.wave > 4 && i === 0 && typeRoll > 0.74) type = "heavy";
    if (game.wave > 6 && typeRoll > 0.88) type = "heavy";
    squad.push(type);
  }
  return squad;
}

function createSquadPlan(types, anchor, purpose = "wave") {
  const id = game.nextSquadId;
  game.nextSquadId += 1;
  const leaderIndex = chooseSquadLeaderIndex(types);
  const flankDir = rand() > 0.5 ? 1 : -1;
  const assignments = assignSquadRoles(types, leaderIndex).map((role, index) => ({
    squadId: id,
    role,
    index,
    leader: index === leaderIndex,
  }));
  const squad = {
    id,
    purpose,
    anchor: anchor.clone(),
    flankDir,
    assignments,
    members: new Set(),
    lastKnownPlayer: player.position.clone(),
    memoryAge: 99,
    hasSight: false,
    pressure: 0,
    pressureRole: assignments.find((assignment) => assignment.role === "charger")?.role ? "charger" : "flanker",
    order: "enter",
    orderTimer: 0.4,
    suppressors: 0,
    flankers: 0,
    aliveCount: 0,
  };
  game.squads.push(squad);
  return squad;
}

function chooseSquadLeaderIndex(types) {
  const heavyIndex = types.indexOf("heavy");
  if (heavyIndex >= 0) return heavyIndex;
  const trooperIndex = types.indexOf("trooper");
  if (trooperIndex >= 0) return trooperIndex;
  return 0;
}

function assignSquadRoles(types, leaderIndex) {
  const roles = new Array(types.length).fill("support");
  if (types.length === 0) return roles;
  roles[leaderIndex] = "leader";

  const assignFirst = (predicate, role) => {
    const index = types.findIndex((type, i) => i !== leaderIndex && roles[i] === "support" && predicate(type));
    if (index >= 0) roles[index] = role;
  };

  assignFirst((type) => type === "trooper", "suppressor");
  assignFirst((type) => type === "scout", "flanker");
  assignFirst((type) => type === "heavy" || type === "scout", "charger");

  roles.forEach((role, index) => {
    if (role !== "support") return;
    roles[index] = types[index] === "trooper" ? "defender" : types[index] === "scout" ? "flanker" : "charger";
  });
  return roles;
}

function getFallbackSquadRole(typeName) {
  if (typeName === "trooper") return "suppressor";
  if (typeName === "heavy") return "charger";
  return "flanker";
}

function getSquad(id) {
  return game.squads.find((squad) => squad.id === id) ?? null;
}

function chooseSpawnPoint() {
  let best = world.spawnPoints[0] ?? new THREE.Vector3(0, 0, -70);
  let bestScore = -Infinity;
  for (let i = 0; i < world.spawnPoints.length * 2; i += 1) {
    const point = world.spawnPoints[Math.floor(rand() * world.spawnPoints.length)];
    const dist = point.distanceTo(player.position);
    const visiblePenalty = hasLineOfSight(point, player.position, 1.1, true) ? 90 : 0;
    const crowdPenalty = enemies.reduce((sum, enemy) => sum + (enemy.position.distanceTo(point) < 18 ? 28 : 0), 0);
    const pendingPenalty = pendingSpawns.reduce((sum, spawn) => sum + (spawn.point.distanceTo(point) < 18 ? 34 : 0), 0);
    const rangePenalty = Math.abs(dist - 68) * 0.65;
    const score = dist - rangePenalty - visiblePenalty - crowdPenalty - pendingPenalty + rand() * 10;
    if (score > bestScore && dist > 38) {
      best = point;
      bestScore = score;
    }
  }
  return best.clone();
}

function chooseSquadSpawnPoint(anchor, index) {
  let best = anchor.clone();
  let bestScore = -Infinity;
  for (const point of world.spawnPoints) {
    const distToAnchor = point.distanceTo(anchor);
    const distToPlayer = point.distanceTo(player.position);
    if (distToAnchor > 24 || distToPlayer < 36) continue;
    const visiblePenalty = hasLineOfSight(point, player.position, 1.1, true) ? 60 : 0;
    const crowdPenalty = enemies.reduce((sum, enemy) => sum + (enemy.position.distanceTo(point) < 10 ? 18 : 0), 0);
    const pendingPenalty = pendingSpawns.reduce((sum, spawn) => sum + (spawn.point.distanceTo(point) < 10 ? 22 : 0), 0);
    const spacingBonus = Math.min(18, distToAnchor) * 0.55;
    const score = spacingBonus + distToPlayer * 0.08 - visiblePenalty - crowdPenalty - pendingPenalty + rand() * 6 - index * 0.25;
    if (score > bestScore) {
      best = point;
      bestScore = score;
    }
  }
  return best.clone();
}

function maybeSpawnReinforcement(dt) {
  if (game.spawnBudget <= 0 || enemies.length + pendingSpawns.length >= getEnemyCap()) return;
  game.waveCooldown -= dt;
  if (game.waveCooldown > 0) return;
  if (enemies.length >= Math.max(3, getEnemyCap() - 1)) {
    game.waveCooldown = 2.8;
    return;
  }
  const typeRoll = rand();
  let type = typeRoll > 0.66 ? "trooper" : "scout";
  if (game.wave > 5 && typeRoll > 0.9) type = "heavy";
  const anchor = chooseSpawnPoint();
  const supportTypes = type === "heavy" ? ["heavy", "trooper"] : [type, type === "scout" ? "trooper" : "scout"];
  const squadPlan = createSquadPlan(supportTypes, anchor, "reinforcement");
  supportTypes.forEach((supportType, index) => {
    queueEnemySpawn(supportType, chooseSquadSpawnPoint(anchor, index), 1.1 + index * 0.45, squadPlan.assignments[index]);
  });
  game.spawnBudget -= 1;
  game.waveCooldown = clamp(6.8 - game.wave * 0.2, 3.8, 6.8);
}

function queueEnemySpawn(typeName, point, delay = 0.75, assignment = null) {
  const spawnPoint = point.clone();
  pendingSpawns.push({ typeName, point: spawnPoint, timer: delay, assignment });
  createSpawnTelegraph(spawnPoint, typeName, delay);
}

function updatePendingSpawns(dt) {
  for (let i = pendingSpawns.length - 1; i >= 0; i -= 1) {
    const spawn = pendingSpawns[i];
    spawn.timer -= dt;
    if (spawn.timer > 0) continue;
    createEnemy(spawn.typeName, spawn.point, spawn.assignment);
    pendingSpawns.splice(i, 1);
  }
}

function createSpawnTelegraph(position, typeName, delay) {
  const config = enemyTypes[typeName];
  const color = config.accent;
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(config.radius * 0.8, 0.022, 8, 36),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  ring.position.set(position.x, 0.06, position.z);
  ring.rotation.x = Math.PI / 2;
  scene.add(ring);
  effects.push({ object: ring, life: delay + 0.32, maxLife: delay + 0.32, type: "spawnTelegraph", grow: 1.5 });

  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(config.radius * 0.22, config.radius * 0.38, config.height * 1.15, 20, 1, true),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    }),
  );
  beam.position.set(position.x, config.height * 0.56, position.z);
  scene.add(beam);
  effects.push({ object: beam, life: delay + 0.22, maxLife: delay + 0.22, type: "spawnTelegraph", grow: 0.55 });
}

function updatePlayer(dt) {
  const sprintHeld = input.keys.has("shiftleft") || input.keys.has("shiftright");
  const crouching = input.keys.has("controlleft") || input.keys.has("controlright");
  const weapon = weapons[player.weaponIndex];
  const accel = player.onGround ? 20 : 6;

  flatForward.set(-Math.sin(player.yaw), 0, -Math.cos(player.yaw)).normalize();
  flatRight.set(Math.cos(player.yaw), 0, -Math.sin(player.yaw)).normalize();
  const move = new THREE.Vector3();
  if (input.keys.has("keyw")) move.add(flatForward);
  if (input.keys.has("keys")) move.sub(flatForward);
  if (input.keys.has("keyd")) move.add(flatRight);
  if (input.keys.has("keya")) move.sub(flatRight);
  const moving = move.lengthSq() > 0;
  if (moving) move.normalize();
  const sprinting = sprintHeld && moving && !input.ads && weapon.reloading <= 0;
  const targetSpeed = crouching ? 4.0 : sprinting ? 8.6 : 6.1;

  const desiredX = move.x * targetSpeed;
  const desiredZ = move.z * targetSpeed;
  player.velocity.x = damp(player.velocity.x, desiredX, accel, dt);
  player.velocity.z = damp(player.velocity.z, desiredZ, accel, dt);
  player.velocity.y -= 24 * dt;

  if (input.keys.has("space") && player.onGround) {
    player.velocity.y = 8.2;
    player.onGround = false;
  }

  const next = player.position.clone();
  moveWithCollisions(next, player.velocity, player.radius, dt, true);
  player.position.copy(next);

  const horizontalSpeed = Math.hypot(player.velocity.x, player.velocity.z);
  player.bobTime += horizontalSpeed * dt * (player.onGround ? 1 : 0.25);
  player.recoil = damp(player.recoil, 0, 16, dt);
  player.recoilSide = damp(player.recoilSide, 0, 18, dt);
  player.recoilRoll = damp(player.recoilRoll, 0, 18, dt);
  player.weaponKick = damp(player.weaponKick, 0, 18, dt);
  player.weaponKickSide = damp(player.weaponKickSide, 0, 16, dt);
  player.weaponCycle = damp(player.weaponCycle, 0, 22, dt);
  player.weaponSwitch = damp(player.weaponSwitch, 0, 9, dt);
  player.sprintAmount = damp(player.sprintAmount, sprinting ? 1 : 0, 10, dt);
  player.adsAmount = damp(player.adsAmount, input.ads ? 1 : 0, 14, dt);
  player.swayX = damp(player.swayX, clamp(input.lookX * -0.00042, -0.035, 0.035), 10, dt);
  player.swayY = damp(player.swayY, clamp(input.lookY * -0.00042, -0.026, 0.026), 10, dt);
  input.lookX = damp(input.lookX, 0, 24, dt);
  input.lookY = damp(input.lookY, 0, 24, dt);
  player.invulnerable = Math.max(0, player.invulnerable - dt);
  player.hurtPulse = Math.max(0, player.hurtPulse - dt);

  const bob = Math.sin(player.bobTime * 2.2) * 0.035 + Math.sin(player.bobTime * 4.4) * 0.012;
  const targetEye = crouching ? 1.28 : player.height;
  camera.position.set(player.position.x, player.position.y - player.height + targetEye + bob, player.position.z);
  camera.rotation.y = player.yaw;
  camera.rotation.x = player.pitch - player.recoil * 0.18 + Math.sin(game.elapsed * 37) * game.shake * 0.24;
  camera.rotation.z = Math.cos(game.elapsed * 31) * game.shake * 0.1 + player.recoilRoll * 0.08;
  const scopeProfile = weapon.scoped ? scopeProfiles[weapon.name] : null;
  const fullyScoped = Boolean(scopeProfile) && player.adsAmount > 0.72;
  const targetFov = input.ads ? (scopeProfile?.fov ?? 55) : 74;
  camera.fov = damp(camera.fov, targetFov, 12, dt);
  camera.updateProjectionMatrix();
  game.shake = damp(game.shake, 0, 18, dt);

  const view = weaponView[weapon.name] ?? weaponView.Pistol;
  const adsX = THREE.MathUtils.lerp(view.rig.hip[0], view.rig.ads[0], player.adsAmount);
  const adsY = THREE.MathUtils.lerp(view.rig.hip[1], view.rig.ads[1], player.adsAmount);
  const adsZ = THREE.MathUtils.lerp(view.rig.hip[2], view.rig.ads[2], player.adsAmount);
  const reloadProgress = weapon.reloading > 0 ? clamp(1 - weapon.reloading / weapon.reloadTime, 0, 1) : 0;
  const reloadArc = weapon.reloading > 0 ? Math.sin(reloadProgress * Math.PI) : 0;
  const reloadRack = weapon.reloading > 0 ? Math.max(0, Math.sin((reloadProgress - 0.58) * Math.PI * 2.8)) : 0;
  const switchDrop = player.weaponSwitch * player.weaponSwitch;
  const runBobScale = 1 - player.adsAmount * 0.65;
  const sprintDrop = player.sprintAmount * (1 - player.adsAmount);
  weaponRig.position.x = adsX
    + Math.sin(player.bobTime * 2.2) * 0.012 * runBobScale
    + player.swayX
    + player.weaponKickSide
    + reloadArc * 0.1
    + switchDrop * 0.08
    + sprintDrop * 0.1;
  weaponRig.position.y = adsY
    + Math.cos(player.bobTime * 4.4) * 0.012 * runBobScale
    - player.recoil * 0.16
    - player.weaponKick * 0.08
    - reloadArc * 0.23
    - switchDrop * 0.46
    + player.swayY
    - sprintDrop * 0.28;
  weaponRig.position.z = adsZ
    + player.recoil * 0.42
    + player.weaponKick * 0.5
    + reloadArc * 0.18
    + reloadRack * 0.08
    + switchDrop * 0.18
    + sprintDrop * 0.1;
  weaponRig.rotation.x = -player.recoil * 1.85 - reloadArc * 0.5 + reloadRack * 0.16 + switchDrop * 0.42 + sprintDrop * 0.45;
  weaponRig.rotation.y = Math.sin(player.bobTime * 1.7) * 0.018 + player.swayX * 0.9 + player.recoilSide * 0.9 + reloadArc * 0.24 + sprintDrop * 0.22;
  weaponRig.rotation.z = player.recoilRoll - reloadArc * 0.46 - switchDrop * 0.35 - sprintDrop * 0.32;
  setWeaponRigScopedHidden(fullyScoped);
  ui.hud.classList.toggle("ads", player.adsAmount > 0.55);
  ui.hud.classList.toggle("scoped", fullyScoped);
  ui.hud.style.setProperty("--scope-opacity", `${scopeProfile?.overlay ?? 0}`);
  const crosshairSpread = fullyScoped
    ? 0
    : clamp(horizontalSpeed * 0.75 + player.recoil * 180 + player.weaponKick * 30 - player.adsAmount * 5, 0, 14);
  ui.crosshair.style.setProperty("--spread", `${crosshairSpread}px`);
}

function moveWithCollisions(position, velocity, radius, dt, isPlayer) {
  const steps = Math.max(1, Math.ceil(velocity.length() * dt / 0.32));
  const stepDt = dt / steps;
  for (let i = 0; i < steps; i += 1) {
    position.x += velocity.x * stepDt;
    resolveAxis(position, velocity, radius, "x");
    position.z += velocity.z * stepDt;
    resolveAxis(position, velocity, radius, "z");

    position.y += velocity.y * stepDt;
    if (position.y < player.height && isPlayer) {
      position.y = player.height;
      velocity.y = 0;
      player.onGround = true;
    } else if (isPlayer) {
      player.onGround = false;
    }
  }

  position.x = clamp(position.x, -world.half + radius, world.half - radius);
  position.z = clamp(position.z, -world.half + radius, world.half - radius);
}

function resolveAxis(position, velocity, radius, axis) {
  for (const blocker of world.blockers) {
    if (position.y - player.height > blocker.height) continue;
    const closestX = clamp(position.x, blocker.minX, blocker.maxX);
    const closestZ = clamp(position.z, blocker.minZ, blocker.maxZ);
    const dx = position.x - closestX;
    const dz = position.z - closestZ;
    const distSq = dx * dx + dz * dz;
    if (distSq >= radius * radius) continue;

    if (axis === "x") {
      if (position.x < (blocker.minX + blocker.maxX) / 2) position.x = blocker.minX - radius;
      else position.x = blocker.maxX + radius;
      velocity.x = 0;
    } else {
      if (position.z < (blocker.minZ + blocker.maxZ) / 2) position.z = blocker.minZ - radius;
      else position.z = blocker.maxZ + radius;
      velocity.z = 0;
    }
  }
}

function isBlockedAt(x, z, radius) {
  return world.blockers.some((blocker) => {
    const closestX = clamp(x, blocker.minX, blocker.maxX);
    const closestZ = clamp(z, blocker.minZ, blocker.maxZ);
    const dx = x - closestX;
    const dz = z - closestZ;
    return dx * dx + dz * dz < radius * radius;
  });
}

function switchWeapon(index) {
  if (index < 0 || index >= weapons.length || index === player.weaponIndex) return;
  setWeaponRigScopedHidden(false);
  player.weaponIndex = index;
  player.weaponSwitch = 1;
  player.weaponKick = 0;
  player.weaponKickSide = 0;
  player.recoil = 0;
  weapons.forEach((weapon) => {
    weapon.reloading = 0;
    weapon.reloadStage = 0;
  });
  rebuildWeaponModel();
  showNotice(`${weapons[index].name} ready.`);
  updateHud();
}

function advanceReloadStages(weapon) {
  const progress = clamp(1 - weapon.reloading / weapon.reloadTime, 0, 1);
  weapon.reloadProgress = progress;
  if ((weapon.reloadStage ?? 0) < 1 && progress >= 0.2) {
    createDroppedMagazine(weapon);
    playReloadStage(weapon, "drop");
    weapon.reloadStage = 1;
  }
  if (weapon.reloadStage < 2 && progress >= 0.58) {
    playReloadStage(weapon, "insert");
    weapon.reloadStage = 2;
  }
  if (weapon.reloadStage < 3 && progress >= 0.82) {
    playReloadStage(weapon, "rack");
    weapon.reloadStage = 3;
  }
}

function updateWeapons(dt) {
  weapons.forEach((weapon) => {
    weapon.shotCooldown = Math.max(0, weapon.shotCooldown - dt);
    if (weapon.reloading > 0) {
      weapon.reloading -= dt;
      advanceReloadStages(weapon);
      if (weapon.reloading <= 0) {
        const need = weapon.magazine - weapon.ammo;
        const refill = Math.min(need, weapon.reserve);
        weapon.ammo += refill;
        weapon.reserve -= refill;
        weapon.reloading = 0;
        weapon.reloadStage = 0;
        weapon.reloadProgress = 0;
        showNotice(`${weapon.name} reloaded.`);
        updateHud();
      }
    }
  });
  if (weapons[player.weaponIndex].reloading > 0) updateHud();

  if (input.switchTo !== null && input.switchTo !== undefined) {
    switchWeapon(input.switchTo);
    input.switchTo = null;
  }

  const weapon = weapons[player.weaponIndex];
  if (input.reloadRequested) {
    reloadWeapon(weapon);
    input.reloadRequested = false;
  }

  const shouldFire = weapon.automatic ? input.mouseDown : input.fireQueued;
  if (shouldFire) {
    fireWeapon(weapon);
    if (!weapon.automatic) input.fireQueued = false;
  }

  const muzzle = weaponRig.getObjectByName("muzzleFlash");
  if (muzzle) {
    muzzle.userData.opacity = damp(muzzle.userData.opacity ?? 0, 0, 28, dt);
    muzzle.traverse((child) => {
      if (child.material?.transparent) child.material.opacity = muzzle.userData.opacity;
      if (child.isLight) child.intensity = muzzle.userData.opacity * 8;
    });
    muzzle.rotation.z += dt * 18;
  }
}

function reloadWeapon(weapon) {
  if (weapon.reloading > 0 || weapon.ammo >= weapon.magazine || weapon.reserve <= 0) return;
  weapon.reloading = weapon.reloadTime;
  weapon.reloadStage = 0;
  weapon.reloadProgress = 0;
  player.weaponSwitch = Math.max(player.weaponSwitch, 0.45);
  playReloadStage(weapon, "start");
  showNotice(`Reloading ${weapon.name}.`);
  updateHud();
}

function fireWeapon(weapon) {
  if (weapon.shotCooldown > 0 || weapon.reloading > 0 || !player.alive || game.state !== "playing") return;
  if (weapon.ammo <= 0) {
    playDryFireSound();
    reloadWeapon(weapon);
    weapon.shotCooldown = 0.15;
    return;
  }

  weapon.ammo -= 1;
  weapon.shotCooldown = weapon.fireRate;
  const recoilScale = weapon.name === "Railgun" ? 0.88 : weapon.name === "Shotgun" ? 0.72 : weapon.name === "Marksman" ? 0.62 : weapon.name === "Rifle" ? 0.38 : weapon.name === "SMG" ? 0.28 : 0.5;
  const recoilStability = 1 - player.adsAmount * (weapon.scoped ? 0.46 : 0.28);
  const sideKick = (rand() - 0.5) * weapon.recoil * recoilStability * (weapon.name === "Shotgun" || weapon.name === "Railgun" ? 1.4 : 0.9);
  player.recoil += weapon.recoil * recoilScale * recoilStability;
  player.recoilSide += sideKick;
  player.recoilRoll += sideKick * 1.7 + weapon.recoil * (rand() > 0.5 ? 0.22 : -0.22);
  player.weaponKick += weapon.recoil * recoilStability * (weapon.name === "Railgun" ? 2.9 : weapon.name === "Shotgun" ? 2.6 : weapon.name === "Marksman" ? 2.1 : weapon.name === "Rifle" ? 1.15 : weapon.name === "SMG" ? 0.9 : 1.65);
  player.weaponKickSide += sideKick * 1.8;
  player.weaponCycle = 1;
  game.shake = Math.max(game.shake, weapon.recoil * (1 - player.adsAmount * 0.65) * (weapon.name === "Railgun" ? 0.065 : weapon.name === "Shotgun" ? 0.055 : 0.035));
  playGunSound(weapon);

  const muzzle = weaponRig.getObjectByName("muzzleFlash");
  if (muzzle) {
    muzzle.userData.opacity = 1;
    muzzle.traverse((child) => {
      if (child.material?.transparent) child.material.opacity = 1;
      if (child.isLight) child.intensity = 8;
    });
    muzzle.scale.setScalar(0.75 + rand() * 0.6);
  }
  const fullyScopedShot = weapon.scoped && player.adsAmount > 0.72;
  if (!fullyScopedShot) createMuzzleBurst(weapon);

  camera.getWorldDirection(cameraDirection);
  const origin = camera.getWorldPosition(tmpVec).clone();
  const impacts = [];

  for (let pellet = 0; pellet < weapon.pellets; pellet += 1) {
    const dir = cameraDirection.clone();
    const aimSpreadScale = weapon.scoped ? 0.16 : 0.42;
    const spread = weapon.spread * THREE.MathUtils.lerp(1, aimSpreadScale, player.adsAmount);
    dir.x += (rand() - 0.5) * spread;
    dir.y += (rand() - 0.5) * spread;
    dir.z += (rand() - 0.5) * spread;
    dir.normalize();
    const hit = resolveShot(origin, dir, weapon);
    impacts.push(hit);
    if (weapon.name === "Shotgun" && pellet > 0 && pellet < 5) {
      createTracer(origin.clone().add(cameraDirection.clone().multiplyScalar(0.5)), hit, weapon.color, true);
    }
  }

  const impact = impacts[0] ?? origin.clone().add(cameraDirection.multiplyScalar(weapon.range));
  createTracer(origin.clone().add(cameraDirection.clone().multiplyScalar(0.5)), impact, weapon.color);
  createShellCasing(weapon);
  updateHud();
}

function resolveShot(origin, direction, weapon) {
  const maxPoint = origin.clone().add(direction.clone().multiplyScalar(weapon.range));
  let closestEnemy = null;
  let closestDistance = weapon.range;
  let hitPoint = maxPoint.clone();
  let closestHit = null;

  for (const enemy of enemies) {
    if (!enemy.alive) continue;
    const hit = intersectEnemyHitboxes(origin, direction, enemy, weapon.range);
    if (hit && hit.distance < closestDistance) {
      closestDistance = hit.distance;
      closestEnemy = enemy;
      closestHit = hit;
      hitPoint = hit.point;
    }
  }

  const interactiveHit = raycastInteractives(origin, direction, weapon.range);
  if (interactiveHit && interactiveHit.distance <= closestDistance + 0.03) {
    damageInteractive(interactiveHit.interactive, weapon.damage, interactiveHit.point, interactiveHit.normal);
    return interactiveHit.point;
  }

  const wallHit = raycastBlockers(origin, direction, weapon.range);
  if (wallHit && wallHit.distance < closestDistance) {
    createImpact(wallHit.point, wallHit.normal, 0xb8c1cc);
    return wallHit.point;
  }

  if (closestEnemy) {
    damageEnemy(closestEnemy, weapon.damage * closestHit.multiplier, hitPoint, direction, closestHit.part);
    return hitPoint;
  }

  return hitPoint;
}

function intersectEnemyHitboxes(origin, direction, enemy, range) {
  let best = null;
  const hitboxes = enemy.hitboxes?.length
    ? enemy.hitboxes
    : [{ part: "body", local: new THREE.Vector3(0, enemy.config.height * 0.7, 0), radius: enemy.radius, multiplier: 1 }];

  for (const hitbox of hitboxes) {
    const center = hitbox.local.clone().applyQuaternion(enemy.group.quaternion).add(enemy.position);
    const distance = raySphere(origin, direction, center, hitbox.radius);
    if (distance === null || distance > range) continue;
    if (!best || distance < best.distance) {
      best = {
        distance,
        point: origin.clone().add(direction.clone().multiplyScalar(distance)),
        part: hitbox.part,
        multiplier: hitbox.multiplier,
      };
    }
  }
  return best;
}

function raySphere(origin, direction, center, radius) {
  tmpVec2.subVectors(center, origin);
  const tca = tmpVec2.dot(direction);
  if (tca < 0) return null;
  const d2 = tmpVec2.lengthSq() - tca * tca;
  const r2 = radius * radius;
  if (d2 > r2) return null;
  const thc = Math.sqrt(r2 - d2);
  const t0 = tca - thc;
  return t0 >= 0 ? t0 : tca + thc;
}

function raycastBlockers(origin, direction, range) {
  let best = null;
  for (const blocker of world.blockers) {
    const result = intersectAabb(origin, direction, blocker, range);
    if (result && (!best || result.distance < best.distance)) {
      best = result;
    }
  }
  return best;
}

function raycastInteractives(origin, direction, range) {
  let best = null;
  for (const interactive of world.interactives) {
    if (!interactive.active || !interactive.blocker) continue;
    const result = intersectAabb(origin, direction, interactive.blocker, range);
    if (result && (!best || result.distance < best.distance)) {
      best = { ...result, interactive };
    }
  }
  return best;
}

function intersectAabb(origin, direction, blocker, range) {
  const min = tmpVec2.set(blocker.minX, 0, blocker.minZ);
  const max = tmpVec3.set(blocker.maxX, blocker.height, blocker.maxZ);
  let tmin = 0;
  let tmax = range;
  hitNormal.set(0, 0, 0);
  let normalAxis = -1;
  let normalSign = 1;

  for (let axis = 0; axis < 3; axis += 1) {
    const o = origin.getComponent(axis);
    const d = direction.getComponent(axis);
    const minValue = min.getComponent(axis);
    const maxValue = max.getComponent(axis);
    if (Math.abs(d) < 1e-6) {
      if (o < minValue || o > maxValue) return null;
      continue;
    }
    let t1 = (minValue - o) / d;
    let t2 = (maxValue - o) / d;
    let sign = -1;
    if (t1 > t2) {
      [t1, t2] = [t2, t1];
      sign = 1;
    }
    if (t1 > tmin) {
      tmin = t1;
      normalAxis = axis;
      normalSign = sign;
    }
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }

  if (tmin < 0 || tmin > range) return null;
  const point = origin.clone().add(direction.clone().multiplyScalar(tmin));
  const normal = new THREE.Vector3();
  if (normalAxis >= 0) normal.setComponent(normalAxis, normalSign);
  return { distance: tmin, point, normal };
}

function hasLineOfSight(from, to, eyeHeight = 1, ignoreLow = false) {
  const origin = from.clone();
  origin.y += eyeHeight;
  const target = to.clone();
  target.y = Math.max(to.y, 0) + eyeHeight;
  const direction = target.sub(origin);
  const distance = direction.length();
  if (distance <= 0.01) return true;
  direction.normalize();
  const hit = raycastBlockers(origin, direction, distance);
  if (!hit) return true;
  if (ignoreLow && hit.point.y < 1.5) return true;
  return false;
}

function damageEnemy(enemy, amount, point, direction, part = "body") {
  const criticalHit = part === "head" || part === "core";
  const limbHit = part.includes("arm") || part.includes("leg");
  const shieldHit = part === "shield";
  enemy.health -= amount;
  enemy.stun = Math.max(enemy.stun, criticalHit ? 0.2 : limbHit ? 0.18 : 0.13);
  enemy.velocity.add(direction.clone().multiplyScalar((shieldHit ? 1.4 : 2.8) / enemy.config.scale));
  enemy.hitReact = criticalHit ? 0.24 : limbHit ? 0.2 : 0.16;
  enemy.hitReactMax = enemy.hitReact;
  enemy.hitVectorLocal = direction.clone().normalize().applyQuaternion(enemy.group.quaternion.clone().invert());
  if (part.includes("leg")) enemy.limpTimer = Math.max(enemy.limpTimer, 0.85);
  if (part.includes("arm")) enemy.attackCooldown += 0.24;
  createEnemyImpact(point, direction.clone().multiplyScalar(-1), enemy, part);
  playHitSound();
  showHitmarker(criticalHit);
  flashEnemy(enemy);
  if (criticalHit && enemy.health > 0) showNotice(part === "head" ? "Headshot." : "Core hit.");
  if (enemy.health <= 0) killEnemy(enemy);
}

function updateEnemySuitAnimation(enemy, speed, dt) {
  if (!enemy.mixer || !enemy.actions) return;
  enemy.mixer.update(dt);
  const nextState = speed > 0.35 && enemy.stun <= 0 ? "run" : "idle";
  if (nextState === enemy.animState) return;
  const current = enemy.actions[enemy.animState];
  const next = enemy.actions[nextState];
  if (current && next) {
    current.fadeOut(0.18);
    next.reset().fadeIn(0.18).play();
  }
  enemy.animState = nextState;
}

function showHitmarker(isHeadshot = false) {
  ui.hitmarker.classList.toggle("headshot", isHeadshot);
  ui.hitmarker.classList.remove("active");
  void ui.hitmarker.offsetWidth;
  ui.hitmarker.classList.add("active");
  window.clearTimeout(ui.hitmarker.userData?.timer);
  ui.hitmarker.userData = ui.hitmarker.userData ?? {};
  ui.hitmarker.userData.timer = window.setTimeout(() => {
    ui.hitmarker.classList.remove("active", "headshot");
  }, isHeadshot ? 190 : 125);
}

function flashEnemy(enemy) {
  enemy.group.traverse((child) => {
    if (child.isMesh && child.material?.emissive) {
      if (!child.userData.localMaterial) {
        child.material = child.material.clone();
        child.userData.localMaterial = true;
      }
      if (child.userData.baseEmissive === undefined) {
        child.userData.baseEmissive = child.material.emissive.getHex();
        child.userData.baseEmissiveIntensity = child.material.emissiveIntensity;
      }
      child.userData.flash = 0.08;
      child.material.emissive.setHex(0xffffff);
      child.material.emissiveIntensity = child.userData.baseEmissiveIntensity + 1.4;
    }
  });
}

function killEnemy(enemy) {
  if (!enemy.alive) return;
  enemy.alive = false;
  releaseCoverNode(enemy);
  detachEnemyFromSquad(enemy);
  player.score += enemy.config.score;
  player.kills += 1;
  playEnemyDeathSound();
  clearEnemyAttachedEffects(enemy);
  createEnemyDeathBurst(enemy);
  scene.remove(enemy.group);
  const index = enemies.indexOf(enemy);
  if (index >= 0) enemies.splice(index, 1);
  if (rand() > 0.72) createPickup(enemy.position, rand() > 0.45 ? "ammo" : "armor");
  if (enemies.length === 0 && pendingSpawns.length === 0 && game.spawnBudget <= 0) {
    game.wave += 1;
    game.waveCooldown = 2.2;
    showNotice(`Wave ${game.wave} forming.`);
    setTimeout(() => {
      if (game.state === "playing") spawnWave();
    }, 1700);
  }
  updateHud();
}

function createTracer(start, end, color, faint = false) {
  const material = tracerMaterial.clone();
  material.color.setHex(color);
  material.opacity = faint ? 0.32 : 0.78;
  const geometry = new THREE.BufferGeometry().setFromPoints([start, end]);
  const line = new THREE.Line(geometry, material);
  scene.add(line);
  effects.push({ object: line, life: faint ? 0.035 : 0.055, maxLife: faint ? 0.035 : 0.055, type: "fade" });

  const delta = end.clone().sub(start);
  const length = delta.length();
  if (length > 1.2 && !faint) {
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.004, Math.min(length, 26), 8),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.38,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    const beamLength = Math.min(length, 26);
    const center = start.clone().add(delta.clone().normalize().multiplyScalar(beamLength * 0.5));
    beam.position.copy(center);
    beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
    scene.add(beam);
    effects.push({ object: beam, life: 0.045, maxLife: 0.045, type: "fade", grow: 0.4 });
  }
}

function createShellCasing(weapon) {
  const shell = new THREE.Mesh(
    new THREE.CylinderGeometry(weapon.name === "Shotgun" ? 0.05 : 0.035, weapon.name === "Shotgun" ? 0.05 : 0.035, weapon.name === "Shotgun" ? 0.24 : 0.14, 10),
    materials.brass.clone(),
  );
  shell.material.transparent = true;
  shell.material.opacity = 1;
  const origin = camera.getWorldPosition(tmpVec).clone();
  camera.getWorldDirection(cameraDirection);
  flatRight.set(Math.cos(player.yaw), 0, -Math.sin(player.yaw)).normalize();
  const up = new THREE.Vector3(0, 1, 0);
  shell.position.copy(origin)
    .add(cameraDirection.clone().multiplyScalar(0.45))
    .add(flatRight.clone().multiplyScalar(0.32))
    .add(up.clone().multiplyScalar(-0.22));
  shell.rotation.set(rand() * Math.PI, rand() * Math.PI, rand() * Math.PI);
  scene.add(shell);
  effects.push({
    object: shell,
    life: 1.15,
    maxLife: 1.15,
    type: "shell",
    velocity: flatRight.clone().multiplyScalar((weapon.name === "Shotgun" ? 1.4 : 2.2) + rand() * 0.9)
      .add(up.multiplyScalar(1.2 + rand() * 0.6))
      .add(cameraDirection.clone().multiplyScalar(0.35)),
  });
}

function createMuzzleBurst(weapon) {
  const muzzle = weaponRig.getObjectByName("muzzleFlash");
  if (!muzzle) return;
  const position = muzzle.getWorldPosition(new THREE.Vector3());
  const direction = camera.getWorldDirection(new THREE.Vector3());
  const color = weapon.name === "Shotgun" ? 0xffa35f : weapon.color;
  const blastScale = weapon.name === "Railgun" ? 1.45 : weapon.name === "Shotgun" ? 1.25 : weapon.name === "SMG" ? 0.78 : 1;
  const cone = new THREE.Mesh(
    new THREE.ConeGeometry(0.14 * blastScale, 0.42 * blastScale, 9, 1, true),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    }),
  );
  cone.position.copy(position).add(direction.clone().multiplyScalar(0.18));
  cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
  cone.rotateX(Math.PI / 2);
  scene.add(cone);
  effects.push({ object: cone, life: 0.06, maxLife: 0.06, type: "muzzle", grow: 1.2 });

  if (weapon.name === "Railgun") {
    const pulse = new THREE.Mesh(
      new THREE.RingGeometry(0.18, 0.34, 32),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      }),
    );
    pulse.position.copy(position).add(direction.clone().multiplyScalar(0.22));
    pulse.lookAt(position.clone().add(direction));
    scene.add(pulse);
    effects.push({ object: pulse, life: 0.18, maxLife: 0.18, type: "muzzle", grow: 2.6 });
  }

  const smoke = new THREE.Mesh(
    new THREE.SphereGeometry(weapon.name === "Shotgun" || weapon.name === "Railgun" ? 0.16 : 0.1, 10, 8),
    new THREE.MeshBasicMaterial({
      color: 0x9aa3a8,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
    }),
  );
  smoke.position.copy(position).add(direction.clone().multiplyScalar(0.35));
  scene.add(smoke);
  effects.push({
    object: smoke,
    life: weapon.name === "Shotgun" || weapon.name === "Railgun" ? 0.48 : 0.3,
    maxLife: weapon.name === "Shotgun" || weapon.name === "Railgun" ? 0.48 : 0.3,
    type: "smoke",
    velocity: direction.clone().multiplyScalar(0.9).add(new THREE.Vector3(0, 0.35, 0)),
    grow: weapon.name === "Shotgun" || weapon.name === "Railgun" ? 3.2 : 2.1,
  });
}

function createDroppedMagazine(weapon) {
  if (weapon.name === "Shotgun") {
    for (let i = 0; i < 2; i += 1) createLooseRound(weapon, i * 0.08);
    return;
  }
  const magazine = new THREE.Mesh(
    new THREE.BoxGeometry(weapon.name === "Rifle" ? 0.12 : 0.09, weapon.name === "Rifle" ? 0.36 : 0.24, 0.08),
    materials.darkMetal.clone(),
  );
  magazine.material.transparent = true;
  magazine.material.opacity = 1;
  const origin = camera.getWorldPosition(tmpVec).clone();
  camera.getWorldDirection(cameraDirection);
  flatRight.set(Math.cos(player.yaw), 0, -Math.sin(player.yaw)).normalize();
  magazine.position.copy(origin)
    .add(cameraDirection.clone().multiplyScalar(0.46))
    .add(flatRight.clone().multiplyScalar(0.2))
    .add(new THREE.Vector3(0, -0.48, 0));
  magazine.rotation.set(rand() * Math.PI, rand() * Math.PI, rand() * Math.PI);
  scene.add(magazine);
  effects.push({
    object: magazine,
    life: 1.05,
    maxLife: 1.05,
    type: "shell",
    velocity: flatRight.clone().multiplyScalar(0.6 + rand() * 0.4).add(new THREE.Vector3(0, -0.4, 0)).add(cameraDirection.clone().multiplyScalar(0.15)),
  });
}

function createLooseRound(weapon, delayOffset = 0) {
  const round = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.04, 0.2, 10),
    materials.brass.clone(),
  );
  round.material.transparent = true;
  round.material.opacity = 1;
  const origin = camera.getWorldPosition(tmpVec).clone();
  camera.getWorldDirection(cameraDirection);
  flatRight.set(Math.cos(player.yaw), 0, -Math.sin(player.yaw)).normalize();
  round.position.copy(origin)
    .add(cameraDirection.clone().multiplyScalar(0.38 + delayOffset))
    .add(flatRight.clone().multiplyScalar(-0.08 + rand() * 0.18))
    .add(new THREE.Vector3(0, -0.42, 0));
  round.rotation.set(rand() * Math.PI, rand() * Math.PI, rand() * Math.PI);
  scene.add(round);
  effects.push({
    object: round,
    life: 0.95,
    maxLife: 0.95,
    type: "shell",
    velocity: flatRight.clone().multiplyScalar(rand() - 0.3).add(new THREE.Vector3(0, 0.6 + rand() * 0.4, 0)).add(cameraDirection.clone().multiplyScalar(0.25)),
  });
}

function createImpact(point, normal, color, options = {}) {
  normal.normalize();
  const geo = new THREE.SphereGeometry(0.08, 8, 6);
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 });
  const spark = new THREE.Mesh(geo, mat);
  spark.position.copy(point).add(normal.clone().multiplyScalar(0.04));
  scene.add(spark);
  effects.push({ object: spark, life: 0.32, maxLife: 0.32, type: "spark", velocity: normal.clone().multiplyScalar(2.5) });
  if (options.decal !== false) createBulletDecal(point, normal, color);
  for (let i = 0; i < 3; i += 1) {
    const chip = new THREE.Mesh(
      new THREE.BoxGeometry(0.035, 0.035, 0.11),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 }),
    );
    chip.position.copy(point).add(normal.clone().multiplyScalar(0.06));
    const side = new THREE.Vector3(rand() - 0.5, rand() * 0.65, rand() - 0.5).normalize();
    scene.add(chip);
    effects.push({
      object: chip,
      life: 0.26 + rand() * 0.18,
      maxLife: 0.42,
      type: "spark",
      velocity: normal.clone().multiplyScalar(1.4 + rand() * 1.5).add(side.multiplyScalar(1.8)),
    });
  }
}

function createEnemyImpact(point, normal, enemy, part = "body") {
  normal.normalize();
  const isHeadshot = part === "head";
  const isCore = part === "core";
  const isLimb = part.includes("arm") || part.includes("leg");
  const isShield = part === "shield";
  const color = isHeadshot ? 0xfff3ae : isCore ? 0x65f08c : isShield ? 0xd3d8dd : enemy.config.accent;
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(isHeadshot || isCore ? 0.09 : isLimb ? 0.052 : 0.065, 10, 8),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  core.position.copy(point).add(normal.clone().multiplyScalar(0.05));
  scene.add(core);
  effects.push({
    object: core,
    life: isHeadshot || isCore ? 0.18 : 0.14,
    maxLife: isHeadshot || isCore ? 0.18 : 0.14,
    type: "enemyHit",
    owner: enemy,
    removeWithOwner: true,
    velocity: normal.clone().multiplyScalar(isHeadshot || isCore ? 1.1 : 0.75),
    grow: isHeadshot || isCore ? 1.8 : 1.2,
  });

  const ringMaterial = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.82,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(isHeadshot || isCore ? 0.15 : 0.1, 0.008, 6, 20),
    ringMaterial,
  );
  ring.position.copy(point).add(normal.clone().multiplyScalar(0.035));
  ring.lookAt(point.clone().add(normal));
  scene.add(ring);
  effects.push({
    object: ring,
    life: isHeadshot || isCore ? 0.3 : 0.22,
    maxLife: isHeadshot || isCore ? 0.3 : 0.22,
    type: "enemyHit",
    owner: enemy,
    removeWithOwner: true,
    grow: isHeadshot || isCore ? 2.4 : 1.8,
  });

  createArmorScar(point, enemy, color, isHeadshot || isCore);

  const shardCount = isHeadshot || isCore ? 14 : isShield ? 5 : 7;
  for (let i = 0; i < shardCount; i += 1) {
    const shard = new THREE.Mesh(
      new THREE.BoxGeometry(isHeadshot || isCore ? 0.03 : 0.024, isHeadshot || isCore ? 0.03 : 0.024, isHeadshot || isCore ? 0.26 : 0.16),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.92,
        blending: THREE.AdditiveBlending,
      }),
    );
    shard.position.copy(point).add(normal.clone().multiplyScalar(0.06));
    const side = new THREE.Vector3(rand() - 0.5, rand() * 0.85, rand() - 0.5).normalize();
    scene.add(shard);
    effects.push({
      object: shard,
      life: 0.16 + rand() * 0.16,
      maxLife: 0.32,
      type: "enemyHit",
      owner: enemy,
      removeWithOwner: true,
      velocity: normal.clone().multiplyScalar(1.05 + rand() * 1.25).add(side.multiplyScalar(isHeadshot || isCore ? 2.15 : 1.45)),
    });
  }

  if (isHeadshot || isCore) createHeadshotBurst(point, normal, enemy, color);
}

function createArmorScar(point, enemy, color, isHeadshot) {
  const scarMaterial = new THREE.MeshBasicMaterial({
    color: isHeadshot ? 0xfff3ae : 0x101318,
    transparent: true,
    opacity: isHeadshot ? 0.72 : 0.58,
    depthWrite: false,
    blending: isHeadshot ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  const scar = new THREE.Mesh(
    new THREE.BoxGeometry(isHeadshot ? 0.18 : 0.13, 0.012, 0.008),
    scarMaterial,
  );
  const local = enemy.group.worldToLocal(point.clone());
  scar.position.copy(local);
  scar.position.z -= 0.018;
  scar.rotation.set(rand() * 0.4 - 0.2, rand() * 0.3 - 0.15, rand() * Math.PI);
  enemy.group.add(scar);
  effects.push({
    object: scar,
    life: isHeadshot ? 0.38 : 0.72,
    maxLife: isHeadshot ? 0.38 : 0.72,
    type: "enemyScar",
    owner: enemy,
    removeWithOwner: true,
  });
}

function createHeadshotBurst(point, normal, enemy, color) {
  const halo = new THREE.Mesh(
    new THREE.RingGeometry(0.16, 0.24, 28),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.88,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    }),
  );
  halo.position.copy(point).add(normal.clone().multiplyScalar(0.08));
  halo.lookAt(point.clone().add(normal));
  scene.add(halo);
  effects.push({
    object: halo,
    life: 0.28,
    maxLife: 0.28,
    type: "enemyHit",
    owner: enemy,
    removeWithOwner: true,
    grow: 2.8,
  });

  for (let i = 0; i < 10; i += 1) {
    const spark = new THREE.Mesh(
      new THREE.CylinderGeometry(0.01, 0.018, 0.22, 6),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending }),
    );
    spark.position.copy(point);
    const velocity = new THREE.Vector3(rand() - 0.5, rand() * 1.1, rand() - 0.5)
      .normalize()
      .multiplyScalar(2.8 + rand() * 2.4)
      .add(normal.clone().multiplyScalar(1.2));
    scene.add(spark);
    effects.push({ object: spark, life: 0.32 + rand() * 0.16, maxLife: 0.44, type: "enemyHit", owner: enemy, removeWithOwner: true, velocity });
  }
}

function createEnemyDeathBurst(enemy) {
  enemy.group.updateMatrixWorld(true);
  const center = enemy.position.clone().add(new THREE.Vector3(0, enemy.config.height * 0.7, 0));
  const accent = enemy.config.accent;
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(enemy.radius * 0.55, enemy.radius * 1.25, 32),
    new THREE.MeshBasicMaterial({
      color: accent,
      transparent: true,
      opacity: 0.78,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    }),
  );
  ring.position.copy(center);
  ring.rotation.x = Math.PI / 2;
  scene.add(ring);
  effects.push({ object: ring, life: 0.42, maxLife: 0.42, type: "deathWave", grow: 3.4 });

  const chunks = [];
  enemy.group.traverse((child) => {
    if (chunks.length >= 18) return;
    if (!child.isMesh || child.name === "healthBar" || child.name === "healthFill") return;
    const worldPosition = child.getWorldPosition(new THREE.Vector3());
    if (worldPosition.y < 0.02) return;
    chunks.push({ child, worldPosition });
  });

  chunks.forEach(({ child, worldPosition }, index) => {
    const color = child.material?.color?.getHex?.() ?? accent;
    const size = index % 3 === 0 ? 0.16 : 0.11;
    const fragment = new THREE.Mesh(
      new THREE.BoxGeometry(size, size * (0.7 + rand() * 0.7), size * (0.8 + rand() * 1.1)),
      new THREE.MeshStandardMaterial({
        color,
        emissive: index % 4 === 0 ? accent : 0x000000,
        emissiveIntensity: index % 4 === 0 ? 0.8 : 0,
        roughness: 0.5,
        metalness: 0.25,
        transparent: true,
        opacity: 1,
      }),
    );
    fragment.position.copy(worldPosition);
    fragment.quaternion.copy(child.getWorldQuaternion(new THREE.Quaternion()));
    const away = worldPosition.clone().sub(center).setY(rand() * 0.8 + 0.3).normalize();
    scene.add(fragment);
    effects.push({
      object: fragment,
      life: 0.72 + rand() * 0.35,
      maxLife: 0.95,
      type: "deathChunk",
      velocity: away.multiplyScalar(3.0 + rand() * 3.2),
    });
  });

  createBurst(center, accent, 18);
}

function createBulletDecal(point, normal, color) {
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.38,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const decal = new THREE.Mesh(new THREE.PlaneGeometry(0.18 + rand() * 0.08, 0.18 + rand() * 0.08), mat);
  decal.position.copy(point).add(normal.clone().multiplyScalar(0.018));
  decal.lookAt(point.clone().add(normal));
  decal.rotation.z = rand() * Math.PI * 2;
  scene.add(decal);
  world.decals.push(decal);
  effects.push({ object: decal, life: 6, maxLife: 6, type: "decal" });
  if (world.decals.length > MAX_DECALS) {
    const old = world.decals.shift();
    const effectIndex = effects.findIndex((effect) => effect.object === old);
    if (effectIndex >= 0) effects.splice(effectIndex, 1);
    scene.remove(old);
  }
}

function createBurst(position, color, count = 12) {
  for (let i = 0; i < count; i += 1) {
    const spark = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.08, 0.28),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 }),
    );
    spark.position.copy(position);
    const velocity = new THREE.Vector3(rand() - 0.5, rand() * 0.9, rand() - 0.5).normalize().multiplyScalar(3 + rand() * 5);
    scene.add(spark);
    effects.push({ object: spark, life: 0.5 + rand() * 0.28, maxLife: 0.72, type: "spark", velocity });
  }
}

function createPickup(position, type) {
  const group = new THREE.Group();
  group.position.set(position.x, 0.72, position.z);
  const mat = type === "ammo" ? materials.neon : materials.pickup;
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.34, 0.72), mat);
  base.castShadow = true;
  group.add(base);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.56, 0.035, 8, 22), mat);
  ring.rotation.x = Math.PI / 2;
  group.add(ring);
  scene.add(group);
  world.pickups.push({ group, type, life: 18 });
}

function updateEnemies(dt) {
  world.coverNodes.forEach((node) => {
    node.heat = Math.max(0, node.heat - dt * 0.08);
  });
  updateSquadDirector(dt);
  for (const enemy of [...enemies]) {
    enemy.attackCooldown = Math.max(0, enemy.attackCooldown - dt);
    enemy.retargetTimer -= dt;
    enemy.navRefresh -= dt;
    enemy.tacticalTimer -= dt;
    enemy.intentTimer -= dt;
    enemy.repositionCooldown = Math.max(0, enemy.repositionCooldown - dt);
    enemy.flankCommit = Math.max(0, enemy.flankCommit - dt);
    enemy.stun = Math.max(0, enemy.stun - dt);
    enemy.hitReact = Math.max(0, enemy.hitReact - dt);
    enemy.limpTimer = Math.max(0, enemy.limpTimer - dt);
    if (enemy.tacticalTimer <= 0) {
      enemy.strafeDir = rand() > 0.5 ? 1 : -1;
      enemy.tacticalTimer = enemy.typeName === "scout" ? 1.1 + rand() * 1.1 : 1.6 + rand() * 1.4;
    }

    const toPlayer = tmpVec.subVectors(player.position, enemy.position);
    toPlayer.y = 0;
    const distance = toPlayer.length();
    const direction = distance > 0.01 ? toPlayer.clone().multiplyScalar(1 / distance) : new THREE.Vector3(0, 0, 1);
    const hasSight = hasLineOfSight(enemy.position, player.position, enemy.config.height * 0.72);
    updateEnemyBrain(enemy, dt, distance, direction, hasSight);
    updateEnemyNavigation(enemy, dt);

    if (enemy.retargetTimer <= 0) {
      enemy.pathAngle = chooseTacticalSteeringAngle(enemy);
      enemy.retargetTimer = 0.14 + rand() * 0.16;
    }

    const moveDir = tmpVec2.set(Math.sin(enemy.pathAngle), 0, Math.cos(enemy.pathAngle));
    const targetDistance = enemy.intentPoint ? enemy.position.distanceTo(enemy.intentPoint) : distance;
    const stopDistance = getIntentStopDistance(enemy);
    let targetSpeed = enemy.stun > 0 || targetDistance < stopDistance
      ? 0
      : enemy.config.speed * getIntentSpeedScale(enemy, distance, hasSight) * (enemy.limpTimer > 0 ? 0.68 : 1);
    enemy.velocity.x = damp(enemy.velocity.x, moveDir.x * targetSpeed, 5.8, dt);
    enemy.velocity.z = damp(enemy.velocity.z, moveDir.z * targetSpeed, 5.8, dt);
    enemy.position.x += enemy.velocity.x * dt;
    resolveEnemyAxis(enemy, "x");
    enemy.position.z += enemy.velocity.z * dt;
    resolveEnemyAxis(enemy, "z");
    updateEnemySuitAnimation(enemy, Math.hypot(enemy.velocity.x, enemy.velocity.z), dt);

    enemy.position.x = clamp(enemy.position.x, -world.half + enemy.radius, world.half - enemy.radius);
    enemy.position.z = clamp(enemy.position.z, -world.half + enemy.radius, world.half - enemy.radius);
    const facePoint = enemy.config.ranged && enemy.sightTimer > 0.15 ? player.position : enemy.intentPoint ?? player.position;
    const face = tmpVec3.subVectors(facePoint, enemy.position);
    face.y = 0;
    if (face.lengthSq() > 0.001) enemy.group.rotation.y = Math.atan2(face.x, face.z) + Math.PI;
    updateEnemyVisuals(enemy, dt);

    if (canEnemyAttack(enemy, distance, hasSight)) {
      enemyAttack(enemy, direction, distance);
    }
  }
  separateEnemies(dt);
}

function updateSquadDirector(dt) {
  for (let i = game.squads.length - 1; i >= 0; i -= 1) {
    const squad = game.squads[i];
    squad.memoryAge += dt;
    squad.orderTimer -= dt;
    squad.hasSight = false;
    squad.suppressors = 0;
    squad.flankers = 0;
    squad.aliveCount = 0;

    for (const enemy of [...squad.members]) {
      if (!enemy.alive || !enemies.includes(enemy)) {
        squad.members.delete(enemy);
        continue;
      }
      squad.aliveCount += 1;
      if (enemy.squadRole === "suppressor" || enemy.squadRole === "leader" || enemy.squadRole === "defender") squad.suppressors += 1;
      if (enemy.squadRole === "flanker" || enemy.squadRole === "charger") squad.flankers += 1;
      if (hasLineOfSight(enemy.position, player.position, enemy.config.height * 0.72)) {
        squad.hasSight = true;
        squad.lastKnownPlayer.copy(player.position);
        squad.memoryAge = 0;
      }
    }

    if (squad.aliveCount <= 0 && !hasPendingSquadMembers(squad.id)) {
      game.squads.splice(i, 1);
      continue;
    }

    squad.pressure = clamp(squad.pressure + (squad.hasSight ? dt * 0.5 : -dt * 0.35), 0, 1);
    if (squad.orderTimer <= 0) {
      squad.order = chooseSquadOrder(squad);
      squad.orderTimer = 1.05 + rand() * 0.75;
    }
  }
}

function chooseSquadOrder(squad) {
  if (squad.aliveCount <= 1 || squad.memoryAge > 5) return "regroup";
  const playerDistance = squadCenter(squad).distanceTo(player.position);
  if (squad.hasSight && squad.suppressors > 0 && squad.flankers > 0 && playerDistance > 8) return "pinAndFlank";
  if (squad.hasSight && playerDistance < 10) return "collapse";
  if (squad.memoryAge < 3.5) return "advanceContact";
  return "search";
}

function squadCenter(squad) {
  const center = new THREE.Vector3();
  let count = 0;
  squad.members.forEach((enemy) => {
    if (!enemy.alive) return;
    center.add(enemy.position);
    count += 1;
  });
  if (count === 0) return squad.anchor.clone();
  return center.multiplyScalar(1 / count);
}

function hasPendingSquadMembers(squadId) {
  return pendingSpawns.some((spawn) => spawn.assignment?.squadId === squadId);
}

function detachEnemyFromSquad(enemy) {
  const squad = getSquad(enemy.squadId);
  if (!squad) return;
  squad.members.delete(enemy);
  if (enemy.isSquadLeader) promoteSquadLeader(squad);
}

function promoteSquadLeader(squad) {
  const next = [...squad.members].find((enemy) => enemy.alive && (enemy.squadRole === "suppressor" || enemy.typeName === "trooper"))
    ?? [...squad.members].find((enemy) => enemy.alive);
  if (!next) return;
  next.isSquadLeader = true;
  if (next.squadRole === "support") next.squadRole = "leader";
}

function updateEnemyBrain(enemy, dt, distance, direction, hasSight) {
  const squad = getSquad(enemy.squadId);
  if (hasSight) {
    enemy.lastKnownPlayer.copy(player.position);
    if (squad) {
      squad.lastKnownPlayer.copy(player.position);
      squad.memoryAge = 0;
      squad.hasSight = true;
      squad.pressure = clamp(squad.pressure + dt * 0.7, 0, 1);
    }
    enemy.sightTimer += dt;
    enemy.lostSightTimer = 0;
  } else {
    enemy.sightTimer = 0;
    enemy.lostSightTimer += dt;
    if (squad && squad.memoryAge < 5.5) enemy.lastKnownPlayer.copy(squad.lastKnownPlayer);
  }

  if (enemy.coverNode && (!world.coverNodes.includes(enemy.coverNode) || enemy.coverNode.claimedBy !== enemy)) {
    enemy.coverNode = null;
  }

  if (enemy.intentTimer > 0 && isEnemyIntentStillValid(enemy, distance, hasSight)) return;

  if (enemy.typeName === "scout") {
    planScoutBehavior(enemy, distance, direction, hasSight);
  } else if (enemy.typeName === "trooper") {
    planTrooperBehavior(enemy, distance, hasSight);
  } else {
    planHeavyBehavior(enemy, distance, hasSight);
  }
}

function isEnemyIntentStillValid(enemy, distance, hasSight) {
  if (!enemy.intentPoint) return false;
  if (enemy.intent === "takeCover") return enemy.coverNode && enemy.position.distanceTo(enemy.coverNode.position) > 0.75;
  if (enemy.intent === "suppress") return hasSight && distance <= enemy.config.attackRange + 3 && enemy.coverNode;
  if (enemy.intent === "flank") return enemy.flankCommit > 0 && distance > 4.2;
  if (enemy.intent === "rush") return distance < 16;
  if (enemy.intent === "push") return distance > enemy.config.attackRange * 0.75 || !hasSight;
  return enemy.intentTimer > 0.15;
}

function getSharedTarget(enemy) {
  const squad = getSquad(enemy.squadId);
  if (squad && squad.memoryAge < 6) return squad.lastKnownPlayer.clone();
  return enemy.lastKnownPlayer.clone();
}

function findSquadFlankPoint(enemy, direction, distance) {
  const squad = getSquad(enemy.squadId);
  const originalDir = enemy.strafeDir;
  if (squad) {
    const roleSide = enemy.squadRole === "charger" ? -1 : 1;
    const indexSide = enemy.squadIndex % 2 === 0 ? 1 : -1;
    enemy.strafeDir = squad.flankDir * roleSide * indexSide;
  }
  const point = findFlankPoint(enemy, direction, distance);
  enemy.strafeDir = originalDir;
  return point;
}

function planScoutBehavior(enemy, distance, direction, hasSight) {
  const squad = getSquad(enemy.squadId);
  const sharedTarget = getSharedTarget(enemy);
  releaseCoverNode(enemy);
  if (!hasSight && enemy.lostSightTimer < 3.5) {
    setEnemyIntent(enemy, "investigate", 0.7, sharedTarget);
    return;
  }
  if (enemy.squadRole === "charger" || squad?.order === "collapse") {
    setEnemyIntent(enemy, "rush", 0.55, sharedTarget);
    return;
  }
  if (distance > 20 && squad?.order !== "pinAndFlank") {
    setEnemyIntent(enemy, "advance", 0.8, sharedTarget);
    return;
  }
  if (distance > 4.4) {
    const flankPoint = findSquadFlankPoint(enemy, direction, distance);
    if (flankPoint) {
      enemy.flankCommit = 1.4 + rand() * 0.8;
      setEnemyIntent(enemy, "flank", enemy.flankCommit, flankPoint);
      return;
    }
  }
  setEnemyIntent(enemy, "rush", 0.42, player.position);
}

function planTrooperBehavior(enemy, distance, hasSight) {
  const squad = getSquad(enemy.squadId);
  const sharedTarget = getSharedTarget(enemy);
  const healthRatio = enemy.health / enemy.maxHealth;
  if (enemy.squadRole === "flanker" && squad?.order === "pinAndFlank") {
    const toPlayer = tmpVec.subVectors(player.position, enemy.position).setY(0);
    const dir = toPlayer.lengthSq() > 0.01 ? toPlayer.normalize() : new THREE.Vector3(0, 0, 1);
    const flankPoint = findSquadFlankPoint(enemy, dir, distance);
    if (flankPoint) {
      enemy.flankCommit = 1.3 + rand() * 0.7;
      setEnemyIntent(enemy, "flank", enemy.flankCommit, flankPoint);
      return;
    }
  }

  if (enemy.coverNode && enemy.position.distanceTo(enemy.coverNode.position) < 1.0 && hasSight) {
    setEnemyIntent(enemy, "suppress", 1.0 + rand() * 0.7, getCoverPeekPoint(enemy.coverNode, enemy), enemy.coverNode);
    return;
  }

  const shouldReposition = enemy.repositionCooldown <= 0
    || healthRatio < 0.48
    || enemy.squadRole === "defender"
    || (hasSight && distance < enemy.config.preferredRange * 0.75);
  if (shouldReposition) {
    const cover = findBestCoverNode(enemy, distance);
    if (cover) {
      enemy.repositionCooldown = 2.4 + rand() * 1.6;
      setEnemyIntent(enemy, "takeCover", 2.1, cover.position, cover);
      return;
    }
  }

  if (!hasSight && enemy.lostSightTimer < 4) {
    const cover = findBestCoverNode(enemy, distance);
    if (cover) {
      setEnemyIntent(enemy, "takeCover", 1.7, cover.position, cover);
      return;
    }
    setEnemyIntent(enemy, "investigate", 0.9, sharedTarget);
    return;
  }

  if (hasSight && distance <= enemy.config.attackRange && (enemy.squadRole === "suppressor" || enemy.squadRole === "leader" || squad?.order === "pinAndFlank")) {
    setEnemyIntent(enemy, "suppress", 0.95, makeStrafePoint(enemy, player.position, enemy.config.preferredRange), null);
    return;
  }

  setEnemyIntent(enemy, "advance", 0.9, sharedTarget);
}

function planHeavyBehavior(enemy, distance, hasSight) {
  const squad = getSquad(enemy.squadId);
  const sharedTarget = getSharedTarget(enemy);
  releaseCoverNode(enemy);
  if (!hasSight && enemy.lostSightTimer < 3.8) {
    setEnemyIntent(enemy, "investigate", 0.9, sharedTarget);
    return;
  }
  if (distance < enemy.config.attackRange + 0.9) {
    setEnemyIntent(enemy, "brace", 0.45, player.position);
    return;
  }
  const lead = sharedTarget.clone();
  if (hasSight || squad?.memoryAge < 2.5) {
    const pressure = tmpVec2.subVectors(player.position, enemy.position).setY(0).normalize();
    lead.add(pressure.multiplyScalar(squad?.order === "collapse" ? -0.8 : -1.6));
  }
  setEnemyIntent(enemy, "push", 0.8, lead);
}

function setEnemyIntent(enemy, intent, duration, point, coverNode = null) {
  if (coverNode) claimCoverNode(enemy, coverNode);
  else if (enemy.coverNode && intent !== "suppress") releaseCoverNode(enemy);
  const targetChanged = !enemy.intentPoint || enemy.intentPoint.distanceToSquared(point) > 4;
  enemy.intent = intent;
  enemy.intentTimer = duration;
  enemy.intentPoint = point.clone();
  if (targetChanged || enemy.navPath.length === 0) requestEnemyPath(enemy, true);
}

function claimCoverNode(enemy, node) {
  if (enemy.coverNode === node) return;
  releaseCoverNode(enemy);
  enemy.coverNode = node;
  node.claimedBy = enemy;
  node.heat = 1;
}

function releaseCoverNode(enemy) {
  if (enemy.coverNode?.claimedBy === enemy) enemy.coverNode.claimedBy = null;
  enemy.coverNode = null;
}

function updateEnemyNavigation(enemy, dt) {
  if (!enemy.intentPoint) return;
  if (world.nav.dirty) requestEnemyPath(enemy, true);

  const moved = enemy.position.distanceTo(enemy.navLastPosition);
  if (moved < 0.025 && Math.hypot(enemy.velocity.x, enemy.velocity.z) > 0.2) {
    enemy.navStuckTimer += dt;
  } else {
    enemy.navStuckTimer = Math.max(0, enemy.navStuckTimer - dt * 2);
    enemy.navLastPosition.copy(enemy.position);
  }

  if (enemy.navStuckTimer > 0.65) {
    requestEnemyPath(enemy, true);
    enemy.navStuckTimer = 0;
    enemy.retargetTimer = 0;
  } else if (enemy.navRefresh <= 0) {
    requestEnemyPath(enemy, false);
  }

  while (enemy.navPath.length && enemy.position.distanceTo(enemy.navPath[0]) < world.nav.cellSize * 0.42) {
    enemy.navPath.shift();
  }
}

function requestEnemyPath(enemy, force = false) {
  if (!enemy.intentPoint) return;
  if (!force && enemy.navTarget && enemy.navTarget.distanceToSquared(enemy.intentPoint) < 6.25 && enemy.navPath.length) {
    enemy.navRefresh = 0.55 + rand() * 0.45;
    return;
  }
  const path = findNavPath(enemy.position, enemy.intentPoint);
  enemy.navPath = path;
  enemy.navTarget = enemy.intentPoint.clone();
  enemy.navRefresh = enemy.intent === "rush" || enemy.intent === "push" ? 0.38 + rand() * 0.22 : 0.82 + rand() * 0.48;
}

function getEnemyNavigationTarget(enemy) {
  if (enemy.navPath?.length) return enemy.navPath[0];
  return enemy.intentPoint ?? player.position;
}

function findBestCoverNode(enemy, distanceToPlayer) {
  let bestNode = null;
  let bestScore = -Infinity;
  const desiredRange = enemy.config.ranged ? enemy.config.preferredRange : 7;
  for (const node of world.coverNodes) {
    if (node.claimedBy && node.claimedBy !== enemy) continue;
    if (!world.blockers.includes(node.blocker)) continue;
    const enemyDistance = enemy.position.distanceTo(node.position);
    if (enemyDistance > 38) continue;
    const playerDistance = node.position.distanceTo(player.position);
    if (playerDistance < 5 || playerDistance > 42) continue;
    const toPlayer = tmpVec.subVectors(player.position, node.position).setY(0).normalize();
    const behindCover = node.normal.dot(toPlayer) < -0.18;
    const peekPoint = getCoverPeekPoint(node, enemy);
    if (!isTacticalPointClear(peekPoint, 0.55)) continue;
    const peekSight = hasLineOfSight(peekPoint, player.position, enemy.config.height * 0.72, true);
    const rangeScore = -Math.abs(playerDistance - desiredRange) * 2.2;
    const travelScore = -enemyDistance * 0.42;
    const coverScore = behindCover ? 34 : -18;
    const peekScore = peekSight ? 18 : -10;
    const pressureScore = distanceToPlayer < enemy.config.preferredRange ? playerDistance * 0.55 : 0;
    const score = coverScore + peekScore + rangeScore + travelScore + pressureScore - node.heat * 7 + rand() * 3;
    if (score > bestScore) {
      bestScore = score;
      bestNode = node;
    }
  }
  return bestNode;
}

function getCoverPeekPoint(node, enemy) {
  const side = new THREE.Vector3(-node.normal.z, 0, node.normal.x).multiplyScalar(enemy.strafeDir * 0.72);
  return node.position.clone().add(node.normal.clone().multiplyScalar(0.28)).add(side);
}

function findFlankPoint(enemy, direction, distance) {
  const target = getSharedTarget(enemy);
  const fromPlayerToEnemy = enemy.position.clone().sub(target).setY(0);
  if (fromPlayerToEnemy.lengthSq() < 0.1) fromPlayerToEnemy.copy(direction).multiplyScalar(-1);
  fromPlayerToEnemy.normalize();
  const side = new THREE.Vector3(-fromPlayerToEnemy.z, 0, fromPlayerToEnemy.x).multiplyScalar(enemy.strafeDir);
  const radius = clamp(distance * 0.58, 7, 13);
  const candidates = [
    target.clone().add(side.clone().multiplyScalar(radius)).add(fromPlayerToEnemy.clone().multiplyScalar(3)),
    target.clone().add(side.clone().multiplyScalar(radius * 0.72)).add(fromPlayerToEnemy.clone().multiplyScalar(6)),
    target.clone().add(side.clone().multiplyScalar(radius * 1.08)),
  ];
  let best = null;
  let bestScore = -Infinity;
  candidates.forEach((candidate) => {
    candidate.y = 0;
    if (!isTacticalPointClear(candidate, enemy.radius + 0.18)) return;
    const travel = candidate.distanceTo(enemy.position);
    const playerDistance = candidate.distanceTo(target);
    const angleScore = Math.abs(angleDelta(Math.atan2(side.x, side.z), Math.atan2(candidate.x - target.x, candidate.z - target.z))) * -4;
    const coverBonus = hasLineOfSight(candidate, player.position, enemy.config.height * 0.72, true) ? 0 : 8;
    const score = -travel * 0.32 - Math.abs(playerDistance - radius) * 2.1 + angleScore + coverBonus;
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  });
  return best;
}

function makeStrafePoint(enemy, around, desiredRange) {
  const away = enemy.position.clone().sub(around).setY(0);
  if (away.lengthSq() < 0.1) away.set(0, 0, 1);
  away.normalize();
  const side = new THREE.Vector3(-away.z, 0, away.x).multiplyScalar(enemy.strafeDir);
  const point = around.clone()
    .add(away.multiplyScalar(desiredRange))
    .add(side.multiplyScalar(2.2 + rand() * 1.6));
  point.y = 0;
  return isTacticalPointClear(point, enemy.radius + 0.18) ? point : enemy.position.clone();
}

function chooseTacticalSteeringAngle(enemy) {
  const target = getEnemyNavigationTarget(enemy);
  const toTarget = tmpVec.subVectors(target, enemy.position).setY(0);
  if (toTarget.lengthSq() < 0.05) return enemy.pathAngle;
  const base = Math.atan2(toTarget.x, toTarget.z);
  const candidates = [
    base,
    base + 0.38,
    base - 0.38,
    base + 0.82,
    base - 0.82,
    base + 1.28,
    base - 1.28,
    base + Math.PI * 0.5,
    base - Math.PI * 0.5,
  ];
  let best = base;
  let bestScore = -Infinity;
  for (const angle of candidates) {
    const probe = enemy.position.clone();
    probe.x += Math.sin(angle) * 2.25;
    probe.z += Math.cos(angle) * 2.25;
    const blocked = !isTacticalPointClear(probe, enemy.radius + 0.16);
    const progressScore = -probe.distanceTo(target) * 7;
    const turnCost = -Math.abs(angleDelta(angle, enemy.pathAngle)) * 1.4;
    const separationPenalty = enemies.reduce((sum, other) => {
      if (other === enemy) return sum;
      const spacing = other.position.distanceTo(probe);
      return sum + (spacing < enemy.radius + other.radius + 1.05 ? 18 : spacing < 3.2 ? 4 : 0);
    }, 0);
    const exposurePenalty = enemy.intent === "takeCover" && hasLineOfSight(player.position, probe, player.height * 0.72, true) ? 8 : 0;
    const score = (blocked ? -260 : 0) + progressScore + turnCost - separationPenalty - exposurePenalty;
    if (score > bestScore) {
      bestScore = score;
      best = angle;
    }
  }
  return best;
}

function getIntentStopDistance(enemy) {
  if (enemy.intent === "takeCover") return 0.62;
  if (enemy.intent === "suppress") return 0.4;
  if (enemy.intent === "brace") return enemy.config.attackRange + 0.2;
  if (enemy.intent === "rush") return 0.15;
  return 0.75;
}

function getIntentSpeedScale(enemy, distance, hasSight) {
  const squad = getSquad(enemy.squadId);
  if (enemy.intent === "suppress") return 0.48;
  if (enemy.intent === "takeCover") return 1.08;
  if (enemy.intent === "flank") return squad?.order === "pinAndFlank" ? 1.28 : 1.18;
  if (enemy.intent === "rush") return squad?.order === "collapse" ? 1.28 : 1.2;
  if (enemy.intent === "push") return hasSight && distance < 8 ? 0.78 : squad?.order === "collapse" ? 1.05 : 0.92;
  if (enemy.intent === "brace") return 0;
  return distance > 28 ? 1.1 : 0.95;
}

function canEnemyAttack(enemy, distance, hasSight) {
  if (enemy.attackCooldown > 0 || !hasSight) return false;
  if (enemy.config.ranged) {
    if (distance > enemy.config.attackRange) return false;
    return enemy.intent === "suppress"
      || enemy.squadRole === "suppressor"
      || enemy.squadRole === "leader"
      || enemy.intent === "advance"
      || enemy.intent === "investigate"
      || enemy.sightTimer > 0.45;
  }
  return distance <= enemy.config.attackRange + player.radius;
}

function updateEnemyVisuals(enemy, dt) {
  if (enemy.healthFill) {
    const healthRatio = clamp(enemy.health / enemy.maxHealth, 0, 1);
    enemy.healthFill.scale.x = Math.max(0.03, healthRatio);
    enemy.healthFill.position.x = -0.42 * (1 - healthRatio);
    enemy.healthFill.material.color.setHex(healthRatio < 0.35 ? 0xef6262 : healthRatio < 0.68 ? 0xf7c95f : 0x65f08c);
    enemy.healthBar.quaternion.copy(camera.quaternion);
  }

  const stride = game.elapsed * enemy.config.speed * 2.5;
  const swing = Math.sin(stride) * 0.18;
  const hitRatio = enemy.hitReactMax > 0 ? clamp(enemy.hitReact / enemy.hitReactMax, 0, 1) : 0;
  const hitKick = Math.sin(hitRatio * Math.PI) * 0.18;
  enemy.group.children.forEach((child) => {
    if (child.userData.basePosition) {
      child.position.copy(child.userData.basePosition);
      if (hitKick > 0) {
        const limbScale = child.userData.limb ? 1.18 : child.name === "helmet" || child.name === "visor" ? 1.35 : 1;
        child.position.add(enemy.hitVectorLocal.clone().multiplyScalar(hitKick * limbScale));
        child.position.y += hitKick * 0.14;
      }
    }
    const baseRotation = child.userData.baseRotation;
    if (baseRotation) child.rotation.copy(baseRotation);
    if (baseRotation && (child.userData.limb === "leftArm" || child.userData.limb === "rightLeg")) {
      child.rotation.x += swing;
    }
    if (baseRotation && (child.userData.limb === "rightArm" || child.userData.limb === "leftLeg")) {
      child.rotation.x -= swing;
    }
    if (baseRotation && hitKick > 0) {
      child.rotation.x += hitKick * (child.userData.limb ? 1.2 : 0.55);
      child.rotation.z += hitKick * 0.25 * (child.position.x < 0 ? -1 : 1);
    }
    if (child.name === "enemyGroundRing") {
      child.rotation.z += dt * (enemy.config.ranged ? 0.9 : 1.4);
      child.material.opacity = 0.34 + Math.sin(game.elapsed * 4.2 + enemy.pathAngle) * 0.08;
    }
    if (child.userData.flash) {
      child.userData.flash -= dt;
      if (child.userData.flash <= 0 && child.material?.emissive) {
        child.material.emissive.setHex(child.userData.baseEmissive ?? 0x000000);
        child.material.emissiveIntensity = child.userData.baseEmissiveIntensity ?? 1;
        child.userData.flash = 0;
        delete child.userData.baseEmissive;
        delete child.userData.baseEmissiveIntensity;
      }
    }
  });
}

function angleDelta(a, b) {
  return Math.atan2(Math.sin(a - b), Math.cos(a - b));
}

function resolveEnemyAxis(enemy, axis) {
  for (const blocker of world.enemyBlockers) {
    const closestX = clamp(enemy.position.x, blocker.minX, blocker.maxX);
    const closestZ = clamp(enemy.position.z, blocker.minZ, blocker.maxZ);
    const dx = enemy.position.x - closestX;
    const dz = enemy.position.z - closestZ;
    const distSq = dx * dx + dz * dz;
    if (distSq >= enemy.radius * enemy.radius) continue;
    if (axis === "x") {
      enemy.position.x = enemy.position.x < (blocker.minX + blocker.maxX) / 2 ? blocker.minX - enemy.radius : blocker.maxX + enemy.radius;
      enemy.velocity.x = 0;
    } else {
      enemy.position.z = enemy.position.z < (blocker.minZ + blocker.maxZ) / 2 ? blocker.minZ - enemy.radius : blocker.maxZ + enemy.radius;
      enemy.velocity.z = 0;
    }
  }
}

function separateEnemies(dt) {
  for (let i = 0; i < enemies.length; i += 1) {
    for (let j = i + 1; j < enemies.length; j += 1) {
      const a = enemies[i];
      const b = enemies[j];
      const delta = tmpVec.subVectors(a.position, b.position);
      delta.y = 0;
      const minDistance = a.radius + b.radius + 0.25;
      const distSq = delta.lengthSq();
      if (distSq <= 0.0001 || distSq > minDistance * minDistance) continue;
      const dist = Math.sqrt(distSq);
      const push = (minDistance - dist) * 0.5;
      delta.multiplyScalar(push / dist);
      a.position.add(delta);
      b.position.sub(delta);
      a.velocity.add(delta.clone().multiplyScalar(2 * dt));
      b.velocity.sub(delta.clone().multiplyScalar(2 * dt));
    }
  }
}

function enemyAttack(enemy, direction, distance) {
  if (enemy.config.ranged) {
    playEnemyShotSound();
    const origin = enemy.muzzleLocal
      ? enemy.muzzleLocal.clone().applyQuaternion(enemy.group.quaternion).add(enemy.position)
      : enemy.position.clone().add(new THREE.Vector3(0, enemy.config.height * 0.68, 0));
    const target = player.position.clone();
    target.y -= 0.25;
    const dir = target.sub(origin).normalize();
    dir.x += (rand() - 0.5) * 0.045;
    dir.y += (rand() - 0.5) * 0.02;
    dir.z += (rand() - 0.5) * 0.045;
    dir.normalize();
    createEnemyMuzzleFlash(enemy, origin, dir);
    const projectile = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 8, 6),
      new THREE.MeshBasicMaterial({ color: enemy.config.accent }),
    );
    projectile.position.copy(origin);
    scene.add(projectile);
    projectiles.push({
      mesh: projectile,
      velocity: dir.multiplyScalar(25),
      damage: enemy.config.attackDamage,
      life: 2.6,
    });
    if (enemy.burstShots <= 0) {
      enemy.burstShots = enemy.intent === "suppress" ? 2 + Math.floor(rand() * 2) : 1;
    } else {
      enemy.burstShots -= 1;
    }
    enemy.attackCooldown = enemy.burstShots > 0
      ? 0.23 + rand() * 0.08
      : enemy.config.attackRate + rand() * 0.42;
  } else if (distance < enemy.config.attackRange + player.radius) {
    damagePlayer(enemy.config.attackDamage);
    enemy.velocity.add(direction.clone().multiplyScalar(-2));
    enemy.attackCooldown = enemy.config.attackRate + rand() * 0.25;
  }
}

function createEnemyMuzzleFlash(enemy, origin, direction) {
  const color = enemy.config.accent;
  const flash = new THREE.Mesh(
    new THREE.ConeGeometry(0.1, 0.34, 8, 1, true),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.74,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    }),
  );
  flash.position.copy(origin).add(direction.clone().multiplyScalar(0.16));
  flash.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
  flash.rotateX(Math.PI / 2);
  scene.add(flash);
  effects.push({ object: flash, life: 0.08, maxLife: 0.08, type: "enemyMuzzle", grow: 1.1 });

  const light = new THREE.PointLight(color, 1.6, 4.5, 2);
  light.position.copy(origin);
  scene.add(light);
  effects.push({ object: light, life: 0.06, maxLife: 0.06, type: "enemyMuzzleLight" });

  const tracerEnd = origin.clone().add(direction.clone().multiplyScalar(12));
  const material = tracerMaterial.clone();
  material.color.setHex(color);
  material.opacity = 0.42;
  const tracer = new THREE.Line(new THREE.BufferGeometry().setFromPoints([origin, tracerEnd]), material);
  scene.add(tracer);
  effects.push({ object: tracer, life: 0.07, maxLife: 0.07, type: "enemyTracer" });
}

function updateProjectiles(dt) {
  for (let i = projectiles.length - 1; i >= 0; i -= 1) {
    const projectile = projectiles[i];
    projectile.life -= dt;
    const previous = projectile.mesh.position.clone();
    projectile.mesh.position.addScaledVector(projectile.velocity, dt);
    const distance = projectile.mesh.position.distanceTo(player.position.clone().setY(projectile.mesh.position.y));
    if (distance < player.radius + 0.25 && Math.abs(projectile.mesh.position.y - (player.position.y - 0.6)) < 1.3) {
      damagePlayer(projectile.damage);
      createImpact(projectile.mesh.position, projectile.velocity.clone().normalize().multiplyScalar(-1), 0xff8f70, { decal: false });
      scene.remove(projectile.mesh);
      projectiles.splice(i, 1);
      continue;
    }
    const direction = projectile.velocity.clone().normalize();
    const hit = raycastBlockers(previous, direction, previous.distanceTo(projectile.mesh.position));
    if (hit || projectile.life <= 0) {
      if (hit) createImpact(hit.point, hit.normal, 0xff8f70);
      scene.remove(projectile.mesh);
      projectiles.splice(i, 1);
    }
  }
}

function damagePlayer(amount) {
  if (!player.alive || player.invulnerable > 0) return;
  let remaining = amount;
  if (player.armor > 0) {
    const absorbed = Math.min(player.armor, remaining * 0.65);
    player.armor -= absorbed;
    remaining -= absorbed;
  }
  player.health = Math.max(0, player.health - remaining);
  player.invulnerable = 0.18;
  player.hurtPulse = 0.32;
  game.shake = Math.max(game.shake, 0.03);
  playPlayerDamageSound();
  ui.damageVignette.classList.remove("flash");
  void ui.damageVignette.offsetWidth;
  ui.damageVignette.classList.add("flash");
  window.clearTimeout(ui.damageVignette.userData?.timer);
  ui.damageVignette.userData = ui.damageVignette.userData ?? {};
  ui.damageVignette.userData.timer = window.setTimeout(() => {
    ui.damageVignette.classList.remove("flash");
  }, 180);
  if (navigator.vibrate) navigator.vibrate(35);
  if (player.health <= 0) endGame();
  updateHud();
}

function damageInteractive(interactive, amount, point, normal) {
  if (!interactive.active) return;
  if (interactive.type === "gate") {
    createImpact(point, normal, interactive.accent, { decal: false });
    showNotice("Gate locked. Shoot the nearby relay.");
    return;
  }

  interactive.health -= amount;
  interactive.group.traverse((child) => {
    if (child.isMesh && child.material?.emissive) {
      child.material.emissive.setHex(0xffffff);
      child.material.emissiveIntensity = Math.max(child.material.emissiveIntensity, 1.2);
      child.userData.flash = 0.12;
    }
  });
  createImpact(point, normal, interactive.accent ?? 0xf7c95f, { decal: false });

  if (interactive.health > 0) return;
  if (interactive.type === "terminal") {
    openSecurityGate(interactive);
    return;
  }
  destroyInteractive(interactive);
}

function openSecurityGate(terminal) {
  terminal.active = false;
  removeBlocker(terminal.blocker);
  terminal.group.traverse((child) => {
    if (child.isMesh && child.material?.emissive) {
      child.material.emissive.setHex(0x65f08c);
      child.material.emissiveIntensity = 1.6;
    }
  });
  if (terminal.linkedGate) {
    terminal.linkedGate.open = true;
    terminal.linkedGate.active = false;
    removeBlocker(terminal.linkedGate.blocker);
  }
  createBurst(terminal.group.position.clone().add(new THREE.Vector3(0, 0.8, 0)), 0x72d6ff, 10);
  showNotice("Security gate opened.");
}

function destroyInteractive(interactive) {
  interactive.active = false;
  interactive.group.visible = false;
  removeBlocker(interactive.blocker);
  const center = interactive.group.position.clone().add(new THREE.Vector3(0, 0.65, 0));
  if (interactive.type === "barrel") {
    createMapExplosion(center, interactive.accent ?? 0xff8f70, 8.5, 70);
    showNotice("Fuel barrel detonated.");
    return;
  }
  createBurst(center, interactive.accent ?? 0xf7c95f, 14);
  createPickup(interactive.group.position, interactive.drop ?? (rand() > 0.5 ? "ammo" : "armor"));
  showNotice("Supply crate opened.");
}

function createMapExplosion(center, color, radius, damage) {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.6, 1.0, 36),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    }),
  );
  ring.position.copy(center);
  ring.rotation.x = Math.PI / 2;
  scene.add(ring);
  effects.push({ object: ring, life: 0.48, maxLife: 0.48, type: "explosionRing", grow: radius * 0.65 });

  const flash = new THREE.PointLight(color, 5, radius * 2.1, 2);
  flash.position.copy(center);
  scene.add(flash);
  effects.push({ object: flash, life: 0.16, maxLife: 0.16, type: "flashLight", lightIntensity: 5 });
  createBurst(center, color, 28);
  playEnemyDeathSound();
  game.shake = Math.max(game.shake, 0.09);

  [...enemies].forEach((enemy) => {
    const target = enemy.position.clone().add(new THREE.Vector3(0, enemy.config.height * 0.62, 0));
    const dist = target.distanceTo(center);
    if (dist > radius) return;
    const direction = target.clone().sub(center).normalize();
    damageEnemy(enemy, damage * (1 - dist / radius), target, direction, "core");
  });

  const playerTarget = player.position.clone().add(new THREE.Vector3(0, -0.65, 0));
  const playerDist = playerTarget.distanceTo(center);
  if (playerDist < radius) {
    damagePlayer(damage * 0.55 * (1 - playerDist / radius));
  }
}

function updateInteractives(dt) {
  world.interactives.forEach((interactive) => {
    if (interactive.type === "gate") {
      const targetY = interactive.open ? -2.2 : 0;
      interactive.group.position.y = damp(interactive.group.position.y, targetY, 5.5, dt);
    }
    interactive.group.traverse((child) => {
      if (!child.isMesh || !child.userData.flash) return;
      child.userData.flash -= dt;
      if (child.userData.flash <= 0 && child.material?.emissive) {
        child.material.emissive.setHex(child.userData.baseEmissive ?? 0x000000);
        child.material.emissiveIntensity = child.userData.baseEmissiveIntensity ?? 0;
        child.userData.flash = 0;
      }
    });
  });
}

function updatePickups(dt) {
  for (let i = world.pickups.length - 1; i >= 0; i -= 1) {
    const pickup = world.pickups[i];
    pickup.life -= dt;
    pickup.group.rotation.y += dt * 2.4;
    pickup.group.position.y = 0.72 + Math.sin(game.elapsed * 4 + i) * 0.12;
    if (pickup.group.position.distanceTo(player.position) < 1.7) {
      if (pickup.type === "ammo") {
        weapons.forEach((weapon) => {
          weapon.reserve += Math.floor(weapon.magazine * 0.5);
        });
        showNotice("Ammo recovered.");
      } else {
        player.armor = clamp(player.armor + 28, 0, 100);
        showNotice("Armor restored.");
      }
      playPickupSound();
      scene.remove(pickup.group);
      world.pickups.splice(i, 1);
      updateHud();
    } else if (pickup.life <= 0) {
      scene.remove(pickup.group);
      world.pickups.splice(i, 1);
    }
  }
}

function removeEffect(effect) {
  if (effect.object.parent) {
    effect.object.parent.remove(effect.object);
  } else {
    scene.remove(effect.object);
  }
  if (effect.type === "decal") {
    const decalIndex = world.decals.indexOf(effect.object);
    if (decalIndex >= 0) world.decals.splice(decalIndex, 1);
  }
}

function clearEnemyAttachedEffects(enemy) {
  for (let i = effects.length - 1; i >= 0; i -= 1) {
    const effect = effects[i];
    if (effect.owner === enemy && effect.removeWithOwner) {
      removeEffect(effect);
      effects.splice(i, 1);
    }
  }
}

function updateEffects(dt) {
  while (effects.length > MAX_EFFECTS) {
    const old = effects.shift();
    if (old) removeEffect(old);
  }
  for (let i = effects.length - 1; i >= 0; i -= 1) {
    const effect = effects[i];
    if (effect.owner && effect.removeWithOwner && !effect.owner.alive) {
      removeEffect(effect);
      effects.splice(i, 1);
      continue;
    }
    effect.life -= dt;
    if (effect.velocity) {
      effect.object.position.addScaledVector(effect.velocity, dt);
      effect.velocity.y -= 6 * dt;
      effect.object.rotation.x += dt * 10;
      effect.object.rotation.y += dt * 7;
    }
    if (effect.grow) {
      const progress = clamp(1 - effect.life / effect.maxLife, 0, 1);
      effect.object.scale.setScalar(1 + progress * effect.grow);
    }
    const opacity = Math.max(0, effect.life / effect.maxLife);
    if (effect.lightIntensity !== undefined && effect.object.isLight) {
      effect.object.intensity = opacity * effect.lightIntensity;
    }
    if (Array.isArray(effect.object.material)) {
      effect.object.material.forEach((material) => {
        if (material?.transparent) material.opacity = opacity;
      });
    } else if (effect.object.material?.transparent) {
      effect.object.material.opacity = opacity;
    }
    if (effect.life <= 0) {
      removeEffect(effect);
      effects.splice(i, 1);
    }
  }
}

function updateHud() {
  const weapon = weapons[player.weaponIndex];
  const reloadProgress = weapon.reloading > 0 ? clamp(1 - weapon.reloading / weapon.reloadTime, 0, 1) : 0;
  ui.healthLabel.textContent = `Health ${Math.ceil(clamp(player.health, 0, 100))}`;
  ui.armorLabel.textContent = `Armor ${Math.ceil(clamp(player.armor, 0, 100))}`;
  ui.healthFill.style.width = `${clamp(player.health, 0, 100)}%`;
  ui.armorFill.style.width = `${clamp(player.armor, 0, 100)}%`;
  ui.wave.textContent = `Wave ${game.wave}`;
  ui.score.textContent = `Score ${player.score}`;
  ui.weaponName.textContent = weapon.name;
  ui.ammo.textContent = weapon.reloading > 0
    ? "Reloading"
    : `${weapon.ammo} / ${weapon.reserve}`;
  ui.weaponPanel.classList.toggle("reloading", weapon.reloading > 0);
  ui.reloadFill.style.transform = `scaleX(${reloadProgress})`;
  ui.weaponSlots.forEach((slot, index) => {
    slot.classList.toggle("active", index === player.weaponIndex);
  });
}

function showNotice(message) {
  game.lastNotice = message;
  game.noticeTimer = 2.4;
  ui.notice.textContent = message;
}

function updateNotice(dt) {
  game.noticeTimer = Math.max(0, game.noticeTimer - dt);
  ui.notice.style.opacity = game.noticeTimer > 0 ? "1" : "0";
}

function endGame() {
  player.alive = false;
  setGameState("gameover");
  document.exitPointerLock?.();
  ui.finalScore.textContent = `Score ${player.score} | Wave ${game.wave} | Kills ${player.kills}`;
}

function onResize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
  renderer.setSize(width, height);
  composer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
  composer.setSize(width, height);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function bindEvents() {
  window.addEventListener("resize", onResize);
  document.addEventListener("pointerlockchange", () => {
    input.pointerLocked = document.pointerLockElement === canvas;
    if (!input.pointerLocked && game.state === "playing") {
      setGameState("paused");
    }
  });
  document.addEventListener("mousemove", (event) => {
    if (!input.pointerLocked || game.state !== "playing") return;
    player.yaw -= event.movementX * 0.0022;
    player.pitch -= event.movementY * 0.0022;
    input.lookX += event.movementX;
    input.lookY += event.movementY;
    player.pitch = clamp(player.pitch, -1.38, 1.28);
  });
  document.addEventListener("mousedown", (event) => {
    if (event.button === 2) {
      input.ads = true;
      event.preventDefault();
    }
    if (event.button === 0) {
      input.mouseDown = true;
      input.fireQueued = true;
    }
    if (game.state === "playing") requestPointer();
  });
  document.addEventListener("mouseup", (event) => {
    if (event.button === 0) input.mouseDown = false;
    if (event.button === 2) input.ads = false;
  });
  document.addEventListener("contextmenu", (event) => event.preventDefault());
  document.addEventListener("keydown", (event) => {
    const code = event.code.toLowerCase();
    input.keys.add(code);
    if (code === "keyr") input.reloadRequested = true;
    if (code === "digit1") input.switchTo = 0;
    if (code === "digit2") input.switchTo = 1;
    if (code === "digit3") input.switchTo = 2;
    if (code === "digit4") input.switchTo = 3;
    if (code === "digit5") input.switchTo = 4;
    if (code === "digit6") input.switchTo = 5;
    if (code === "escape" && game.state === "playing") {
      setGameState("paused");
      document.exitPointerLock?.();
    }
  });
  document.addEventListener("keyup", (event) => {
    input.keys.delete(event.code.toLowerCase());
  });
  ui.startButton.addEventListener("click", startMission);
  ui.resumeButton.addEventListener("click", () => {
    initAudio();
    setGameState("playing");
    requestPointer();
  });
  ui.restartButton.addEventListener("click", startMission);
  canvas.addEventListener("click", () => {
    if (game.state === "playing") requestPointer();
  });
}

function renderLoop() {
  const rawDt = clock.getDelta();
  const dt = Math.min(rawDt, 0.033);
  game.elapsed += dt;

  if (game.state === "playing") {
    updatePlayer(dt);
    updateWeapons(dt);
    updateEnemies(dt);
    updatePendingSpawns(dt);
    updateProjectiles(dt);
    updatePickups(dt);
    updateInteractives(dt);
    maybeSpawnReinforcement(dt);
    updateEffects(dt);
    updateNotice(dt);
    game.hudTimer -= dt;
    if (game.hudTimer <= 0) {
      updateHud();
      game.hudTimer = weapons[player.weaponIndex].reloading > 0 ? 0.035 : 0.1;
    }
  } else {
    camera.position.lerp(new THREE.Vector3(0, 18, 42), 0.025);
    camera.lookAt(0, 4, 0);
    world.lamps.forEach((lamp, index) => {
      lamp.intensity = 0.85 + Math.sin(game.elapsed * 1.2 + index) * 0.08;
    });
    updateEffects(dt);
  }

  if (game.state === "playing") {
    renderer.render(scene, camera);
  } else {
    composer.render();
  }
  requestAnimationFrame(renderLoop);
}

createCity();
createWeaponRig();
applyPbrMaterials();
loadExternalAssets();
bindEvents();
setGameState("menu");
showNotice(game.lastNotice);
camera.position.set(0, 18, 42);
camera.lookAt(0, 4, 0);
renderLoop();
