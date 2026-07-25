import * as THREE from "three";
import { heightAt } from "./terrain";
import type { TownBuildings, PlacedBuilding } from "../systems/townBuildings";
import { createHealthBar, type HealthBar } from "./healthBar";

const SPEED = 2.4;
const CONTACT_RANGE = 1.6;
const ATTACK_COOLDOWN = 1.1;
const ATTACK_DAMAGE = 10;
const MAX_HP = 30;

export class Wolf {
  readonly model: THREE.Group;
  hp = MAX_HP;
  alive = true;

  private attackReadyAt = 0;
  private healthBar: HealthBar;

  constructor(scene: THREE.Scene, spawnPoint: THREE.Vector3) {
    this.model = createWolfModel();
    this.model.position.copy(spawnPoint);
    scene.add(this.model);

    // Added directly to the scene (not as a model child) so it stays level
    // instead of inheriting the wolf's yaw as it turns to face movement.
    this.healthBar = createHealthBar(0.7, 0.1);
    scene.add(this.healthBar.group);
    this.syncHealthBarPosition();
  }

  update(
    delta: number,
    now: number,
    townBuildings: TownBuildings,
    onDamageBuilding: (building: PlacedBuilding, amount: number) => void,
  ) {
    if (!this.alive) return;

    const target = townBuildings.findNearest(this.model.position);
    if (!target) return;

    const dist = this.model.position.distanceTo(target.position);
    if (dist > CONTACT_RANGE) {
      this.moveToward(target.position, delta);
      this.syncHealthBarPosition();
      return;
    }

    if (now >= this.attackReadyAt) {
      onDamageBuilding(target, ATTACK_DAMAGE);
      this.attackReadyAt = now + ATTACK_COOLDOWN;
    }
  }

  /** Returns true if this hit killed the wolf. */
  takeDamage(amount: number): boolean {
    if (!this.alive) return false;
    this.hp -= amount;
    this.healthBar.setFraction(this.hp / MAX_HP);
    if (this.hp <= 0) {
      this.alive = false;
      this.model.visible = false;
      this.healthBar.group.visible = false;
      return true;
    }
    return false;
  }

  /** Removes both the model and its detached health bar from the scene. */
  dispose(scene: THREE.Scene) {
    scene.remove(this.model);
    scene.remove(this.healthBar.group);
  }

  private syncHealthBarPosition() {
    this.healthBar.group.position.set(
      this.model.position.x,
      this.model.position.y + 0.85,
      this.model.position.z,
    );
  }

  private moveToward(point: THREE.Vector3, delta: number) {
    const toTarget = point.clone().sub(this.model.position);
    toTarget.y = 0;
    const dist = toTarget.length();
    if (dist < 1e-4) return;
    toTarget.normalize().multiplyScalar(Math.min(SPEED * delta, dist));
    this.model.position.x += toTarget.x;
    this.model.position.z += toTarget.z;
    this.model.position.y = heightAt(this.model.position.x, this.model.position.z);
    this.model.rotation.y = Math.atan2(toTarget.x, toTarget.z);
  }
}

function createWolfModel(): THREE.Group {
  const group = new THREE.Group();
  const furMat = new THREE.MeshStandardMaterial({ color: 0x4a4a4a });

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 0.9), furMat);
  body.position.y = 0.35;
  body.castShadow = true;
  group.add(body);

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.3, 0.35), furMat);
  head.position.set(0, 0.45, 0.55);
  head.castShadow = true;
  group.add(head);

  const eyeMat = new THREE.MeshStandardMaterial({
    color: 0xff3b30,
    emissive: 0xff0000,
    emissiveIntensity: 0.8,
  });
  for (const dx of [-0.1, 0.1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 6), eyeMat);
    eye.position.set(dx, 0.48, 0.72);
    group.add(eye);
  }

  const legGeo = new THREE.BoxGeometry(0.12, 0.35, 0.12);
  const legOffsets: [number, number][] = [
    [-0.16, 0.3],
    [0.16, 0.3],
    [-0.16, -0.3],
    [0.16, -0.3],
  ];
  for (const [dx, dz] of legOffsets) {
    const leg = new THREE.Mesh(legGeo, furMat);
    leg.position.set(dx, 0.17, dz);
    leg.castShadow = true;
    group.add(leg);
  }

  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.4, 6), furMat);
  tail.rotation.x = Math.PI / 2.5;
  tail.position.set(0, 0.4, -0.55);
  group.add(tail);

  return group;
}
