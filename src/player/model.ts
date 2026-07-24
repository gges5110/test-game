import * as THREE from "three";

/** Placeholder low-poly humanoid: capsule body + box limbs. Good enough to
 * prove movement feel before investing in a rigged model. */
export function createPlayerModel(): THREE.Group {
  const group = new THREE.Group();

  const skin = new THREE.MeshStandardMaterial({ color: 0xd8a888 });
  const tunic = new THREE.MeshStandardMaterial({ color: 0x3d6b8a });

  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.35, 0.7, 4, 8),
    tunic,
  );
  body.position.y = 1;
  body.castShadow = true;
  group.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 12), skin);
  head.position.y = 1.75;
  head.castShadow = true;
  group.add(head);

  const armGeo = new THREE.BoxGeometry(0.18, 0.6, 0.18);
  const leftArm = new THREE.Mesh(armGeo, tunic);
  leftArm.position.set(-0.5, 1.05, 0);
  leftArm.castShadow = true;
  group.add(leftArm);

  const rightArm = new THREE.Mesh(armGeo, tunic);
  rightArm.position.set(0.5, 1.05, 0);
  rightArm.castShadow = true;
  group.add(rightArm);

  const legGeo = new THREE.BoxGeometry(0.2, 0.6, 0.2);
  const leftLeg = new THREE.Mesh(legGeo, new THREE.MeshStandardMaterial({ color: 0x2b2b2b }));
  leftLeg.position.set(-0.18, 0.35, 0);
  leftLeg.castShadow = true;
  group.add(leftLeg);

  const rightLeg = new THREE.Mesh(legGeo, new THREE.MeshStandardMaterial({ color: 0x2b2b2b }));
  rightLeg.position.set(0.18, 0.35, 0);
  rightLeg.castShadow = true;
  group.add(rightLeg);

  return group;
}
