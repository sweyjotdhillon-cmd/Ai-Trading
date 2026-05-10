import { useEffect, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Environment, Grid } from '@react-three/drei';
import { EffectComposer, Bloom, ChromaticAberration, Vignette } from '@react-three/postprocessing';
import * as THREE from 'three';
import { damp3, dampE } from 'maath/easing';

import { Candle } from './hero/Candle';
import { Rings } from './hero/Rings';
import { Particles } from './hero/Particles';

export default function HeroScene({ isHovered, warpPhase, reducedMotion }: { isHovered: boolean; warpPhase: number; reducedMotion: boolean | null }) {
  const { camera, pointer } = useThree();
  const groupRef = useRef<THREE.Group>(null);
  const gridGroupRef = useRef<THREE.Group>(null);
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' ? window.innerWidth < 640 : false);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 640);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (!reducedMotion) {
       camera.position.set(0, 0, 14);
    } else {
       camera.position.set(0, 0.3, 6);
    }
  }, [camera, reducedMotion]);

  useFrame((state, delta) => {
    if (!reducedMotion) {
      const targetFov = warpPhase === 1 ? 60 : 35;
      const cam = camera as THREE.PerspectiveCamera;
      damp3(cam.position, [0, 0.3, 6], 0.8, delta);
      cam.fov = THREE.MathUtils.lerp(cam.fov, targetFov, delta * 5);
      cam.updateProjectionMatrix();

      if (groupRef.current) {
        dampE(
            groupRef.current.rotation, 
            [-pointer.y * 0.1, pointer.x * 0.15, 0], 
            0.1, 
            delta
        );
      }
      
      if (gridGroupRef.current) {
        gridGroupRef.current.position.z = (state.clock.elapsedTime * 0.5) % 1;
      }
    }
  });

  return (
    <>
      <ambientLight intensity={0.15} />
      <directionalLight 
        position={[4, 5, 3]} 
        color="#D9B382" 
        intensity={2.2} 
      />
      <directionalLight 
        position={[-5, 2, -3]} 
        color="#4F6EF7" 
        intensity={0.6} 
      />
      <Environment preset="warehouse" />

      <group ref={groupRef}>
        <Candle isHovered={isHovered} warpPhase={warpPhase} reducedMotion={reducedMotion} />
        <Rings isMobile={isMobile} reducedMotion={reducedMotion} />
        <Particles key={isMobile ? 'mobile' : 'desktop'} count={isMobile ? 400 : 1500} reducedMotion={reducedMotion} />
      </group>

      <group ref={gridGroupRef} position={[0, -2.2, 0]}>
        <Grid 
          infiniteGrid 
          cellColor="#A67C52" 
          sectionColor="#D9B382" 
          fadeDistance={18} 
        />
      </group>

      <EffectComposer multisampling={4}>
        <Bloom 
          intensity={isHovered || warpPhase > 0 ? 1.2 : 0.9} 
          luminanceThreshold={0.35} 
          mipmapBlur 
        />
        {!isMobile && <ChromaticAberration offset={[0.0008, 0.0008] as any} radialModulation={false} modulationOffset={0} />}
        <Vignette eskil={false} offset={0.3} darkness={0.85} />
      </EffectComposer>
    </>
  );
}
