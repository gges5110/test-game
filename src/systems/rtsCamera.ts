import * as THREE from "three";

export const CAMERA_PITCH = 0.72; // fixed downward look angle, radians (~41°)
const PITCH = CAMERA_PITCH;
const MIN_DIST = 14;
const MAX_DIST = 65;
const DEFAULT_DIST = 32;
const TAP_MAX_DURATION = 500; // ms
const TAP_MAX_MOVE = 6; // px
const KEY_PAN_SPEED = 22; // units/sec, at default zoom

/** Top-down RTS camera: drag to pan, wheel/pinch to zoom, plus tap
 * detection (a press+release with minimal movement) for selection. Owns
 * all pointer gesture recognition so callers just get a clean onTap. */
export class RtsCamera {
  readonly camera: THREE.PerspectiveCamera;
  readonly focus = new THREE.Vector3(0, 0, 0);

  private distance = DEFAULT_DIST;
  private raycaster = new THREE.Raycaster();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private onTapHandler: (screenX: number, screenY: number, button: number, isTouch: boolean) => void =
    () => {};
  private onBoxSelectHandler: (
    rect: { x1: number; y1: number; x2: number; y2: number } | null,
    final: boolean,
  ) => void = () => {};

  private pointers = new Map<number, { x: number; y: number }>();
  private dragLast = { x: 0, y: 0 };
  private pinchStartDist = 0;
  private pinchStartZoom = 0;
  private gestureMoved = false;
  private tapStart = { x: 0, y: 0, t: 0, button: 0, isTouch: false };
  private primaryButton = 0;
  private boxSelecting = false;
  private keys = new Set<string>();

  constructor(
    private domElement: HTMLElement,
    aspect: number,
  ) {
    this.camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 1000);
    this.updateTransform();

