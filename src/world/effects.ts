import * as THREE from "three";

const ARROW_SPEED = 26; // world units per second
const ARROW_ARC = 0.9; // peak height added mid-flight
const IMPACT_DURATION = 0.28;
const SLASH_DURATION = 0.18;

interface Projectile {
  mesh: THREE.Mesh;
  from: THREE.Vector3;
  to: THREE.Vector3;
  travelled: number;
  distance: number;
}

interface Fading {
  mesh: THREE.Mesh;
  age: number;
  duration: number;
  grow: number;
}

/** Transient combat visuals: arrows in flight, hit sparks and melee slashes.
 * Purely cosmetic — damage is still applied the moment an attack fires, so
 * these never affect the simulation. */
export class Effects {
  private projectiles: Projectile[] = [];
  private fading: Fading[] = [];
  private arrowGeometry: THREE.CylinderGeometry;
  private arrowMaterial: THREE.MeshStandardMaterial;
  private impactGeometry: THREE.RingGeometry;
  private slashGeometry: THREE.RingGeometry;

  constructor(private scene: THREE.Scene) {
    // A thin shaft laid along +Z so it can be oriented with lookAt.
    this.arrowGeometry = new THREE.CylinderGeometry(0.035, 0.01, 0.7, 5);
    this.arrowGeometry.rotateX(Math.PI / 2);
    this.arrowMaterial = new THREE.MeshStandardMaterial({
      color: 0x6b4a2f,
      emissive: 0x2a1a0a,
      emissiveIntensity: 0.4,
    });
    this.impactGeometry = new THREE.RingGeometry(0.05, 0.22, 12);
    this.slashGeometry = new THREE.RingGeometry(0.35, 0.5, 12, 1, 0, Math.PI * 0.7);
  }

  /** Looses an arrow that flies from `from` to `to` and bursts on arrival. */
  fireArrow(from: THREE.Vector3, to: THREE.Vector3) {
    const mesh = new THREE.Mesh(this.arrowGeometry, this.arrowMaterial);
    mesh.position.copy(from);
    mesh.lookAt(to);
    this.scene.add(mesh);
    this.projectiles.push({
      mesh,
      from: from.clone(),
      to: to.clone(),
      travelled: 0,
      distance: Math.max(0.001, from.distanceTo(to)),
    });
  }

  /** A quick burst at the point of impact. */
  impact(at: THREE.Vector3, color = 0xffcc66) {
    const mesh = new THREE.Mesh(
      this.impactGeometry,
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    mesh.position.copy(at);
    // Lie flat-ish but tilted toward the camera so it reads from our angle.
    mesh.rotation.x = -Math.PI / 3;
    this.scene.add(mesh);
    this.fading.push({ mesh, age: 0, duration: IMPACT_DURATION, grow: 2.6 });
  }

  /** An arc swept where a melee blow lands. */
  slash(at: THREE.Vector3, facing: number, color = 0xf2f2f2) {
    const mesh = new THREE.Mesh(
      this.slashGeometry,
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    mesh.position.copy(at);
    mesh.rotation.set(-Math.PI / 2.2, 0, -facing);
    this.scene.add(mesh);
    this.fading.push({ mesh, age: 0, duration: SLASH_DURATION, grow: 1.5 });
  }

  update(delta: number) {
    this.projectiles = this.projectiles.filter((p) => {
      p.travelled += ARROW_SPEED * delta;
      const t = p.travelled / p.distance;
      if (t >= 1) {
        this.scene.remove(p.mesh);
        this.impact(p.to);
        return false;
      }
      p.mesh.position.lerpVectors(p.from, p.to, t);
      // Ballistic sag: highest at mid-flight, scaled by how far it travels.
      p.mesh.position.y += Math.sin(t * Math.PI) * ARROW_ARC * (p.distance / 12);
      return true;
    });

    this.fading = this.fading.filter((f) => {
      f.age += delta;
      const t = f.age / f.duration;
      if (t >= 1) {
        this.scene.remove(f.mesh);
        (f.mesh.material as THREE.Material).dispose();
        return false;
      }
      const scale = 1 + t * f.grow;
      f.mesh.scale.setScalar(scale);
      (f.mesh.material as THREE.MeshBasicMaterial).opacity = 1 - t;
      return true;
    });
  }
}
