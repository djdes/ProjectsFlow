import React, { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { ContactShadows, Environment, Float, RoundedBox } from '@react-three/drei';
import * as THREE from 'three';
import {
  STACK_LAYERS,
  type ChassisMode,
  type StackLayerId,
  type StackLayerSpec,
  type TariffOption,
} from '../../data/showcaseData';

function fitCanvasText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  initialSize: number,
  fontWeight: string,
  fontFamily: string
): string {
  let size = initialSize;
  ctx.font = `${fontWeight} ${size}px ${fontFamily}`;
  while (ctx.measureText(text).width > maxWidth && size > 16) {
    size -= 3;
    ctx.font = `${fontWeight} ${size}px ${fontFamily}`;
  }
  return ctx.font;
}

/**
 * Generates a high-DPI 1024x768 procedural circuit/telemetry texture for each horizontal 3D slab
 * in the Exploded 4-Layer Architecture Stack (inspired by Pinterest pin-04.jpg & pin-02.jpg).
 */
function createHorizontalSlabTexture(
  layer: StackLayerSpec,
  isFocused: boolean,
  tariff: TariffOption
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 768;
  const ctx = canvas.getContext('2d')!;

  // 1. Deep obsidian/titanium surface gradient
  const grad = ctx.createLinearGradient(0, 0, 1024, 768);
  if (isFocused) {
    grad.addColorStop(0, '#121826');
    grad.addColorStop(0.55, layer.secondaryColor);
    grad.addColorStop(1, '#070a12');
  } else {
    grad.addColorStop(0, '#0f1420');
    grad.addColorStop(0.6, '#0a0e17');
    grad.addColorStop(1, '#06080e');
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1024, 768);

  // 2. Isometric circuit grid pattern across slab surface
  ctx.strokeStyle = isFocused ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 2;
  const step = 64;
  for (let x = step; x < 1024; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 768);
    ctx.stroke();
  }
  for (let y = step; y < 768; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(1024, y);
    ctx.stroke();
  }

  // 3. Radial glow spotlight on active slab
  const glow = ctx.createRadialGradient(512, 360, 20, 512, 360, 480);
  glow.addColorStop(0, isFocused ? `${layer.primaryColor}66` : `${layer.primaryColor}22`);
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 1024, 768);

  // 4. Outer precision titanium frame
  ctx.strokeStyle = isFocused ? layer.primaryColor : 'rgba(255,255,255,0.22)';
  ctx.lineWidth = isFocused ? 8 : 4;
  ctx.beginPath();
  ctx.roundRect(32, 32, 960, 704, 36);
  ctx.stroke();

  // 5. Top bar: Layer index badge + technical spec label
  ctx.fillStyle = isFocused ? layer.primaryColor : 'rgba(255,255,255,0.14)';
  ctx.beginPath();
  ctx.roundRect(68, 66, 150, 64, 18);
  ctx.fill();

  ctx.textAlign = 'center';
  ctx.fillStyle = isFocused ? '#06080e' : '#ffffff';
  ctx.font = '900 32px "Unbounded", system-ui, sans-serif';
  ctx.fillText(`0${layer.index + 1}`, 143, 110);

  ctx.textAlign = 'left';
  ctx.fillStyle = isFocused ? '#ffffff' : 'rgba(255,255,255,0.7)';
  fitCanvasText(ctx, layer.SlabSpec.topLabel, 680, 26, '700', 'monospace');
  ctx.fillText(layer.SlabSpec.topLabel, 244, 107);

  // 6. Visual nodes / circuit traces specific to each layer
  ctx.save();
  ctx.strokeStyle = layer.accentColor;
  ctx.lineWidth = 3;
  for (let i = 0; i < 4; i++) {
    const nx = 140 + i * 240;
    const ny = 210;
    ctx.fillStyle = isFocused ? layer.accentColor : 'rgba(255,255,255,0.25)';
    ctx.beginPath();
    ctx.arc(nx, ny, 8, 0, Math.PI * 2);
    ctx.fill();
    if (i < 3) {
      ctx.beginPath();
      ctx.moveTo(nx + 12, ny);
      ctx.lineTo(nx + 228, ny);
      ctx.stroke();
    }
  }
  ctx.restore();

  // 7. Giant center metric & layer name
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  fitCanvasText(ctx, layer.SlabSpec.centerMetric, 840, 108, '900', '"Unbounded", system-ui, sans-serif');
  ctx.fillText(layer.SlabSpec.centerMetric, 512, 390);

  ctx.fillStyle = isFocused ? layer.accentColor : layer.primaryColor;
  fitCanvasText(ctx, layer.SlabSpec.subMetric, 840, 32, '800', 'system-ui, sans-serif');
  ctx.fillText(layer.SlabSpec.subMetric, 512, 456);

  // 8. Bottom telemetry dock with tariff & status
  ctx.fillStyle = 'rgba(5, 8, 15, 0.82)';
  ctx.beginPath();
  ctx.roundRect(68, 560, 888, 126, 26);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(255,255,255,0.82)';
  fitCanvasText(ctx, layer.SlabSpec.statusCode, 540, 25, '700', 'monospace');
  ctx.fillText(layer.SlabSpec.statusCode, 104, 632);

  // Right price/tariff badge on slab
  ctx.fillStyle = isFocused ? layer.primaryColor : '#ffffff';
  ctx.beginPath();
  ctx.roundRect(670, 582, 256, 82, 20);
  ctx.fill();

  ctx.textAlign = 'center';
  ctx.fillStyle = '#06080f';
  fitCanvasText(
    ctx,
    `${tariff.name.toUpperCase()} · ${tariff.priceFormatted}`,
    230,
    26,
    '900',
    '"Unbounded", system-ui, sans-serif'
  );
  ctx.fillText(`${tariff.name.toUpperCase()} · ${tariff.priceFormatted}`, 798, 632);

  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}

