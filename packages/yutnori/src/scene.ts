import * as THREE from "three";
import type { YutThrow } from "./types";
import { OUTCOME_LABELS } from "./types";
import { stickFaceMarkup } from "./stick-face";

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
  camera.lookAt(0, .7, 0);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x687583, 3));
  const key = new THREE.DirectionalLight(0xffffff, 4);
  key.position.set(-4, 8, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(512, 512);
  key.shadow.camera.left = -5;
  key.shadow.camera.right = 5;
  key.shadow.camera.top = 5;
  key.shadow.camera.bottom = -5;
  key.shadow.normalBias = 0.025;
  scene.add(key);
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  function geometry<T extends THREE.BufferGeometry>(value: T): T { geometries.push(value); return value; }
  function material<T extends THREE.Material>(value: T): T { materials.push(value); return value; }
  const shape = new THREE.Shape();
  shape.moveTo(0.23, 0);
  shape.absarc(0, 0, 0.23, 0, Math.PI, false);
  shape.lineTo(0.23, 0);
  const body = geometry(new THREE.ExtrudeGeometry(shape, { depth: 2.3, bevelEnabled: true, bevelSegments: 2, steps: 1, bevelSize: 0.008, bevelThickness: 0.04, curveSegments: 14 }));
  body.translate(0, 0, -1.15);
  const wood = material(new THREE.MeshStandardMaterial({ color: 0xba7c3b, roughness: 0.56 }));
  const flat = material(new THREE.MeshStandardMaterial({ color: 0xf4dcb0, roughness: 0.68, side: THREE.DoubleSide }));
  const ink = material(new THREE.MeshStandardMaterial({ color: 0x663e27 }));
  const red = material(new THREE.MeshStandardMaterial({ color: 0xb44636 }));
  const faceGeometry = geometry(new THREE.PlaneGeometry(0.43, 2.25));
  const crossGeometries = [-1, 1].map((sign) => {
    const points = Array.from({ length: 7 }, (_, step) => {
      const x = -.105 + step / 6 * .21;
      return new THREE.Vector3(x, Math.sqrt(.23 * .23 - x * x) + .018, sign * x);
    });
    return geometry(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 12, .012, 5, false));
  });
  const dotGeometry = geometry(new THREE.CircleGeometry(.053, 24));
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
      dot.position.y = -.054;
      group.add(dot);
    }
    scene.add(group);
    return group;
  });
  const mat = new THREE.Mesh(geometry(new THREE.CircleGeometry(3.3, 48)), material(new THREE.ShadowMaterial({ opacity: 0.12 })));
  mat.rotation.x = -Math.PI / 2;
  mat.receiveShadow = true;
  scene.add(mat);
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
      if (destroyed || current?.rollId === roll.rollId && current.matchId === roll.matchId) return;
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
  const flightEnd = [.53, .67, .79, .88][index % 4]!;
  const arc = t < flightEnd ? Math.sin(t / flightEnd * Math.PI) * (2.15 + index * .12) : 0;
  const settled = Math.max(0, (t - flightEnd) / (1 - flightEnd));
  const bounce = Math.abs(Math.sin(settled * Math.PI * 2)) * .13 * (1 - settled);
  const spin = Math.pow(1 - Math.min(1, t / flightEnd), 1.5);
  return {
    position: [endX * (0.5 + 0.5 * t), (roll?.faces[index] ? .29 : .06) + arc + bounce, endZ + (1 - t) * 1.2],
    rotation: [spin * Math.PI * (4 + index), (jitter - 0.5) * 0.34 + spin * Math.PI * 2, (roll?.faces[index] ? Math.PI : 0) + spin * Math.PI * (6 + index * 2) + bounce * .5]
  };
}
