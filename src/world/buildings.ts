import * as THREE from "three";

function createHouseMesh(): THREE.Group {
  const group = new THREE.Group();
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xd9c19a });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x8a4a3a });

  const walls = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.6, 2.2), wallMat);
  walls.position.y = 0.8;
  walls.castShadow = true;
  walls.receiveShadow = true;
  group.add(walls);

  const roof = new THREE.Mesh(new THREE.ConeGeometry(1.7, 1.1, 4), roofMat);
  roof.rotation.y = Math.PI / 4;
  roof.position.y = 2.15;
  roof.castShadow = true;
  group.add(roof);

  return group;
}

function createStorageMesh(): THREE.Group {
  const group = new THREE.Group();
  const baseMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2f });
  const base = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1, 1.4), baseMat);
  base.position.y = 0.5;
  base.castShadow = true;
  group.add(base);

  const barrelMat = new THREE.MeshStandardMaterial({ color: 0x8a6238 });
  for (const dx of [-0.5, 0.5]) {
    const barrel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.25, 0.25, 0.7, 8),
      barrelMat,
    );
    barrel.position.set(dx, 1.35, 0);
    barrel.castShadow = true;
    group.add(barrel);
  }

  return group;
}

function createWallMesh(): THREE.Group {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x9a9086, flatShading: true });
  const segment = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.2, 0.3), mat);
  segment.position.y = 0.6;
  segment.castShadow = true;
  group.add(segment);
  return group;
}

export function createBuildingMesh(id: string): THREE.Group {
  if (id === "house") return createHouseMesh();
  if (id === "storage") return createStorageMesh();
  return createWallMesh();
}

/** Makes a mesh translucent for use as a placement preview ("ghost"). */
export function makeGhost(mesh: THREE.Group): THREE.Group {
  mesh.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      const material = (child.material as THREE.MeshStandardMaterial).clone();
      material.transparent = true;
      material.opacity = 0.5;
      child.material = material;
      child.castShadow = false;
    }
  });
  return mesh;
}
