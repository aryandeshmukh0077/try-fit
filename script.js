const video = document.querySelector(".input_video");
const canvas = document.querySelector(".output_canvas");
const ctx = canvas.getContext("2d");
const result = document.getElementById("result");

const refs = {
  appLoader: document.getElementById("appLoader"),
  cameraStage: document.querySelector(".camera-stage"),
  cameraStatus: document.getElementById("cameraStatus"),
  metricShoulder: document.getElementById("metricShoulder"),
  metricChest: document.getElementById("metricChest"),
  metricWaist: document.getElementById("metricWaist"),
  metricHip: document.getElementById("metricHip"),
  metricHeight: document.getElementById("metricHeight"),
  metricBodyType: document.getElementById("metricBodyType"),
  metricConfidence: document.getElementById("metricConfidence"),
  metricFps: document.getElementById("metricFps"),
  skeletonToggle: document.getElementById("skeletonToggle"),
  measurementToggle: document.getElementById("measurementToggle"),
  tryOnToggle: document.getElementById("tryOnToggle"),
  voiceToggle: document.getElementById("voiceToggle"),
  fpsToggle: document.getElementById("fpsToggle"),
  cameraSelect: document.getElementById("cameraSelect"),
  resolutionSelect: document.getElementById("resolutionSelect"),
  themeToggle: document.getElementById("themeToggle"),
  startScanButton: document.getElementById("startScanButton"),
  downloadReportButton: document.getElementById("downloadReportButton"),
  screenshotButton: document.getElementById("screenshotButton"),
  measurementReportButton: document.getElementById("measurementReportButton"),
  pdfButton: document.getElementById("pdfButton"),
  saveHistoryButton: document.getElementById("saveHistoryButton"),
  stylistOutput: document.getElementById("stylistOutput"),
  occasionSelect: document.getElementById("occasionSelect"),
  budgetSelect: document.getElementById("budgetSelect"),
  shirtSelect: document.getElementById("shirtSelect"),
  shirtColorSelect: document.getElementById("shirtColorSelect"),
  shirtTextureSelect: document.getElementById("shirtTextureSelect"),
  tryOnPreview: document.getElementById("tryOnPreview")
};

const LANDMARK = {
  NOSE: 0,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28
};

const SHIRT_CATALOG = {
  classic: {
    label: "Classic Fit Shirt",
    modelUrl: "assets/models/classic-shirt.glb",
    baseScale: 1
  },
  streetwear: {
    label: "Streetwear Overshirt",
    modelUrl: "assets/models/streetwear-overshirt.glb",
    baseScale: 1.08
  },
  oxford: {
    label: "Formal Oxford",
    modelUrl: "assets/models/formal-oxford.glb",
    baseScale: 0.96
  }
};

const SHIRT_COLORS = {
  midnight: { label: "Midnight Black", value: 0x15181d },
  electric: { label: "Electric Blue", value: 0x1f8cff },
  white: { label: "Soft White", value: 0xf1f4ed }
};

const SHIRT_TEXTURES = {
  cotton: { label: "Cotton", roughness: 0.86, metalness: 0.02 },
  denim: { label: "Denim", roughness: 0.94, metalness: 0.01 },
  knit: { label: "Performance Knit", roughness: 0.72, metalness: 0.04 }
};

const state = {
  running: false,
  processing: false,
  stream: null,
  rafId: null,
  resolution: { width: 640, height: 480 },
  deviceId: "",
  smoothedLandmarks: null,
  latestScan: null,
  scanHistory: [],
  fps: 0,
  frameCount: 0,
  lastFpsTime: performance.now(),
  lastDomUpdate: 0,
  lastVoiceAt: 0,
  inferenceTime: 0,
  settings: {
    showSkeleton: true,
    showMeasurements: true,
    showTryOn: true,
    voice: false,
    showFps: true,
    theme: "dark"
  },
  tryOn: {
    available: false,
    overlayScene: null,
    overlayCamera: null,
    overlayRenderer: null,
    overlayRoot: null,
    studioScene: null,
    studioCamera: null,
    studioRenderer: null,
    studioRoot: null,
    loader: null,
    statusEl: null,
    modelCache: new Map(),
    modelFailureCache: new Set(),
    currentModelKey: "",
    currentStyleKey: "",
    studioRafId: null,
    current: {
      x: 320,
      y: 220,
      scale: 1,
      rotation: 0
    },
    target: {
      x: 320,
      y: 220,
      scale: 1,
      rotation: 0
    },
    hasAnchor: false
  }
};

if (!video || !canvas || !ctx || !result) {
  throw new Error("FitVision AI could not find the required video, canvas, or result elements.");
}

if (typeof Pose === "undefined") {
  result.textContent = "MediaPipe Pose failed to load. Check your internet connection and reload the page.";
  throw new Error("MediaPipe Pose is not available.");
}

