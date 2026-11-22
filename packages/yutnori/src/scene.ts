import * as THREE from "three";
import yutWoodTextureUrl from "./assets/images/yut_wood_texture.png?url";
import type { YutThrow } from "./types";
import { OUTCOME_LABELS } from "./types";
import { stickFaceMarkup } from "./stick-face";

const LANDING_FRACTIONS = [0.53, 0.67, 0.79, 0.88] as const;

function createStrawMatTexture(): THREE.CanvasTexture | undefined {
  if (typeof document === "undefined") return undefined;
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = canvas.getContext("2d");
  } catch {
    return undefined;
  }
  if (!ctx) return undefined;

  const cx = 128;
  const cy = 128;
  // Warm sunlit golden rice-straw mat (멍석) radial gradient
  const grad = ctx.createRadialGradient(cx, cy, 10, cx, cy, 126);
  grad.addColorStop(0, "#f5e3ba");
  grad.addColorStop(0.68, "#e6cb95");
  grad.addColorStop(0.92, "#cfa96d");
  grad.addColorStop(1, "#b4884d");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 256, 256);

  // Woven concentric straw braids
  for (let r = 12; r < 124; r += 7) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = r % 14 === 0 ? "rgba(150, 106, 52, 0.22)" : "rgba(255, 245, 214, 0.28)";
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  // Subtle radial weave stitches
  for (let i = 0; i < 36; i++) {
    const ang = (i / 36) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(ang) * 14, cy + Math.sin(ang) * 14);
    ctx.lineTo(cx + Math.cos(ang) * 124, cy + Math.sin(ang) * 124);
    ctx.strokeStyle = "rgba(148, 102, 48, 0.12)";
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }
  // Traditional braided celadon/red cloth trim band near the rim
  ctx.beginPath();
  ctx.arc(cx, cy, 117, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(182, 76, 62, 0.45)";
  ctx.lineWidth = 4;
  ctx.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** The server owns faces and time; this scene only interpolates their presentation. */
export function createThrowScene(host: HTMLElement): { show(roll: YutThrow, serverNow: number): void; destroy(): void } {
  const fallback = document.createElement("div");
  fallback.className = "yut-flat-sticks";
  fallback.setAttribute("aria-hidden", "true");
  host.append(fallback);
  let renderer: THREE.WebGLRenderer | undefined;
  let current: YutThrow | undefined;
  let destroyed = false;
  let failed = false;
  let inViewport = true;
  let clockOffset = 0;
  const media = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : undefined;
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-4, 4, 2.8, -2.8, 0.1, 50);
  camera.position.set(3, 8, 7);
  camera.lookAt(0, 0.7, 0);

  // Warm Korean paper-lantern studio illumination
  scene.add(new THREE.HemisphereLight(0xfff6e4, 0x876f57, 2.6));
  const key = new THREE.DirectionalLight(0xfff0d4, 3.6);
  key.position.set(-4, 8.5, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(512, 512);
  key.shadow.camera.left = -5;
  key.shadow.camera.right = 5;
  key.shadow.camera.top = 5;
  key.shadow.camera.bottom = -5;
  key.shadow.normalBias = 0.025;
  scene.add(key);

  const lanternFill = new THREE.PointLight(0xffcf82, 4.5, 16);
  lanternFill.position.set(3.2, 4.2, -2.5);
  scene.add(lanternFill);

  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const textures: THREE.Texture[] = [];
  function geometry<T extends THREE.BufferGeometry>(value: T): T { geometries.push(value); return value; }
  function material<T extends THREE.Material>(value: T): T { materials.push(value); return value; }
  function trackTexture<T extends THREE.Texture>(value: T): T { textures.push(value); return value; }

  let woodTexture: THREE.Texture | undefined;
  try {
    const loader = new THREE.TextureLoader();
    woodTexture = trackTexture(
      loader.load(yutWoodTextureUrl, () => {
        if (!destroyed) renderFrame();
      })
    );
    woodTexture.colorSpace = THREE.SRGBColorSpace;
    woodTexture.wrapS = THREE.RepeatWrapping;
    woodTexture.wrapT = THREE.RepeatWrapping;
    woodTexture.repeat.set(1, 2);
  } catch {
    woodTexture = undefined;
  }

  const shape = new THREE.Shape();
  shape.moveTo(0.23, 0);
  shape.absarc(0, 0, 0.23, 0, Math.PI, false);
  shape.lineTo(0.23, 0);
  const body = geometry(new THREE.ExtrudeGeometry(shape, { depth: 2.3, bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: 0.008, bevelThickness: 0.04, curveSegments: 14 }));
  body.translate(0, 0, -1.15);

  const wood = material(new THREE.MeshStandardMaterial({ color: 0xc98b47, map: woodTexture ?? null, roughness: 0.52, metalness: 0.04 }));
  const flat = material(new THREE.MeshStandardMaterial({ color: 0xf7e3be, map: woodTexture ?? null, roughness: 0.64, side: THREE.DoubleSide }));
  const ink = material(new THREE.MeshStandardMaterial({ color: 0x5d351e, roughness: 0.72 }));
  const red = material(new THREE.MeshStandardMaterial({ color: 0xc44336, roughness: 0.48 }));
  const faceGeometry = geometry(new THREE.PlaneGeometry(0.43, 2.25));
  const crossGeometries = [-1, 1].map((sign) => {
    const points = Array.from({ length: 7 }, (_, step) => {
      const x = -0.105 + (step / 6) * 0.21;
      return new THREE.Vector3(x, Math.sqrt(0.23 * 0.23 - x * x) + 0.018, sign * x);
    });
    return geometry(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 12, 0.012, 5, false));
  });
  const dotGeometry = geometry(new THREE.CircleGeometry(0.053, 24));
  const sticks = Array.from({ length: 4 }, (_, index) => {
    const group = new THREE.Group();
    const curvedBody = new THREE.Mesh(body, wood);
    curvedBody.castShadow = true;
    group.add(curvedBody);
    const face = new THREE.Mesh(faceGeometry, flat);
    face.rotation.x = Math.PI / 2;
    face.position.y = -0.041;
    group.add(face);
    for (const z of [-0.67, 0, 0.67]) {
      for (const crossGeometry of crossGeometries) {
        const mark = new THREE.Mesh(crossGeometry, ink);
        mark.position.z = z;
        group.add(mark);
      }
    }
    if (index === 0) {
      const dot = new THREE.Mesh(dotGeometry, red);
      dot.rotation.x = Math.PI / 2;
      dot.position.y = -0.054;
      group.add(dot);
    }
    scene.add(group);
    return group;
  });

  // Traditional woven straw landing mat (멍석) under the sticks
  const strawTexture = createStrawMatTexture();
  if (strawTexture) trackTexture(strawTexture);
  const strawMatMesh = new THREE.Mesh(
    geometry(new THREE.CircleGeometry(3.15, 48)),
    material(
      new THREE.MeshStandardMaterial({
        color: strawTexture ? 0xffffff : 0xe8d0a0,
        map: strawTexture ?? null,
        roughness: 0.88,
        metalness: 0.0,
        transparent: true,
        opacity: 0.88
      })
    )
  );
  strawMatMesh.rotation.x = -Math.PI / 2;
  strawMatMesh.position.y = -0.025;
  strawMatMesh.receiveShadow = true;
  scene.add(strawMatMesh);

  // Subtle shadow-catcher disc right above the mat for crisp stick grounding
  const mat = new THREE.Mesh(geometry(new THREE.CircleGeometry(3.3, 48)), material(new THREE.ShadowMaterial({ opacity: 0.16 })));
  mat.rotation.x = -Math.PI / 2;
  mat.position.y = -0.015;
  mat.receiveShadow = true;
  scene.add(mat);

  // Subtle golden landing dust/sparkle rings that bloom when each stick touches down
  const ringGeometry = geometry(new THREE.RingGeometry(0.24, 0.36, 28));
  const landingRings = Array.from({ length: 4 }, () => {
    const ringMat = material(
      new THREE.MeshBasicMaterial({
        color: 0xffdf80,
        transparent: true,
        opacity: 0,
        depthWrite: false
      })
    );
    const mesh = new THREE.Mesh(ringGeometry, ringMat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.01;
    mesh.visible = false;
    scene.add(mesh);
    return { mesh, ringMat };
  });

  function staticFaces(): void {
    fallback.replaceChildren(...Array.from({ length: 4 }, (_, i) => {
      const stick = document.createElement("span");
      stick.className = `yut-flat-stick ${current?.faces[i] ? "is-flat" : "is-round"}`;
      stick.innerHTML = stickFaceMarkup(current?.faces[i] ?? false, i);
      return stick;
    }));
  }
  function renderFrame(forceFinal = false): void {
    if (!renderer || failed || destroyed) return;
    const elapsed = current ? Date.now() + clockOffset - current.startedAt : 99999;
    const progress = current ? Math.min(1, Math.max(0, elapsed / Math.max(1, current.durationMs))) : 1;
    const t = forceFinal || media?.matches || document.hidden || !inViewport ? 1 : progress;
    sticks.forEach((stick, index) => {
      const pose = throwPose(current, index, t);
      stick.position.set(...pose.position);
      stick.rotation.set(...pose.rotation);

      // Update landing sparkle ring right after each stick touches the straw mat
      const ring = landingRings[index]!;
      const flightEnd = LANDING_FRACTIONS[index % 4]!;
      const ringPhase = (t - flightEnd) / 0.16;
      if (!forceFinal && t >= flightEnd && ringPhase < 1 && current) {
        ring.mesh.visible = true;
        ring.mesh.position.set(pose.position[0], 0.015, pose.position[2]);
        const scale = 0.8 + ringPhase * 2.1;
        ring.mesh.scale.set(scale, scale, 1);
        ring.ringMat.opacity = Math.sin(ringPhase * Math.PI) * 0.58;
      } else {
        ring.mesh.visible = false;
        ring.ringMat.opacity = 0;
      }
    });
    renderer.render(scene, camera);
    if (t >= 1) renderer.setAnimationLoop(null);
  }
  function resize(): void {
    if (!renderer || failed || destroyed) return;
    const { width, height } = host.getBoundingClientRect();
    if (width <= 0 || height <= 0) return;
    const aspect = width / height;
    camera.left = -2.7 * aspect;
    camera.right = 2.7 * aspect;
    camera.top = 2.7;
    camera.bottom = -2.7;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    renderFrame();
  }
  function useFallback(event?: Event): void {
    event?.preventDefault();
    failed = true;
    renderer?.setAnimationLoop(null);
    host.classList.remove("has-webgl");
    if (renderer) renderer.domElement.hidden = true;
  }
  try {
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "low-power" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.domElement.setAttribute("aria-hidden", "true");
    renderer.domElement.addEventListener("webglcontextlost", useFallback);
    host.append(renderer.domElement);
    host.classList.add("has-webgl");
  } catch { useFallback(); }
  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(resize) : undefined;
  observer?.observe(host);
  const intersection = typeof IntersectionObserver === "function" ? new IntersectionObserver((entries) => {
    inViewport = entries.some((entry) => entry.isIntersecting);
    if (!inViewport) renderFrame(true);
    else if (renderer && !failed && !destroyed) { renderer.setAnimationLoop(() => renderFrame()); renderFrame(); }
  }) : undefined;
  intersection?.observe(host);
  const stopMotion = (): void => { renderFrame(true); };
  document.addEventListener("visibilitychange", stopMotion);
  media?.addEventListener("change", stopMotion);
  staticFaces();
  resize();
  return {
    show(roll, serverNow) {
      if (destroyed || (current?.rollId === roll.rollId && current.matchId === roll.matchId)) return;
      current = roll;
      clockOffset = serverNow - Date.now();
      host.setAttribute("aria-label", `${OUTCOME_LABELS[roll.outcome]}, ${roll.faces.map((face, index) => `${index + 1}번 ${face ? "평평한 면" : "둥근 면"}`).join(", ")}`);
      staticFaces();
      if (renderer && !failed) {
        renderer.setAnimationLoop(() => renderFrame());
        renderFrame();
      }
    },
    destroy() {
      destroyed = true;
      observer?.disconnect();
      intersection?.disconnect();
      document.removeEventListener("visibilitychange", stopMotion);
      media?.removeEventListener("change", stopMotion);
      renderer?.setAnimationLoop(null);
      renderer?.domElement.removeEventListener("webglcontextlost", useFallback);
      geometries.forEach((item) => item.dispose());
      materials.forEach((item) => item.dispose());
      textures.forEach((item) => item.dispose());
      key.shadow.dispose();
      renderer?.dispose();
      scene.clear();
      renderer?.domElement.remove();
      fallback.remove();
    }
  };
}

/** Pure seeded trajectory; the final local Z rotation exposes exactly the server face. */
export function throwPose(roll: YutThrow | undefined, index: number, progress: number): { position: [number, number, number]; rotation: [number, number, number] } {
  const t = Math.min(1, Math.max(0, progress));
  const seed = ((roll?.visualSeed ?? 42) + index * 137) >>> 0;
  const jitter = ((Math.imul(seed ^ (seed >>> 13), 1597334677) >>> 0) % 1000) / 1000;
  const endX = (index - 1.5) * 0.99;
  const endZ = (jitter - 0.5) * 0.6;
  const flightEnd = LANDING_FRACTIONS[index % 4]!;
  const arc = t < flightEnd ? Math.sin((t / flightEnd) * Math.PI) * (2.15 + index * 0.12) : 0;
  const settled = Math.max(0, (t - flightEnd) / (1 - flightEnd));
  const bounce = Math.abs(Math.sin(settled * Math.PI * 2)) * 0.13 * (1 - settled);
  const spin = Math.pow(1 - Math.min(1, t / flightEnd), 1.5);
  return {
    position: [endX * (0.5 + 0.5 * t), (roll?.faces[index] ? 0.29 : 0.06) + arc + bounce, endZ + (1 - t) * 1.2],
    rotation: [spin * Math.PI * (4 + index), (jitter - 0.5) * 0.34 + spin * Math.PI * 2, (roll?.faces[index] ? Math.PI : 0) + spin * Math.PI * (6 + index * 2) + bounce * 0.5]
  };
}