interface ExplodedStackMeshProps {
  activeLayerId: StackLayerId;
  tariff: TariffOption;
  spinTrigger: number;
  chassisMode: ChassisMode;
  onSelectLayer?: (id: StackLayerId) => void;
}

const ExplodedStackMesh: React.FC<ExplodedStackMeshProps> = ({
  activeLayerId,
  tariff,
  spinTrigger,
  chassisMode,
  onSelectLayer,
}) => {
  const rootGroupRef = useRef<THREE.Group>(null);
  const slabRefs = useRef<(THREE.Group | null)[]>([]);
  const outerGyroRef = useRef<THREE.Mesh>(null);
  const innerGyroRef = useRef<THREE.Mesh>(null);
  const beamGroupRef = useRef<THREE.Group>(null);
  const targetSpinY = useRef(0);

  // Ordered bottom (index 0) to top (index 3)
  const orderedLayers = useMemo(
    () => [...STACK_LAYERS].sort((a, b) => a.index - b.index),
    []
  );

  const activeSpec = useMemo(
    () => STACK_LAYERS.find((l) => l.id === activeLayerId) ?? STACK_LAYERS[0]!,
    [activeLayerId]
  );

  const textures = useMemo(() => {
    return orderedLayers.map((layer) =>
      createHorizontalSlabTexture(layer, layer.id === activeLayerId, tariff)
    );
  }, [orderedLayers, activeLayerId, tariff]);

  useEffect(() => {
    return () => {
      textures.forEach((t) => t.dispose());
    };
  }, [textures]);

  useEffect(() => {
    if (spinTrigger > 0) {
      targetSpinY.current += Math.PI * 2;
    }
  }, [spinTrigger]);

  useFrame((state, delta) => {
    const speed = Math.min(1, delta * 6.0);

    // 1. Isometric base angle + pointer parallax + celebratory spin
    if (rootGroupRef.current) {
      const baseIsoY = -0.52;
      const baseIsoX = 0.42;
      const desiredY = baseIsoY + state.pointer.x * 0.35 + targetSpinY.current;
      const desiredX = baseIsoX - state.pointer.y * 0.22;
      const desiredZ = state.pointer.x * 0.06;

      rootGroupRef.current.rotation.y = THREE.MathUtils.lerp(
        rootGroupRef.current.rotation.y,
        desiredY,
        speed
      );
      rootGroupRef.current.rotation.x = THREE.MathUtils.lerp(
        rootGroupRef.current.rotation.x,
        desiredX,
        speed
      );
      rootGroupRef.current.rotation.z = THREE.MathUtils.lerp(
        rootGroupRef.current.rotation.z,
        desiredZ,
        speed
      );
    }

    // 2. Individual slab Y-expansion and focus Z-slide
    const spacing = chassisMode === 'compact' ? 0.38 : 0.88;
    orderedLayers.forEach((layer, i) => {
      const slab = slabRefs.current[i];
      if (!slab) return;
      const isFocused = layer.id === activeLayerId;
      const baseY = (i - 1.5) * spacing;
      const targetY = baseY + (isFocused && chassisMode !== 'compact' ? 0.14 : 0);
      const targetZ = isFocused ? 0.34 : 0;
      const targetScale = isFocused ? 1.05 : 0.96;

      slab.position.y = THREE.MathUtils.lerp(slab.position.y, targetY, speed);
      slab.position.z = THREE.MathUtils.lerp(slab.position.z, targetZ, speed);
      slab.scale.setScalar(THREE.MathUtils.lerp(slab.scale.x, targetScale, speed));
    });

    // 3. Gyroscope rings rotation
    if (outerGyroRef.current) {
      outerGyroRef.current.rotation.z += delta * 0.55;
      outerGyroRef.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.7) * 0.35;
    }
    if (innerGyroRef.current) {
      innerGyroRef.current.rotation.y -= delta * 0.8;
      innerGyroRef.current.rotation.z = Math.cos(state.clock.elapsedTime * 0.6) * 0.3;
    }

    // 4. Pulse energy beams
    if (beamGroupRef.current) {
      beamGroupRef.current.rotation.y = Math.sin(state.clock.elapsedTime * 0.5) * 0.05;
    }
  });

  const cornerPositions: [number, number][] = [
    [-1.42, -0.95],
    [1.42, -0.95],
    [-1.42, 0.95],
    [1.42, 0.95],
  ];

  return (
    <Float speed={1.8} rotationIntensity={0.08} floatIntensity={0.32}>
      <group ref={rootGroupRef}>
        {/* 4 Horizontal Architectural Slabs (L1 Bottom -> L4 Top) */}
        {orderedLayers.map((layer, idx) => {
          const isFocused = layer.id === activeLayerId;
          const tex = textures[idx]!;
          return (
            <group
              key={layer.id}
              ref={(el) => {
                slabRefs.current[idx] = el;
              }}
              onClick={(e) => {
                e.stopPropagation();
                onSelectLayer?.(layer.id);
              }}
            >
              {/* Main Beveled Titanium/Glass Plate */}
              <RoundedBox args={[3.35, 0.22, 2.45]} radius={0.07} smoothness={4}>
                <meshPhysicalMaterial
                  color={isFocused ? '#1e293b' : '#0f172a'}
                  emissive={layer.primaryColor}
                  emissiveIntensity={isFocused ? 0.22 : 0.04}
                  roughness={0.18}
                  metalness={0.62}
                  clearcoat={1}
                  clearcoatRoughness={0.12}
                />
              </RoundedBox>

              {/* Top High-DPI Circuit & Telemetry Face */}
              <mesh position={[0, 0.115, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                <planeGeometry args={[3.18, 2.3]} />
                <meshPhysicalMaterial
                  map={tex}
                  roughness={0.14}
                  metalness={0.15}
                  clearcoat={1}
                  clearcoatRoughness={0.08}
                />
              </mesh>

              {/* Glowing Edge Trim Rim */}
              <mesh position={[0, 0, 1.23]}>
                <boxGeometry args={[2.8, 0.06, 0.03]} />
                <meshBasicMaterial color={isFocused ? layer.accentColor : layer.primaryColor} />
              </mesh>
            </group>
          );
        })}

        {/* Vertical Laser Filaments Connecting All 4 Layers (pin-04.jpg inspiration) */}
        {chassisMode !== 'compact' && (
          <group ref={beamGroupRef}>
            {cornerPositions.map(([cx, cz], idx) => (
              <mesh key={idx} position={[cx, 0, cz]}>
                <cylinderGeometry args={[0.018, 0.018, 2.85, 12]} />
                <meshBasicMaterial
                  color={activeSpec.primaryColor}
                  transparent
                  opacity={0.55}
                />
              </mesh>
            ))}

            {/* Central Core Energy Conduit */}
            <mesh position={[0, 0, 0]}>
              <cylinderGeometry args={[0.14, 0.14, 2.9, 24]} />
              <meshPhysicalMaterial
                color={activeSpec.accentColor}
                emissive={activeSpec.primaryColor}
                emissiveIntensity={0.6}
                transparent
                opacity={0.32}
                roughness={0.1}
                clearcoat={1}
              />
            </mesh>
          </group>
        )}

        {/* Optional Kinetic Gyroscope Rings (when chassisMode === 'gyro') */}
        {chassisMode === 'gyro' && (
          <group>
            <mesh ref={outerGyroRef}>
              <torusGeometry args={[2.55, 0.045, 20, 100]} />
              <meshPhysicalMaterial
                color={activeSpec.primaryColor}
                emissive={activeSpec.primaryColor}
                emissiveIntensity={0.35}
                metalness={0.8}
                roughness={0.15}
                clearcoat={1}
              />
            </mesh>
            <mesh ref={innerGyroRef} rotation={[Math.PI / 3, 0, 0]}>
              <torusGeometry args={[2.2, 0.035, 20, 90]} />
              <meshPhysicalMaterial
                color={activeSpec.accentColor}
                emissive={activeSpec.accentColor}
                emissiveIntensity={0.28}
                metalness={0.75}
                roughness={0.18}
                clearcoat={1}
              />
            </mesh>
          </group>
        )}

        {/* 4 Isometric Floating Data Nodes around the Stack (pin-01.jpg & pin-03.jpg inspiration) */}
        <Float speed={2.6} rotationIntensity={0.9} floatIntensity={0.75}>
          <RoundedBox position={[-2.25, 1.05, 0.4]} args={[0.38, 0.38, 0.38]} radius={0.07} smoothness={3}>
            <meshPhysicalMaterial
              color={activeSpec.primaryColor}
              emissive={activeSpec.primaryColor}
              emissiveIntensity={0.4}
              metalness={0.5}
              roughness={0.15}
              clearcoat={1}
            />
          </RoundedBox>
        </Float>

        <Float speed={2.2} rotationIntensity={1.1} floatIntensity={0.85}>
          <mesh position={[2.25, 0.75, -0.35]}>
            <octahedronGeometry args={[0.28, 0]} />
            <meshPhysicalMaterial
              color={activeSpec.accentColor}
              emissive={activeSpec.accentColor}
              emissiveIntensity={0.45}
              metalness={0.65}
              roughness={0.12}
              clearcoat={1}
            />
          </mesh>
        </Float>

        <Float speed={2.4} rotationIntensity={0.7} floatIntensity={0.65}>
          <RoundedBox position={[2.1, -0.95, 0.65]} args={[0.34, 0.34, 0.34]} radius={0.06} smoothness={3}>
            <meshPhysicalMaterial
              color="#ffffff"
              emissive={activeSpec.primaryColor}
              emissiveIntensity={0.25}
              metalness={0.35}
              roughness={0.1}
              clearcoat={1}
            />
          </RoundedBox>
        </Float>
      </group>
    </Float>
  );
};

export interface ThreeProjectCoreStageProps {
  activeLayerId: StackLayerId;
  tariff: TariffOption;
  spinTrigger: number;
  chassisMode?: ChassisMode;
  onSelectLayer?: (id: StackLayerId) => void;
}

export const ThreeProjectCoreStage: React.FC<ThreeProjectCoreStageProps> = ({
  activeLayerId,
  tariff,
  spinTrigger,
  chassisMode = 'exploded',
  onSelectLayer,
}) => {
  const activeSpec =
    STACK_LAYERS.find((l) => l.id === activeLayerId) ?? STACK_LAYERS[0]!;

  return (
    <div className="w-full h-full relative cursor-grab active:cursor-grabbing">
      <Canvas
        dpr={[1, 1.75]}
        camera={{ position: [0, 0.65, 6.6], fov: 37 }}
        gl={{ alpha: true, antialias: true, powerPreference: 'high-performance' }}
      >
        <ambientLight intensity={0.95} />
        <directionalLight position={[5, 8, 6]} intensity={2.2} color="#ffffff" />
        <directionalLight
          position={[-5, 3, -4]}
          intensity={1.4}
          color={activeSpec.primaryColor}
        />
        <pointLight
          position={[0, 0, 3.5]}
          intensity={1.5}
          color={activeSpec.accentColor}
        />

        <Environment preset="city" />

        <ExplodedStackMesh
          activeLayerId={activeLayerId}
          tariff={tariff}
          spinTrigger={spinTrigger}
          chassisMode={chassisMode}
          onSelectLayer={onSelectLayer}
        />

        <ContactShadows
          position={[0, -2.05, 0]}
          opacity={0.5}
          scale={8.5}
          blur={2.4}
          far={4.8}
          color="#02040a"
        />
      </Canvas>
    </div>
  );
};