    domElement.addEventListener("pointerdown", (e) => this.onPointerDown(e));
    domElement.addEventListener("pointermove", (e) => this.onPointerMove(e));
    domElement.addEventListener("pointerup", (e) => this.onPointerEnd(e));
    domElement.addEventListener("pointercancel", (e) => this.onPointerEnd(e));
    domElement.addEventListener("contextmenu", (e) => e.preventDefault());
    domElement.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this.zoomTo(this.distance + e.deltaY * 0.05);
      },
      { passive: false },
    );

    const panKeys = ["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
    window.addEventListener("keydown", (e) => {
      if (panKeys.includes(e.code)) this.keys.add(e.code);
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
  }

  /** Desktop WASD/arrow-key panning — call once per frame. */
  updateKeyboardPan(delta: number) {
    if (this.keys.size === 0) return;
    const speed = KEY_PAN_SPEED * (this.distance / DEFAULT_DIST) * delta;
    let dx = 0;
    let dz = 0;
    if (this.keys.has("KeyW") || this.keys.has("ArrowUp")) dz -= 1;
    if (this.keys.has("KeyS") || this.keys.has("ArrowDown")) dz += 1;
    if (this.keys.has("KeyA") || this.keys.has("ArrowLeft")) dx -= 1;
    if (this.keys.has("KeyD") || this.keys.has("ArrowRight")) dx += 1;
    if (dx === 0 && dz === 0) return;
    const len = Math.hypot(dx, dz);
    this.focus.x += (dx / len) * speed;
    this.focus.z += (dz / len) * speed;
    this.updateTransform();
  }

  private onPointerDown(e: PointerEvent) {
    try {
      this.domElement.setPointerCapture(e.pointerId);
    } catch {
      // Ignore — happens for synthetic pointer events not backed by a real session.
    }
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this.gestureMoved = false;

    if (this.pointers.size === 1) {
      this.primaryButton = e.button;
      this.dragLast = { x: e.clientX, y: e.clientY };
      this.tapStart = {
        x: e.clientX,
        y: e.clientY,
        t: performance.now(),
        button: e.button,
        isTouch: e.pointerType === "touch",
      };
    } else if (this.pointers.size === 2) {
      this.pinchStartDist = this.currentPinchDist();
      this.pinchStartZoom = this.distance;
    }
  }

  private onPointerMove(e: PointerEvent) {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (this.pointers.size === 1) {
      const dx = e.clientX - this.dragLast.x;
      const dy = e.clientY - this.dragLast.y;
      if (Math.abs(e.clientX - this.tapStart.x) > TAP_MAX_MOVE ||
          Math.abs(e.clientY - this.tapStart.y) > TAP_MAX_MOVE) {
        this.gestureMoved = true;
      }
      if (this.primaryButton === 0 && !this.tapStart.isTouch) {
        // Left-mouse drag box-selects instead of panning; touch has no
        // spare gesture so single-finger drag still pans there.
        if (this.gestureMoved) {
          this.boxSelecting = true;
          this.onBoxSelectHandler(
            { x1: this.tapStart.x, y1: this.tapStart.y, x2: e.clientX, y2: e.clientY },
            false,
          );
        }
      } else if (this.primaryButton !== 2) {
        // Right-button drags don't pan — right-click is reserved for commands.
        this.pan(dx, dy);
      }
      this.dragLast = { x: e.clientX, y: e.clientY };
    } else if (this.pointers.size === 2) {
      this.gestureMoved = true;
      const dist = this.currentPinchDist();
      const scale = this.pinchStartDist > 0 ? dist / this.pinchStartDist : 1;
      this.zoomTo(this.pinchStartZoom / scale);
    }
  }

  private onPointerEnd(e: PointerEvent) {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    if (this.pointers.size === 0) {
      if (this.boxSelecting) {
        this.onBoxSelectHandler(
          { x1: this.tapStart.x, y1: this.tapStart.y, x2: e.clientX, y2: e.clientY },
          true,
        );
        this.boxSelecting = false;
      } else if (!this.gestureMoved) {
        const dt = performance.now() - this.tapStart.t;
        if (dt < TAP_MAX_DURATION) {
          this.onTapHandler(this.tapStart.x, this.tapStart.y, this.tapStart.button, this.tapStart.isTouch);
        }
      }
    }
  }

  private currentPinchDist(): number {
    const pts = Array.from(this.pointers.values());
    if (pts.length < 2) return 0;
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  }

  private pan(dx: number, dy: number) {
    const scale = this.distance * 0.0016;
    this.focus.x -= dx * scale;
    this.focus.z -= dy * scale;
    this.updateTransform();
  }

  private zoomTo(dist: number) {
    this.distance = THREE.MathUtils.clamp(dist, MIN_DIST, MAX_DIST);
    this.updateTransform();
  }

  private updateTransform() {
    const y = Math.sin(PITCH) * this.distance;
    const z = Math.cos(PITCH) * this.distance;
    this.camera.position.set(this.focus.x, this.focus.y + y, this.focus.z + z);
    this.camera.lookAt(this.focus.x, this.focus.y, this.focus.z);
  }

  /** button: 0 = left/touch, 2 = right-click. isTouch distinguishes touch taps from mouse clicks. */
  setOnTap(handler: (screenX: number, screenY: number, button: number, isTouch: boolean) => void) {
    this.onTapHandler = handler;
  }

  /** Fired during a left-mouse drag (rect, final=false) for live visuals, and
   * once more on release (rect, final=true) to commit the selection. Mouse only. */
  setOnBoxSelect(
    handler: (rect: { x1: number; y1: number; x2: number; y2: number } | null, final: boolean) => void,
  ) {
    this.onBoxSelectHandler = handler;
  }

  /** Projects a world point to screen-space pixel coordinates, or null if behind the camera. */
  worldToScreen(point: THREE.Vector3): { x: number; y: number } | null {
    const p = point.clone().project(this.camera);
    if (p.z > 1) return null;
    return {
      x: ((p.x + 1) / 2) * window.innerWidth,
      y: ((-p.y + 1) / 2) * window.innerHeight,
    };
  }

  /** Where a screen point hits the y=0 ground plane — good enough for XZ;
   * pair with heightAt(x,z) for the real terrain height. */
  raycastGround(screenX: number, screenY: number): THREE.Vector3 | null {
    const ndc = this.toNdc(screenX, screenY);
    this.raycaster.setFromCamera(ndc, this.camera);
    const point = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(this.groundPlane, point) ? point : null;
  }

  /** Deepest intersected object under a screen point, or null. */
  raycastObjects(screenX: number, screenY: number, objects: THREE.Object3D[]): THREE.Object3D | null {
    const ndc = this.toNdc(screenX, screenY);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(objects, true);
    return hits.length > 0 ? hits[0].object : null;
  }

  private toNdc(screenX: number, screenY: number): THREE.Vector2 {
    return new THREE.Vector2(
      (screenX / window.innerWidth) * 2 - 1,
      -(screenY / window.innerHeight) * 2 + 1,
    );
  }

  setAspect(aspect: number) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }
}
