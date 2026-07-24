import * as THREE from "three";
import { heightAt } from "../world/terrain";
import { createPlayerModel } from "./model";

const MOVE_SPEED = 11; // units/sec
const JUMP_SPEED = 5.5;
const GRAVITY = 14;
const CAMERA_DISTANCE = 16;
const CAMERA_MIN_PITCH = 0.3;
const CAMERA_MAX_PITCH = 1.3;

export class PlayerController {
  readonly model: THREE.Group;
  readonly position = new THREE.Vector3(0, 0, 0);

  private camera: THREE.PerspectiveCamera;

  private keys = new Set<string>();
  private cameraYaw = Math.PI;
  private cameraPitch = 0.5;
  private dragging = false;
  private lastPointer = { x: 0, y: 0 };

  private verticalVelocity = 0;
  private grounded = true;

  constructor(
    camera: THREE.PerspectiveCamera,
    domElement: HTMLElement,
    scene: THREE.Scene,
  ) {
    this.camera = camera;
    this.model = createPlayerModel();
    scene.add(this.model);

    this.position.y = heightAt(0, 0);
    this.model.position.copy(this.position);

    window.addEventListener("keydown", (e) => this.keys.add(e.code));
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));

    domElement.addEventListener("pointerdown", (e) => {
      this.dragging = true;
      this.lastPointer = { x: e.clientX, y: e.clientY };
    });
    window.addEventListener("pointerup", () => (this.dragging = false));
    window.addEventListener("pointermove", (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.lastPointer.x;
      const dy = e.clientY - this.lastPointer.y;
      this.lastPointer = { x: e.clientX, y: e.clientY };
      this.cameraYaw -= dx * 0.005;
      this.cameraPitch = THREE.MathUtils.clamp(
        this.cameraPitch - dy * 0.005,
        CAMERA_MIN_PITCH,
        CAMERA_MAX_PITCH,
      );
    });

    window.addEventListener("keydown", (e) => {
      if (e.code === "Space" && this.grounded) {
        this.verticalVelocity = JUMP_SPEED;
        this.grounded = false;
      }
    });
  }

  update(delta: number) {
    // Forward is the direction the camera looks (away from the camera,
    // into the scene) — the opposite of the camera's orbit offset.
    const forward = new THREE.Vector3(
      -Math.sin(this.cameraYaw),
      0,
      -Math.cos(this.cameraYaw),
    );
    // Right = cross(forward, up), so D strafes to the character's right.
    const right = new THREE.Vector3(-forward.z, 0, forward.x);

    const move = new THREE.Vector3();
    if (this.keys.has("KeyW")) move.add(forward);
    if (this.keys.has("KeyS")) move.sub(forward);
    if (this.keys.has("KeyD")) move.add(right);
    if (this.keys.has("KeyA")) move.sub(right);

    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar(MOVE_SPEED * delta);
      this.position.x += move.x;
      this.position.z += move.z;
      this.model.rotation.y = Math.atan2(move.x, move.z);
    }

    // Vertical: jump arc with gravity, snapped to terrain when grounded.
    const groundHeight = heightAt(this.position.x, this.position.z);
    if (!this.grounded) {
      this.verticalVelocity -= GRAVITY * delta;
      this.position.y += this.verticalVelocity * delta;
      if (this.position.y <= groundHeight) {
        this.position.y = groundHeight;
        this.grounded = true;
        this.verticalVelocity = 0;
      }
    } else {
      this.position.y = groundHeight;
    }

    this.model.position.copy(this.position);

    // Camera orbits at fixed distance/pitch around the player.
    const camOffset = new THREE.Vector3(
      Math.sin(this.cameraYaw) * Math.cos(this.cameraPitch),
      Math.sin(this.cameraPitch),
      Math.cos(this.cameraYaw) * Math.cos(this.cameraPitch),
    ).multiplyScalar(CAMERA_DISTANCE);

    const lookTarget = this.position.clone().add(new THREE.Vector3(0, 1.4, 0));
    this.camera.position.copy(lookTarget).add(camOffset);
    this.camera.lookAt(lookTarget);
  }
}
