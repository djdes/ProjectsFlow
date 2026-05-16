import { Suspense, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Float, MeshDistortMaterial, Sparkles } from '@react-three/drei';
import type { Mesh } from 'three';

function Blob(): React.ReactElement {
  const meshRef = useRef<Mesh>(null);

  useFrame((state) => {
    if (!meshRef.current) return;
    meshRef.current.rotation.y = state.clock.elapsedTime * 0.12;
    meshRef.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.15) * 0.2;
  });

  return (
    <Float speed={1.4} rotationIntensity={0.4} floatIntensity={0.6}>
      <mesh ref={meshRef} scale={1.6}>
        <icosahedronGeometry args={[1, 64]} />
        <MeshDistortMaterial
          color="#3b82f6"
          attach="material"
          distort={0.42}
          speed={1.6}
          roughness={0.18}
          metalness={0.85}
          emissive="#1e3a8a"
          emissiveIntensity={0.55}
        />
      </mesh>
    </Float>
  );
}

function InnerCore(): React.ReactElement {
  const meshRef = useRef<Mesh>(null);

  useFrame((state) => {
    if (!meshRef.current) return;
    meshRef.current.rotation.y = -state.clock.elapsedTime * 0.25;
    meshRef.current.rotation.z = state.clock.elapsedTime * 0.1;
  });

  return (
    <mesh ref={meshRef} scale={0.55}>
      <icosahedronGeometry args={[1, 1]} />
      <meshStandardMaterial
        color="#60a5fa"
        wireframe
        emissive="#3b82f6"
        emissiveIntensity={0.6}
      />
    </mesh>
  );
}

export default function HeroScene(): React.ReactElement {
  return (
    <Canvas
      dpr={[1, 2]}
      camera={{ position: [0, 0, 5], fov: 45 }}
      gl={{ antialias: true, alpha: true }}
      style={{ background: 'transparent' }}
    >
      <ambientLight intensity={0.35} />
      <directionalLight position={[5, 5, 5]} intensity={1.2} color="#a5b4fc" />
      <pointLight position={[-3, -2, 2]} intensity={1.6} color="#3b82f6" />
      <pointLight position={[3, 4, -2]} intensity={0.9} color="#60a5fa" />

      <Suspense fallback={null}>
        <Blob />
        <InnerCore />
        <Sparkles count={60} scale={[10, 6, 6]} size={3} speed={0.35} color="#93c5fd" opacity={0.7} />
      </Suspense>
    </Canvas>
  );
}