const pose = new Pose({
  locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`
});

pose.setOptions({
  modelComplexity: 1,
  smoothLandmarks: true,
  minDetectionConfidence: 0.55,
  minTrackingConfidence: 0.55
});

pose.onResults(handlePoseResults);

function getSize(px) {
  const scaledPx = px * (640 / canvas.width);

  if (scaledPx < 115) return "S";
  if (scaledPx < 145) return "M";
  if (scaledPx < 175) return "L";
  if (scaledPx < 205) return "XL";
  if (scaledPx < 235) return "2XL";
  if (scaledPx < 265) return "3XL";
  if (scaledPx < 295) return "4XL";
  return "5XL";
}

function initTryOnRenderer() {
  if (!refs.tryOnPreview || !refs.cameraStage || typeof THREE === "undefined") {
    setTryOnStatus("Three.js unavailable. Try-on preview is disabled.");
    return;
  }

  state.tryOn.available = true;
  state.tryOn.loader = typeof THREE.GLTFLoader === "function" ? new THREE.GLTFLoader() : null;

  state.tryOn.overlayScene = new THREE.Scene();
  state.tryOn.overlayCamera = new THREE.OrthographicCamera(0, canvas.width, 0, canvas.height, -1000, 1000);
  state.tryOn.overlayCamera.position.set(0, 0, 500);
  state.tryOn.overlayRoot = new THREE.Group();
  state.tryOn.overlayScene.add(state.tryOn.overlayRoot);
  addTryOnLights(state.tryOn.overlayScene, true);

  state.tryOn.overlayRenderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: true,
    powerPreference: "high-performance"
  });
  state.tryOn.overlayRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  state.tryOn.overlayRenderer.setClearColor(0x000000, 0);
  state.tryOn.overlayRenderer.domElement.className = "tryon-overlay";
  refs.cameraStage.appendChild(state.tryOn.overlayRenderer.domElement);

  state.tryOn.studioScene = new THREE.Scene();
  state.tryOn.studioCamera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
  state.tryOn.studioCamera.position.set(0, 0.15, 4.8);
  state.tryOn.studioRoot = new THREE.Group();
  state.tryOn.studioScene.add(state.tryOn.studioRoot);
  addTryOnLights(state.tryOn.studioScene, false);

  state.tryOn.studioRenderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: true,
    powerPreference: "high-performance"
  });
  state.tryOn.studioRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  state.tryOn.studioRenderer.setClearColor(0x000000, 0);
  refs.tryOnPreview.appendChild(state.tryOn.studioRenderer.domElement);
  refs.tryOnPreview.classList.add("is-three-ready");

  const status = document.createElement("div");
  status.className = "tryon-status";
  status.textContent = "Preparing 3D shirt";
  refs.tryOnPreview.appendChild(status);
  state.tryOn.statusEl = status;

  updateTryOnRendererSizes();
  loadSelectedShirtModel();
  animateTryOnStudio();

  window.addEventListener("resize", updateTryOnRendererSizes);
}

function addTryOnLights(scene, isOverlay) {
  const ambient = new THREE.AmbientLight(0xffffff, isOverlay ? 1.1 : 0.85);
  const key = new THREE.DirectionalLight(0xffffff, isOverlay ? 0.55 : 1.15);
  key.position.set(1.8, 2.4, 4);
  const rim = new THREE.DirectionalLight(0x34d6c5, isOverlay ? 0.35 : 0.7);
  rim.position.set(-2.4, 0.6, 3);

  scene.add(ambient);
  scene.add(key);
  scene.add(rim);
}

function updateTryOnRendererSizes() {
  if (!state.tryOn.available) return;

  if (state.tryOn.overlayRenderer && state.tryOn.overlayCamera) {
    state.tryOn.overlayRenderer.setSize(canvas.width, canvas.height, false);
    state.tryOn.overlayCamera.left = 0;
    state.tryOn.overlayCamera.right = canvas.width;
    state.tryOn.overlayCamera.top = 0;
    state.tryOn.overlayCamera.bottom = canvas.height;
    state.tryOn.overlayCamera.updateProjectionMatrix();
  }

  if (state.tryOn.studioRenderer && state.tryOn.studioCamera && refs.tryOnPreview) {
    const width = Math.max(1, refs.tryOnPreview.clientWidth);
    const height = Math.max(1, refs.tryOnPreview.clientHeight);
    state.tryOn.studioRenderer.setSize(width, height, false);
    state.tryOn.studioCamera.aspect = width / height;
    state.tryOn.studioCamera.updateProjectionMatrix();
  }
}

function animateTryOnStudio(time = 0) {
  if (!state.tryOn.available) return;

  const enabled = state.settings.showTryOn;
  refs.tryOnPreview.dataset.enabled = String(enabled);

  if (state.tryOn.studioRoot) {
    state.tryOn.studioRoot.visible = enabled;
    const fitWidth = getTryOnFitWidth(state.tryOn.studioRoot);
    const style = getSelectedShirtConfig();
    const studioScale = (1.7 / fitWidth) * style.baseScale;

    state.tryOn.studioRoot.position.set(0, 0.58, 0);
    state.tryOn.studioRoot.scale.setScalar(studioScale);
    state.tryOn.studioRoot.rotation.set(0.03, Math.sin(time * 0.0012) * 0.22, 0);
  }

  if (state.tryOn.studioRenderer && state.tryOn.studioScene && state.tryOn.studioCamera) {
    state.tryOn.studioRenderer.render(state.tryOn.studioScene, state.tryOn.studioCamera);
  }

  state.tryOn.studioRafId = requestAnimationFrame(animateTryOnStudio);
}

function loadSelectedShirtModel() {
  if (!state.tryOn.available) return;

  const styleKey = refs.shirtSelect?.value || "classic";
  const colorKey = refs.shirtColorSelect?.value || "midnight";
  const textureKey = refs.shirtTextureSelect?.value || "cotton";
  const modelKey = `${styleKey}:${colorKey}:${textureKey}`;
  const style = getSelectedShirtConfig();

  if (state.tryOn.currentModelKey === modelKey && state.tryOn.overlayRoot?.children.length) {
    return;
  }

  state.tryOn.currentModelKey = modelKey;
  state.tryOn.currentStyleKey = styleKey;

  if (!state.tryOn.loader || !style.modelUrl || state.tryOn.modelFailureCache.has(style.modelUrl)) {
    installProceduralShirt(`Using procedural ${style.label}. Add ${style.modelUrl} for GLB try-on.`);
    return;
  }

  if (state.tryOn.modelCache.has(style.modelUrl)) {
    installLoadedShirtModel(state.tryOn.modelCache.get(style.modelUrl), `${style.label} GLB loaded`);
    return;
  }

  setTryOnStatus(`Loading ${style.label} GLB`);
  state.tryOn.loader.load(
    style.modelUrl,
    (gltf) => {
      state.tryOn.modelCache.set(style.modelUrl, gltf.scene);
      installLoadedShirtModel(gltf.scene, `${style.label} GLB loaded`);
    },
    undefined,
    () => {
      state.tryOn.modelFailureCache.add(style.modelUrl);
      installProceduralShirt(`Using procedural ${style.label}. Add ${style.modelUrl} for GLB try-on.`);
    }
  );
}

function installLoadedShirtModel(sourceScene, status) {
  const overlayModel = prepareLoadedShirtClone(sourceScene.clone(true), true);
  const studioModel = prepareLoadedShirtClone(sourceScene.clone(true), false);

  replaceTryOnRoot(state.tryOn.overlayRoot, overlayModel);
  replaceTryOnRoot(state.tryOn.studioRoot, studioModel);
  setTryOnStatus(status);
}

function installProceduralShirt(status) {
  const overlayModel = createProceduralShirt({ opacity: 0.78 });
  const studioModel = createProceduralShirt({ opacity: 1 });

  replaceTryOnRoot(state.tryOn.overlayRoot, overlayModel);
  replaceTryOnRoot(state.tryOn.studioRoot, studioModel);
  setTryOnStatus(status);
}

function prepareLoadedShirtClone(model, isOverlay) {
  const box = new THREE.Box3().setFromObject(model);
  const size = new THREE.Vector3();
  box.getSize(size);
  const center = new THREE.Vector3();
  box.getCenter(center);
  const wrapper = new THREE.Group();
  const fitWidth = Math.max(size.x, 0.001);

  model.position.x -= center.x;
  model.scale.y *= -1;
  model.position.y += box.max.y - size.y * 0.12;
  model.position.z -= center.z;

  wrapper.add(model);
  wrapper.userData.fitWidth = fitWidth;
  wrapper.userData.source = "glb";
  applyShirtMaterial(wrapper, isOverlay ? 0.82 : 1);

  return wrapper;
}

function createProceduralShirt(options = {}) {
  const group = new THREE.Group();
  const color = getSelectedShirtColor();
  const texture = getSelectedShirtTexture();
  const opacity = options.opacity ?? 1;
  const shape = new THREE.Shape();

  shape.moveTo(-0.62, 0.02);
  shape.lineTo(-0.96, 0.22);
  shape.lineTo(-0.82, 0.54);
  shape.lineTo(-0.58, 0.42);
  shape.lineTo(-0.52, 1.38);
  shape.lineTo(0.52, 1.38);
  shape.lineTo(0.58, 0.42);
  shape.lineTo(0.82, 0.54);
  shape.lineTo(0.96, 0.22);
  shape.lineTo(0.62, 0.02);
  shape.quadraticCurveTo(0.36, 0.16, 0.18, 0.05);
  shape.quadraticCurveTo(0, -0.06, -0.18, 0.05);
  shape.quadraticCurveTo(-0.36, 0.16, -0.62, 0.02);

  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: texture.roughness,
    metalness: texture.metalness,
    transparent: opacity < 1,
    opacity,
    side: THREE.DoubleSide
  });

  const shirt = new THREE.Mesh(new THREE.ShapeGeometry(shape), material);
  group.add(shirt);

  const seamMaterial = new THREE.LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: opacity < 1 ? 0.28 : 0.22
  });

  group.add(createSeamLine([[-0.42, 0.08], [-0.34, 1.22]], seamMaterial));
  group.add(createSeamLine([[0.42, 0.08], [0.34, 1.22]], seamMaterial));
  group.add(createSeamLine([[-0.34, 1.18], [0.34, 1.18]], seamMaterial));

  const collar = new THREE.Mesh(
    new THREE.RingGeometry(0.12, 0.22, 32, 1, Math.PI * 0.08, Math.PI * 0.84),
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: opacity < 1 ? 0.38 : 0.5,
      side: THREE.DoubleSide
    })
  );
  collar.position.set(0, 0.02, 0.01);
  collar.scale.set(1.25, 0.82, 1);
  collar.userData.noTint = true;
  group.add(collar);

  group.userData.fitWidth = 1.24;
  group.userData.source = "procedural";
  return group;
}

function createSeamLine(points, material) {
  const geometry = new THREE.BufferGeometry().setFromPoints(
    points.map(([x, y]) => new THREE.Vector3(x, y, 0.02))
  );

  return new THREE.Line(geometry, material);
}

function replaceTryOnRoot(root, object) {
  if (!root) return;

  while (root.children.length) {
    root.remove(root.children[0]);
  }

  root.add(object);
}

function applyShirtMaterial(root, opacity) {
  const color = getSelectedShirtColor();
  const texture = getSelectedShirtTexture();

  root.traverse((child) => {
    if (!child.isMesh || !child.material) return;
    if (child.userData.noTint) return;

    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => {
      if (material.color) material.color.setHex(color);
      if ("roughness" in material) material.roughness = texture.roughness;
      if ("metalness" in material) material.metalness = texture.metalness;
      material.transparent = opacity < 1;
      material.opacity = opacity;
      material.needsUpdate = true;
    });
  });
}

function updateTryOnAnchor(scan) {
  if (!state.tryOn.available || !state.tryOn.overlayRoot) return;

  refs.tryOnPreview.dataset.enabled = String(state.settings.showTryOn);
  refs.cameraStage.dataset.tryonEnabled = String(state.settings.showTryOn);
  state.tryOn.overlayRoot.visible = state.settings.showTryOn;

  if (!state.settings.showTryOn) {
    renderTryOnOverlay();
    return;
  }

  const left = scan.points.leftShoulder;
  const right = scan.points.rightShoulder;
  const shoulderCenter = midpoint(left, right);
  const fitWidth = getTryOnFitWidth(state.tryOn.overlayRoot);
  const style = getSelectedShirtConfig();

  state.tryOn.target.x = shoulderCenter.x;
  state.tryOn.target.y = shoulderCenter.y - scan.shoulderWidth * 0.04;
  state.tryOn.target.scale = (scan.shoulderWidth / fitWidth) * style.baseScale;
  state.tryOn.target.rotation = Math.atan2(right.y - left.y, right.x - left.x);

  if (!state.tryOn.hasAnchor) {
    state.tryOn.current.x = state.tryOn.target.x;
    state.tryOn.current.y = state.tryOn.target.y;
    state.tryOn.current.scale = state.tryOn.target.scale;
    state.tryOn.current.rotation = state.tryOn.target.rotation;
    state.tryOn.hasAnchor = true;
  }

  state.tryOn.current.x = lerpNumber(state.tryOn.current.x, state.tryOn.target.x, 0.28);
  state.tryOn.current.y = lerpNumber(state.tryOn.current.y, state.tryOn.target.y, 0.28);
  state.tryOn.current.scale = lerpNumber(state.tryOn.current.scale, state.tryOn.target.scale, 0.22);
  state.tryOn.current.rotation = lerpAngle(state.tryOn.current.rotation, state.tryOn.target.rotation, 0.24);

  state.tryOn.overlayRoot.position.set(state.tryOn.current.x, state.tryOn.current.y, 0);
  state.tryOn.overlayRoot.scale.setScalar(state.tryOn.current.scale);
  state.tryOn.overlayRoot.rotation.set(0, 0, state.tryOn.current.rotation);

  renderTryOnOverlay();
}

function clearTryOnTracking() {
  if (!state.tryOn.available || !state.tryOn.overlayRoot) return;

  state.tryOn.hasAnchor = false;
  state.tryOn.overlayRoot.visible = false;
  renderTryOnOverlay();
}

function renderTryOnOverlay() {
  if (!state.tryOn.overlayRenderer || !state.tryOn.overlayScene || !state.tryOn.overlayCamera) return;
  state.tryOn.overlayRenderer.render(state.tryOn.overlayScene, state.tryOn.overlayCamera);
}

function getTryOnFitWidth(root) {
  if (!root) return 1;

  const child = root.children[0];
  return child?.userData?.fitWidth || root.userData.fitWidth || 1;
}

function getSelectedShirtConfig() {
  return SHIRT_CATALOG[refs.shirtSelect?.value] || SHIRT_CATALOG.classic;
}

function getSelectedShirtColor() {
  return (SHIRT_COLORS[refs.shirtColorSelect?.value] || SHIRT_COLORS.midnight).value;
}

function getSelectedShirtTexture() {
  return SHIRT_TEXTURES[refs.shirtTextureSelect?.value] || SHIRT_TEXTURES.cotton;
}

function setTryOnStatus(message) {
  if (refs.tryOnPreview) refs.tryOnPreview.dataset.modelStatus = message;
  if (state.tryOn.statusEl) state.tryOn.statusEl.textContent = message;
}

function lerpNumber(current, target, amount) {
  return current + (target - current) * amount;
}

function lerpAngle(current, target, amount) {
  const difference = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + difference * amount;
}

function handlePoseResults(res) {
  drawCameraFrame(res.image);

  if (!res.poseLandmarks) {
    state.smoothedLandmarks = null;
    state.latestScan = null;
    updateNoDetection();
    maybeSpeak("Move into frame");
    return;
  }

  const landmarks = smoothLandmarks(res.poseLandmarks);
  const measurements = estimateMeasurements(landmarks);

  if (
    state.settings.showSkeleton &&
    typeof drawConnectors === "function" &&
    typeof drawLandmarks === "function" &&
    typeof POSE_CONNECTIONS !== "undefined"
  ) {
    drawConnectors(ctx, landmarks, POSE_CONNECTIONS, { color: "#34d6c5", lineWidth: 3 });
    drawLandmarks(ctx, landmarks, { color: "#9af7b8", lineWidth: 1, radius: 3 });
  }

  if (state.settings.showMeasurements) {
    drawBodyOverlay(landmarks, measurements);
  }

  state.latestScan = measurements;
  updateDashboard(measurements);
  guideUser(measurements);
}

function drawCameraFrame(image) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
}

function smoothLandmarks(rawLandmarks) {
  const alpha = 0.34;

  if (!state.smoothedLandmarks || state.smoothedLandmarks.length !== rawLandmarks.length) {
    state.smoothedLandmarks = rawLandmarks.map(copyLandmark);
    return state.smoothedLandmarks;
  }

  state.smoothedLandmarks = rawLandmarks.map((landmark, index) => {
    const previous = state.smoothedLandmarks[index];

    return {
      x: previous.x + (landmark.x - previous.x) * alpha,
      y: previous.y + (landmark.y - previous.y) * alpha,
      z: previous.z + (landmark.z - previous.z) * alpha,
      visibility: landmark.visibility ?? previous.visibility ?? 1
    };
  });

  return state.smoothedLandmarks;
}

function copyLandmark(landmark) {
  return {
    x: landmark.x,
    y: landmark.y,
    z: landmark.z,
    visibility: landmark.visibility ?? 1
  };
}

function estimateMeasurements(landmarks) {
  const points = getBodyPoints(landmarks);
  const shoulderWidth = distance(points.leftShoulder, points.rightShoulder);
  const hipWidth = distance(points.leftHip, points.rightHip);
  const chestWidth = shoulderWidth * 0.88;
  const waistWidth = ((shoulderWidth + hipWidth) / 2) * 0.78;
  const leftSleeve = distance(points.leftShoulder, points.leftElbow) + distance(points.leftElbow, points.leftWrist);
  const rightSleeve = distance(points.rightShoulder, points.rightElbow) + distance(points.rightElbow, points.rightWrist);
  const sleeveLength = (leftSleeve + rightSleeve) / 2;
  const neckWidth = shoulderWidth * 0.22;
  const height = estimateHeight(points, shoulderWidth);
  const confidence = calculateConfidence(landmarks);
  const bodyType = estimateBodyType(shoulderWidth, waistWidth, hipWidth);
  const recommendedSize = getSize(shoulderWidth);

  return {
    timestamp: new Date().toISOString(),
    modelName: "MediaPipe Pose",
    shoulderWidth,
    chestWidth,
    waistWidth,
    hipWidth,
    sleeveLength,
    neckWidth,
    height,
    bodyType,
    confidence,
    recommendedSize,
    inferenceTime: state.inferenceTime,
    fps: state.fps,
    points,
    limitation: "Browser-only estimate based on 2D pose landmarks and pixel distances. Not exact centimeters."
  };
}

function getBodyPoints(landmarks) {
  const leftShoulder = toCanvasPoint(landmarks[LANDMARK.LEFT_SHOULDER]);
  const rightShoulder = toCanvasPoint(landmarks[LANDMARK.RIGHT_SHOULDER]);
  const leftHip = toCanvasPoint(landmarks[LANDMARK.LEFT_HIP]);
  const rightHip = toCanvasPoint(landmarks[LANDMARK.RIGHT_HIP]);
  const shoulderMid = midpoint(leftShoulder, rightShoulder);
  const hipMid = midpoint(leftHip, rightHip);
  const torsoCenter = midpoint(shoulderMid, hipMid);

  return {
    head: toCanvasPoint(landmarks[LANDMARK.NOSE]),
    neck: {
      x: shoulderMid.x,
      y: shoulderMid.y - distance(leftShoulder, rightShoulder) * 0.08,
      visibility: Math.min(leftShoulder.visibility, rightShoulder.visibility)
    },
    leftShoulder,
    rightShoulder,
    chest: lerpPoint(shoulderMid, hipMid, 0.24),
    waist: lerpPoint(shoulderMid, hipMid, 0.62),
    leftHip,
    rightHip,
    hipCenter: hipMid,
    torsoCenter,
    leftElbow: toCanvasPoint(landmarks[LANDMARK.LEFT_ELBOW]),
    rightElbow: toCanvasPoint(landmarks[LANDMARK.RIGHT_ELBOW]),
    leftWrist: toCanvasPoint(landmarks[LANDMARK.LEFT_WRIST]),
    rightWrist: toCanvasPoint(landmarks[LANDMARK.RIGHT_WRIST]),
    leftKnee: toCanvasPoint(landmarks[LANDMARK.LEFT_KNEE]),
    rightKnee: toCanvasPoint(landmarks[LANDMARK.RIGHT_KNEE]),
    leftAnkle: toCanvasPoint(landmarks[LANDMARK.LEFT_ANKLE]),
    rightAnkle: toCanvasPoint(landmarks[LANDMARK.RIGHT_ANKLE])
  };
}

function toCanvasPoint(landmark) {
  return {
    x: landmark.x * canvas.width,
    y: landmark.y * canvas.height,
    visibility: landmark.visibility ?? 1
  };
}

function midpoint(a, b) {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    visibility: Math.min(a.visibility, b.visibility)
  };
}

function lerpPoint(a, b, amount) {
  return {
    x: a.x + (b.x - a.x) * amount,
    y: a.y + (b.y - a.y) * amount,
    visibility: Math.min(a.visibility, b.visibility)
  };
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function calculateConfidence(landmarks) {
  const important = [
    LANDMARK.NOSE,
    LANDMARK.LEFT_SHOULDER,
    LANDMARK.RIGHT_SHOULDER,
    LANDMARK.LEFT_ELBOW,
    LANDMARK.RIGHT_ELBOW,
    LANDMARK.LEFT_WRIST,
    LANDMARK.RIGHT_WRIST,
    LANDMARK.LEFT_HIP,
    LANDMARK.RIGHT_HIP,
    LANDMARK.LEFT_KNEE,
    LANDMARK.RIGHT_KNEE,
    LANDMARK.LEFT_ANKLE,
    LANDMARK.RIGHT_ANKLE
  ];

  const total = important.reduce((sum, index) => sum + (landmarks[index].visibility ?? 1), 0);
  return Math.round((total / important.length) * 100);
}

function estimateHeight(points, shoulderWidth) {
  const ankleMid = midpoint(points.leftAnkle, points.rightAnkle);
  const headToAnkle = Math.max(0, ankleMid.y - points.head.y);

  return headToAnkle + shoulderWidth * 0.55;
}

function estimateBodyType(shoulderWidth, waistWidth, hipWidth) {
  const shoulderHipRatio = shoulderWidth / Math.max(hipWidth, 1);
  const hipShoulderRatio = hipWidth / Math.max(shoulderWidth, 1);
  const waistRatio = waistWidth / Math.max(Math.min(shoulderWidth, hipWidth), 1);

  if (shoulderHipRatio > 1.18) return "Inverted Triangle";
  if (hipShoulderRatio > 1.12) return "Triangle";
  if (waistRatio < 0.76) return "Athletic";
  if (waistRatio > 0.94) return "Rectangle";
  return "Balanced";
}

function drawBodyOverlay(landmarks, measurements) {
  const visiblePoints = landmarks
    .filter((landmark) => (landmark.visibility ?? 1) > 0.35)
    .map(toCanvasPoint);

  drawBoundingBox(visiblePoints);
  drawMeasurementLines(measurements);
  drawBodyLabels(measurements.points);
}

function drawBoundingBox(points) {
  if (!points.length) return;

  const padding = 18;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const left = Math.max(0, Math.min(...xs) - padding);
  const top = Math.max(0, Math.min(...ys) - padding);
  const right = Math.min(canvas.width, Math.max(...xs) + padding);
  const bottom = Math.min(canvas.height, Math.max(...ys) + padding);

  ctx.save();
  ctx.strokeStyle = "rgba(154, 247, 184, 0.75)";
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 8]);
  ctx.strokeRect(left, top, right - left, bottom - top);
  ctx.restore();
}

function drawMeasurementLines(measurements) {
  const points = measurements.points;
  const chestLine = horizontalLine(points.chest, measurements.chestWidth);
  const waistLine = horizontalLine(points.waist, measurements.waistWidth);
  const hipLine = horizontalLine(points.hipCenter, measurements.hipWidth);

  drawLine(points.leftShoulder, points.rightShoulder, `Shoulder ${formatPixels(measurements.shoulderWidth)}`, "#9af7b8");
  drawLine(chestLine.start, chestLine.end, `Chest ${formatPixels(measurements.chestWidth)}`, "#34d6c5");
  drawLine(waistLine.start, waistLine.end, `Waist ${formatPixels(measurements.waistWidth)}`, "#f5c451");
  drawLine(hipLine.start, hipLine.end, `Hip ${formatPixels(measurements.hipWidth)}`, "#ff7a59");
  drawLine(points.leftShoulder, points.leftWrist, `Sleeve ${formatPixels(measurements.sleeveLength)}`, "#ffffff");
}

function horizontalLine(center, width) {
  return {
    start: { x: center.x - width / 2, y: center.y, visibility: center.visibility },
    end: { x: center.x + width / 2, y: center.y, visibility: center.visibility }
  };
}

function drawLine(start, end, label, color) {
  const labelPoint = midpoint(start, end);

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(start.x, start.y, 5, 0, Math.PI * 2);
  ctx.arc(end.x, end.y, 5, 0, Math.PI * 2);
  ctx.fill();

  drawTextPill(label, labelPoint.x, labelPoint.y - 12, color);
  ctx.restore();
}

function drawBodyLabels(points) {
  const labels = [
    ["Head", points.head],
    ["Neck", points.neck],
    ["L Shoulder", points.leftShoulder],
    ["R Shoulder", points.rightShoulder],
    ["Chest", points.chest],
    ["Waist", points.waist],
    ["L Hip", points.leftHip],
    ["R Hip", points.rightHip],
    ["L Elbow", points.leftElbow],
    ["R Elbow", points.rightElbow],
    ["L Wrist", points.leftWrist],
    ["R Wrist", points.rightWrist],
    ["L Knee", points.leftKnee],
    ["R Knee", points.rightKnee],
    ["L Ankle", points.leftAnkle],
    ["R Ankle", points.rightAnkle]
  ];

  labels.forEach(([label, point]) => {
    if (point.visibility < 0.35) return;
    drawTextPill(label, point.x, point.y + 16, "#f6f7f2");
  });
}

function drawTextPill(text, x, y, color) {
  ctx.save();
  ctx.font = "12px Inter, Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  const paddingX = 7;
  const width = ctx.measureText(text).width + paddingX * 2;
  const height = 20;
  const left = clamp(x - width / 2, 4, canvas.width - width - 4);
  const top = clamp(y - height / 2, 4, canvas.height - height - 4);

  ctx.fillStyle = "rgba(9, 10, 12, 0.78)";
  ctx.strokeStyle = color;
  roundRect(ctx, left, top, width, height, 6);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.fillText(text, left + width / 2, top + height / 2 + 0.5);
  ctx.restore();
}

function roundRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function updateDashboard(scan) {
  const now = performance.now();
  if (now - state.lastDomUpdate < 120) return;
  state.lastDomUpdate = now;

  result.innerHTML = `
    Estimated Shoulder Width: ${formatPixels(scan.shoulderWidth)}<br>
    Recommended Size: <b>${scan.recommendedSize}</b><br>
    <small>
      Confidence: ${scan.confidence}% | FPS: ${Math.round(scan.fps)} | Inference: ${scan.inferenceTime.toFixed(1)} ms<br>
      Estimated values only. Pixel values are not real centimeters.
    </small>
  `;

  setText(refs.cameraStatus, scan.confidence > 55 ? "Tracking active" : "Low confidence");
  setText(refs.metricShoulder, formatPixels(scan.shoulderWidth));
  setText(refs.metricChest, formatPixels(scan.chestWidth));
  setText(refs.metricWaist, formatPixels(scan.waistWidth));
  setText(refs.metricHip, formatPixels(scan.hipWidth));
  setText(refs.metricHeight, `${formatPixels(scan.height)} est.`);
  setText(refs.metricBodyType, scan.bodyType);
  setText(refs.metricConfidence, `${scan.confidence}%`);
  setText(refs.metricFps, state.settings.showFps ? `${Math.round(scan.fps)}` : "Hidden");

  updateStatusList(getActiveStatusLabels(scan));
  updateStylist(scan);
  updateTryOnPreview(scan);
}

function getActiveStatusLabels(scan) {
  const labels = ["Camera Ready", "Detecting Body", "Tracking Shoulders", "Measuring"];

  if (state.settings.showTryOn) labels.push("Loading Shirt");
  if (scan.confidence > 72) labels.push("Scan Complete");

  return labels;
}

function updateNoDetection() {
  const now = performance.now();
  if (now - state.lastDomUpdate < 180) return;
  state.lastDomUpdate = now;

  clearTryOnTracking();
  result.textContent = "No person detected. Stand in the camera frame.";
  setText(refs.cameraStatus, "Searching for body");
  setText(refs.metricConfidence, "--");
  setText(refs.metricFps, state.settings.showFps ? `${Math.round(state.fps)}` : "Hidden");
  updateStatusList(["Camera Ready"]);
}

function setText(element, text) {
  if (element) element.textContent = text;
}

function updateStatusList(activeLabels) {
  document.querySelectorAll(".status-list li").forEach((item) => {
    const label = item.textContent.trim();
    const isActive = activeLabels.some((activeLabel) => label.includes(activeLabel));
    item.classList.toggle("is-active", isActive);
    item.setAttribute("aria-current", isActive ? "true" : "false");
  });
}

function updateStylist(scan) {
  if (!refs.stylistOutput) return;

  const occasion = refs.occasionSelect?.value || "Casual";
  const budget = refs.budgetSelect?.value || "Mid-range";
  const fit = scan.bodyType === "Inverted Triangle" ? "balanced layers and clean vertical lines" : "structured fits with comfortable movement";
  const weatherNote = "Use breathable layers unless local weather data is connected later.";

  refs.stylistOutput.textContent = `${occasion} recommendation: size ${scan.recommendedSize}, ${fit}. Budget tier: ${budget}. ${weatherNote}`;
}

function updateTryOnPreview(scan) {
  if (!refs.tryOnPreview) return;

  const style = getSelectedShirtConfig();
  const color = SHIRT_COLORS[refs.shirtColorSelect?.value] || SHIRT_COLORS.midnight;
  const texture = SHIRT_TEXTURES[refs.shirtTextureSelect?.value] || SHIRT_TEXTURES.cotton;

  refs.tryOnPreview.dataset.enabled = String(state.settings.showTryOn);
  if (refs.cameraStage) refs.cameraStage.dataset.tryonEnabled = String(state.settings.showTryOn);
  refs.tryOnPreview.setAttribute(
    "aria-label",
    `${style.label}, ${color.label}, ${texture.label}. Anchor width estimate ${formatPixels(scan.shoulderWidth)}.`
  );

  loadSelectedShirtModel();
  updateTryOnAnchor(scan);
}

function guideUser(scan) {
  if (!state.settings.voice) return;

  const points = scan.points;
  const shoulderTilt = Math.abs(points.leftShoulder.y - points.rightShoulder.y) / canvas.height;

  if (scan.shoulderWidth < canvas.width * 0.16) {
    maybeSpeak("Move closer");
    return;
  }

  if (scan.shoulderWidth > canvas.width * 0.48) {
    maybeSpeak("Move back");
    return;
  }

  if (shoulderTilt > 0.06) {
    maybeSpeak("Stand straight");
    return;
  }

  if (scan.confidence > 72) {
    maybeSpeak("Measurement complete");
  }
}

function maybeSpeak(message) {
  if (!state.settings.voice || !("speechSynthesis" in window)) return;

  const now = performance.now();
  if (now - state.lastVoiceAt < 6500) return;
  state.lastVoiceAt = now;

  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(message);
  utterance.rate = 0.95;
  utterance.pitch = 1;
  window.speechSynthesis.speak(utterance);
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    result.textContent = "Camera access is not supported in this browser.";
    setText(refs.cameraStatus, "Camera unavailable");
    return;
  }

  stopCamera();
  setCanvasSize(state.resolution.width, state.resolution.height);
  setText(refs.cameraStatus, "Requesting camera");

  const videoConstraints = {
    width: { ideal: state.resolution.width },
    height: { ideal: state.resolution.height },
    facingMode: "user"
  };

  if (state.deviceId) {
    videoConstraints.deviceId = { exact: state.deviceId };
    delete videoConstraints.facingMode;
  }

  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: videoConstraints
    });

    video.srcObject = state.stream;
    await video.play();

    state.running = true;
    state.lastFpsTime = performance.now();
    state.frameCount = 0;
    setText(refs.cameraStatus, "Camera ready");
    updateStatusList(["Camera Ready"]);

    await populateCameraOptions();
    state.rafId = requestAnimationFrame(processVideoFrame);
  } catch (error) {
    console.error(error);
    result.textContent = "Unable to access the camera. Allow camera permission and reload the page.";
    setText(refs.cameraStatus, "Permission needed");
  }
}

function stopCamera() {
  state.running = false;

  if (state.rafId) {
    cancelAnimationFrame(state.rafId);
    state.rafId = null;
  }

  if (state.stream) {
    state.stream.getTracks().forEach((track) => track.stop());
    state.stream = null;
  }
}

async function processVideoFrame(now) {
  if (!state.running) return;

  updateFps(now);

  if (!state.processing && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
    state.processing = true;
    const startedAt = performance.now();

    try {
      await pose.send({ image: video });
      state.inferenceTime = performance.now() - startedAt;
    } catch (error) {
      console.error(error);
    } finally {
      state.processing = false;
    }
  }

  state.rafId = requestAnimationFrame(processVideoFrame);
}

function updateFps(now) {
  state.frameCount += 1;
  const elapsed = now - state.lastFpsTime;

  if (elapsed >= 1000) {
    state.fps = (state.frameCount * 1000) / elapsed;
    state.frameCount = 0;
    state.lastFpsTime = now;
  }
}

async function populateCameraOptions() {
  if (!refs.cameraSelect || !navigator.mediaDevices?.enumerateDevices) return;

  const devices = await navigator.mediaDevices.enumerateDevices();
  const cameras = devices.filter((device) => device.kind === "videoinput");
  const currentValue = refs.cameraSelect.value || state.deviceId;

  refs.cameraSelect.innerHTML = "";

  cameras.forEach((camera, index) => {
    const option = document.createElement("option");
    option.value = camera.deviceId;
    option.textContent = camera.label || `Camera ${index + 1}`;
    refs.cameraSelect.appendChild(option);
  });

  if (cameras.length === 0) {
    const option = document.createElement("option");
    option.textContent = "Default camera";
    refs.cameraSelect.appendChild(option);
  }

  if (currentValue) {
    refs.cameraSelect.value = currentValue;
  }
}

function setCanvasSize(width, height) {
  canvas.width = width;
  canvas.height = height;
  updateTryOnRendererSizes();
}

function bindControls() {
  refs.skeletonToggle?.addEventListener("change", (event) => {
    state.settings.showSkeleton = event.target.checked;
  });

  refs.measurementToggle?.addEventListener("change", (event) => {
    state.settings.showMeasurements = event.target.checked;
  });

  refs.tryOnToggle?.addEventListener("change", (event) => {
    state.settings.showTryOn = event.target.checked;
    if (refs.tryOnPreview) refs.tryOnPreview.dataset.enabled = String(state.settings.showTryOn);
    if (refs.cameraStage) refs.cameraStage.dataset.tryonEnabled = String(state.settings.showTryOn);
    if (!state.settings.showTryOn) clearTryOnTracking();
    if (state.latestScan) updateTryOnAnchor(state.latestScan);
  });

  refs.voiceToggle?.addEventListener("change", (event) => {
    state.settings.voice = event.target.checked;
    if (!state.settings.voice && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  });

  refs.fpsToggle?.addEventListener("change", (event) => {
    state.settings.showFps = event.target.checked;
    setText(refs.metricFps, event.target.checked ? `${Math.round(state.fps)}` : "Hidden");
  });

  refs.cameraSelect?.addEventListener("change", (event) => {
    state.deviceId = event.target.value;
    startCamera();
  });

  refs.resolutionSelect?.addEventListener("change", (event) => {
    const [width, height] = event.target.value.split("x").map(Number);
    state.resolution = { width, height };
    startCamera();
  });

  refs.themeToggle?.addEventListener("click", toggleTheme);
  refs.startScanButton?.addEventListener("click", () => {
    document.getElementById("scanner")?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (!state.running) startCamera();
  });

  refs.screenshotButton?.addEventListener("click", downloadScreenshot);
  refs.downloadReportButton?.addEventListener("click", downloadMeasurementReport);
  refs.measurementReportButton?.addEventListener("click", downloadMeasurementReport);
  refs.pdfButton?.addEventListener("click", printPdfReport);
  refs.saveHistoryButton?.addEventListener("click", saveScanHistory);

  refs.occasionSelect?.addEventListener("change", () => {
    if (state.latestScan) updateStylist(state.latestScan);
  });

  refs.budgetSelect?.addEventListener("change", () => {
    if (state.latestScan) updateStylist(state.latestScan);
  });

  [refs.shirtSelect, refs.shirtColorSelect, refs.shirtTextureSelect].forEach((select) => {
    select?.addEventListener("change", () => {
      loadSelectedShirtModel();
      if (state.latestScan) updateTryOnPreview(state.latestScan);
    });
  });
}

function toggleTheme() {
  state.settings.theme = state.settings.theme === "dark" ? "light" : "dark";

  if (state.settings.theme === "light") {
    document.documentElement.style.setProperty("--bg", "#f7f8f6");
    document.documentElement.style.setProperty("--panel", "rgba(255, 255, 255, 0.78)");
    document.documentElement.style.setProperty("--panel-strong", "rgba(255, 255, 255, 0.94)");
    document.documentElement.style.setProperty("--panel-border", "rgba(12, 18, 22, 0.14)");
    document.documentElement.style.setProperty("--text", "#101316");
    document.documentElement.style.setProperty("--muted", "#4f5b57");
    document.documentElement.style.setProperty("--subtle", "#6e7772");
    document.documentElement.style.setProperty("--line", "rgba(12, 18, 22, 0.12)");
    if (refs.themeToggle) refs.themeToggle.textContent = "Dark";
    return;
  }

  document.documentElement.removeAttribute("style");
  if (refs.themeToggle) refs.themeToggle.textContent = "Theme";
}

function downloadScreenshot() {
  canvas.toBlob((blob) => {
    if (!blob) return;
    downloadBlob(blob, `fitvision-scan-${Date.now()}.png`);
  }, "image/png");
}

function downloadMeasurementReport() {
  if (!state.latestScan) {
    result.textContent = "No scan available yet. Stand in frame before downloading a report.";
    return;
  }

  const report = {
    app: "FitVision AI",
    generatedAt: new Date().toISOString(),
    scan: cleanScanForExport(state.latestScan)
  };

  const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
  downloadBlob(blob, `fitvision-measurement-report-${Date.now()}.json`);
}

function printPdfReport() {
  if (!state.latestScan) {
    result.textContent = "No scan available yet. Stand in frame before creating a PDF.";
    return;
  }

  // Browser-only PDF export uses the print dialog so the user can choose "Save as PDF".
  window.print();
}

function saveScanHistory() {
  if (!state.latestScan) {
    result.textContent = "No scan available yet. Stand in frame before saving history.";
    return;
  }

  state.scanHistory.push(cleanScanForExport(state.latestScan));
  localStorage.setItem("fitvisionScanHistory", JSON.stringify(state.scanHistory.slice(-20)));
  result.innerHTML = `Scan saved locally.<br><small>Latest recommended size: ${state.latestScan.recommendedSize}</small>`;
}

function cleanScanForExport(scan) {
  return {
    timestamp: scan.timestamp,
    modelName: scan.modelName,
    shoulderWidthPx: roundOne(scan.shoulderWidth),
    chestWidthPx: roundOne(scan.chestWidth),
    waistWidthPx: roundOne(scan.waistWidth),
    hipWidthPx: roundOne(scan.hipWidth),
    sleeveLengthPx: roundOne(scan.sleeveLength),
    neckWidthPx: roundOne(scan.neckWidth),
    estimatedHeightPx: roundOne(scan.height),
    estimatedBodyType: scan.bodyType,
    confidence: scan.confidence,
    fps: roundOne(scan.fps),
    inferenceTimeMs: roundOne(scan.inferenceTime),
    recommendedSize: scan.recommendedSize,
    limitation: scan.limitation
  };
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function loadHistory() {
  try {
    state.scanHistory = JSON.parse(localStorage.getItem("fitvisionScanHistory") || "[]");
  } catch {
    state.scanHistory = [];
  }
}

function formatPixels(value) {
  return `${roundOne(value)} px`;
}

function roundOne(value) {
  return Math.round(value * 10) / 10;
}

function hideLoaderSoon() {
  window.setTimeout(() => {
    refs.appLoader?.remove();
  }, 2600);
}

function init() {
  bindControls();
  loadHistory();
  hideLoaderSoon();
  initTryOnRenderer();
  startCamera();
}

init();
