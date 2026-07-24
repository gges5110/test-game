import * as THREE from "three";
import { heightAt } from "./terrain";

const WANDER_RADIUS = 10;
const CHASE_SPEED = 3.2;
const WANDER_SPEED = 1.4;
const AGGRO_RANGE = 9;
const CONTACT_RANGE = 1.3;
const ATTACK_COOLDOWN = 1.1;
const ATTACK_DAMAGE = 8;
const MAX_HP = 30;
const RESPAWN_DELAY = 25;
const RESPAWN_MIN_DIST = 20;
const RESPAWN_MAX_DIST = 90;

export class Wolf {
  readonly model: THREE.Group;
  hp = MAX_HP;
  alive = true;

  private home: THREE.Vector3;
  private wanderTarget: THREE.Vector3;
  private wanderWaitUntil = 0;
  private attackReadyAt = 0;
  private deadAt = 0;

  constructor(scene: THREE.Scene, spawnPoint: THREE.Vector3) {
    this.home = spawnPoint.clone();
    this.wanderTarget = spawnPoint.clone();
    this.model = createWolfModel();
    this.model.position.copy(spawnPoint);
    scene.add(this.model);
  }

  update(
    delta: number,
    now: number,
    playerPosition: THREE.Vector3,
    onDamagePlayer: (amount: number) => void,
  ) {
    if (!this.alive) {
      if (now - this.deadAt >= RESPAWN_DELAY) this.respawn();
      return;
    }

    const distToPlayer = this.model.position.distanceTo(playerPosition);
    if (distToPlayer < AGGRO_RANGE) {
      this.moveToward(playerPosition, CHASE_SPEED, delta);
      if (distToPlayer < CONTACT_RANGE && now >= this.attackReadyAt) {
        onDamagePlayer(ATTACK_DAMAGE);
        this.attackReadyAt = now + ATTACK_COOLDOWN;
      }
      return;
    }

    if (this.model.position.distanceTo(this.wanderTarget) > 0.4) {
      this.moveToward(this.wanderTarget, WANDER_SPEED, delta);
    } else if (now > this.wanderWaitUntil) {
      this.pickWanderTarget(now);
    }
  }

  /** Returns true if this hit killed the wolf. */
  takeDamage(amount: number, now: number): boolean {
    if (!this.alive) return false;
    this.hp -= amount;
    if (this.hp <= 0) {
      this.alive = false;
      this.model.visible = false;
      this.deadAt = now;
      return true;
    }
    return false;
  }

  private respawn() {
    this.hp = MAX_HP;
    this.alive = true;
    this.model.visible = true;
    const angle = Math.random() * Math.PI * 2;
    const dist = RESPAWN_MIN_DIST + Math.random() * (RESPAWN_MAX_DIST - RESPAWN_MIN_DIST);
    const x = Math.cos(angle) * dist;
    const z = Math.sin(angle) * dist;
    this.home.set(x, heightAt(x, z), z);
    this.model.position.copy(this.home);
    this.wanderTarget.copy(this.home);
  }

  private moveToward(point: THREE.Vector3, speed: number, delta: number) {
    const toTarget = point.clone().sub(this.model.position);
    toTarget.y = 0;
    const dist = toTarget.length();
    if (dist < 1e-4) return;
    toTarget.normalize().multiplyScalar(Math.min(speed * delta, dist));
    this.model.position.x += toTarget.x;
    this.model.position.z += toTarget.z;
    this.model.position.y = heightAt(this.model.position.x, this.model.position.z);
    this.model.rotation.y = Math.atan2(toTarget.x, toTarget.z);
  }

  private pickWanderTarget(now: number) {
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.random() * WANDER_RADIUS;
    const x = this.home.x + Math.cos(angle) * radius;
    const z = this.home.z + Math.sin(angle) * radius;
    this.wanderTarget.set(x, heightAt(x, z), z);
    this.wanderWaitUntil = now + 2 + Math.random() * 4;
  }
}

function createWolfModel(): THREE.Group {
  const group = new THREE.Group();
  const furMat = new THREE.MeshStandardMaterial({ color: 0x4a4a4a, flatShading: true });

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
