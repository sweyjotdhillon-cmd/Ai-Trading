let _seed = 0xC0FFEE;
function pseudoRandom() {
  _seed = (_seed * 1664525 + 1013904223) % 4294967296;
  return _seed / 4294967296;
};
import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { InstancedMesh, Object3D } from 'three';

const RING_DATA = [
  { radius: 2.4, color: '#A67C52', angle: 0, speed: 0.2 },
  { radius: 3.0, color: '#D9B382', angle: Math.PI / 3, speed: -0.15 },
  { radius: 3.6, color: '#22C55E', angle: -Math.PI / 4, speed: 0.1 },
];

export function Rings({ isMobile, reducedMotion }: { isMobile: boolean; reducedMotion: boolean | null }) {
  const groupRef = useRef<THREE.Group>(null);

  const ringsToRender = isMobile ? RING_DATA.slice(0, 2) : RING_DATA;

  useFrame(({ clock }) => {
    if (reducedMotion || !groupRef.current) return;
    const t = clock.elapsedTime;
    groupRef.current.children.forEach((ring, i) => {
      ring.rotation.z = t * ringsToRender[i].speed;
    });
  });

  return (
    <group ref={groupRef}>
      {ringsToRender.map((data, i) => (
        <group key={i} rotation={[Math.PI / 2, data.angle, 0]}>
          <mesh>
            <torusGeometry args={[data.radius, 0.015, 16, 100]} />
            <meshStandardMaterial color={data.color} emissive={data.color} emissiveIntensity={1.5} transparent opacity={0.6} toneMapped={false} />
          </mesh>
          <SignalDots radius={data.radius} color={data.color} speed={data.speed} reducedMotion={reducedMotion} />
        </group>
      ))}
    </group>
  );
}

function SignalDots({ radius, color, speed, reducedMotion }: { radius: number; color: string; speed: number; reducedMotion: boolean | null }) {
  const count = 8;
  const meshRef = useRef<InstancedMesh>(null);
  const dummy = useMemo(() => new Object3D(), []);
  const phases = useMemo(() => Array.from({ length: count }, () => pseudoRandom() * Math.PI * 2), []);
  const isRed = useMemo(() => Array.from({ length: count }, () => pseudoRandom() > 0.8), []);
  const targetColor = useMemo(() => new THREE.Color(), []);

  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    const t = reducedMotion ? 0 : clock.elapsedTime * Math.abs(speed) * 2;
    
    for (let i = 0; i < count; i++) {
        const angle = phases[i] + t;
        dummy.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
        dummy.updateMatrix();
        meshRef.current.setMatrixAt(i, dummy.matrix);
        
        targetColor.set(color);
        if (!reducedMotion) {
           const bloom = Math.sin(t * 5 + i * 1.5);
           if (bloom > 0.9) {
               targetColor.set(isRed[i] ? '#EF4444' : '#22C55E');
           }
        }
        meshRef.current.setColorAt(i, targetColor);
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
    if (meshRef.current.instanceColor) meshRef.current.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, count]}>
      <sphereGeometry args={[0.04, 16, 16]} />
      <meshBasicMaterial toneMapped={false} />
    </instancedMesh>
  );
}
