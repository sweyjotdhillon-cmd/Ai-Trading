let _seed = 0xC0FFEE;
function pseudoRandom() {
  _seed = (_seed * 1664525 + 1013904223) % 4294967296;
  return _seed / 4294967296;
};
import { useRef, useMemo, useEffect, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { damp3, damp, dampE } from 'maath/easing';

export function Candle({ isHovered, warpPhase, reducedMotion }: { isHovered: boolean; warpPhase: number; reducedMotion: boolean | null }) {
  const groupRef = useRef<THREE.Group>(null);
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const wickTopRef = useRef<THREE.Mesh>(null);
  const wickBottomRef = useRef<THREE.Mesh>(null);
  const centralGlowRef = useRef<THREE.Mesh>(null);
  
  const segmentsX = 4;
  const segmentsY = 10;
  const segmentsZ = 4;
  const count = segmentsX * segmentsY * segmentsZ;
  
  const width = 0.4;
  const height = 3.5;
  const depth = 0.4;
  
  const w = width / segmentsX;
  const h = height / segmentsY;
  const d = depth / segmentsZ;

  const [assembled, setAssembled] = useState(reducedMotion);

  const { originalPositions, explodedPositions } = useMemo(() => {
    const orig = [];
    const expl = [];
    for (let x = 0; x < segmentsX; x++) {
      for (let y = 0; y < segmentsY; y++) {
        for (let z = 0; z < segmentsZ; z++) {
          const px = (x - segmentsX / 2 + 0.5) * w;
          const py = (y - segmentsY / 2 + 0.5) * h;
          const pz = (z - segmentsZ / 2 + 0.5) * d;
          orig.push(new THREE.Vector3(px, py, pz));
          expl.push(new THREE.Vector3(
            px + (pseudoRandom() - 0.5) * 8,
            py + (pseudoRandom() - 0.5) * 8,
            pz + (pseudoRandom() - 0.5) * 8
          ));
        }
      }
    }
    return { originalPositions: orig, explodedPositions: expl };
  }, [w, h, d]);

  const dummy = useMemo(() => new THREE.Object3D(), []);
  
  useEffect(() => {
    if (!reducedMotion) {
      const timer = setTimeout(() => setAssembled(true), 300);
      return () => clearTimeout(timer);
    }
  }, [reducedMotion]);

  useFrame(({ clock }, delta) => {
    if (!reducedMotion && meshRef.current) {
        for (let i = 0; i < count; i++) {
           const target = assembled ? originalPositions[i] : explodedPositions[i];
           const currentPos = new THREE.Vector3();
           meshRef.current.getMatrixAt(i, dummy.matrix);
           currentPos.setFromMatrixPosition(dummy.matrix);
           damp3(currentPos, target, assembled ? 0.4 + (i*0.005) : 0.1, delta);
           dummy.position.copy(currentPos);
           if (!assembled) {
              dummy.rotation.x += delta * (i%3);
              dummy.rotation.y += delta * (i%4);
           } else {
              dampE(dummy.rotation, [0,0,0], 0.2, delta);
           }
           dummy.updateMatrix();
           meshRef.current.setMatrixAt(i, dummy.matrix);
        }
        meshRef.current.instanceMatrix.needsUpdate = true;
    }
    
    if (groupRef.current && assembled) {
        groupRef.current.rotation.y = clock.elapsedTime * 0.15;
        groupRef.current.rotation.z = Math.sin(clock.elapsedTime * 2) * (4 * Math.PI / 180);
        
        let scaleTargetY = 1;
        if (warpPhase === 1) scaleTargetY = 1.15;
        damp3(groupRef.current.scale, [1, scaleTargetY, 1], 0.1, delta);
    }

    if (centralGlowRef.current) {
      const targetIntensity = isHovered ? 4 : 2;
      damp(centralGlowRef.current.material as any, 'emissiveIntensity', targetIntensity, 0.1, delta);
    }
  });

  useEffect(() => {
    if (meshRef.current && reducedMotion) {
       for (let i = 0; i < count; i++) {
           dummy.position.copy(originalPositions[i]);
           dummy.updateMatrix();
           meshRef.current.setMatrixAt(i, dummy.matrix);
       }
       meshRef.current.instanceMatrix.needsUpdate = true;
    }
  }, [reducedMotion, count, originalPositions, dummy]);

  return (
    <group ref={groupRef}>
      <instancedMesh ref={meshRef} args={[undefined, undefined, count]}>
        <boxGeometry args={[w * 0.98, h * 0.98, d * 0.98]} />
        <meshPhysicalMaterial 
            color="#D9B382" 
            metalness={1} 
            roughness={0.18} 
            clearcoat={1} 
            clearcoatRoughness={0.05} 
            envMapIntensity={1.2} 
        />
      </instancedMesh>
      
      {/* Wick */}
      <mesh ref={wickTopRef} position={[0, height/2 + 0.3, 0]}>
        <cylinderGeometry args={[0.02, 0.02, 0.6]} />
        <meshBasicMaterial color="#22C55E" />
      </mesh>
      <mesh ref={wickBottomRef} position={[0, -height/2 - 0.3, 0]}>
        <cylinderGeometry args={[0.02, 0.02, 0.6]} />
        <meshBasicMaterial color="#EF4444" />
      </mesh>
      
      {/* Central glow */}
      <mesh ref={centralGlowRef}>
        <cylinderGeometry args={[0.05, 0.05, height + 1]} />
        <meshStandardMaterial color="#D9B382" emissive="#D9B382" emissiveIntensity={2} toneMapped={false} />
      </mesh>
    </group>
  );
}
