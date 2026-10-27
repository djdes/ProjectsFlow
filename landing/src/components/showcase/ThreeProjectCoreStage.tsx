import React, { useMemo, useRef, useEffect, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { RoundedBox, Float, ContactShadows } from '@react-three/drei';
import * as THREE from 'three';
import type { PillarConfig, TariffOption } from '@/data/showcaseData';

interface CoreMeshProps {
  pillar: PillarConfig;
  tariff: TariffOption;
  spinTrigger: number;
  mode: 'monolith' | 'stack';
}

function createCoreFaceTexture(
  pillar: PillarConfig,
  tariff: TariffOption,
  mode: 'monolith' | 'stack',
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1360;
  const ctx = canvas.getContext('2d')!;

  // 1. Многослойный градиент поверхности 3D-монолита
  const grad = ctx.createLinearGradient(0, 0, 1024, 1360);
  grad.addColorStop(0, pillar.cardColorPrimary);
  grad.addColorStop(0.55, pillar.cardColorSecondary);
  grad.addColorStop(1, '#0b0716');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 1024, 1360);

  // 2. Световой блик в левом верхнем углу
  const glow = ctx.createRadialGradient(220, 220, 20, 220, 220, 620);
  glow.addColorStop(0, 'rgba(255,255,255,0.42)');
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 1024, 1360);

  // 3. Декоративные орбитальные кольца на фоне карты
  ctx.strokeStyle = 'rgba(255,255,255,0.13)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(830, 250, 280, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(830, 250, 400, 0, Math.PI * 2);
  ctx.stroke();

  // 4. Внутренняя стеклянная рамка
  ctx.strokeStyle = 'rgba(255,255,255,0.34)';
  ctx.lineWidth = 6;
  ctx.strokeRect(44, 44, 936, 1272);

  // 5. Верхний чип режима ProjectsFlow
  ctx.fillStyle = 'rgba(0,0,0,0.38)';
  ctx.beginPath();
  ctx.roundRect(84, 92, 540, 74, 37);
  ctx.fill();

  ctx.fillStyle = '#ffffff';
  ctx.font = '700 28px "Golos Text Variable", system-ui, sans-serif';
  ctx.fillText(pillar.cardTelemetry.topChip, 120, 139);

  // 6. Центральная геометрическая эмблема ProjectsFlow (3D-узел / молния потока)
  ctx.save();
  ctx.translate(512, 435);
  ctx.shadowColor = 'rgba(0,0,0,0.48)';
  ctx.shadowBlur = 34;

  // Внешний шестигранный контур ядра
  ctx.strokeStyle = 'rgba(255,255,255,0.92)';
  ctx.lineWidth = 12;
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 6;
    const rx = Math.cos(angle) * 118;
    const ry = Math.sin(angle) * 118;
    if (i === 0) ctx.moveTo(rx, ry);
    else ctx.lineTo(rx, ry);
  }
  ctx.closePath();
  ctx.stroke();

  // Внутренняя искра / стрела автопилота
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(16, -78);
  ctx.lineTo(-54, 12);
  ctx.lineTo(4, 12);
  ctx.lineTo(-16, 78);
  ctx.lineTo(54, -12);
  ctx.lineTo(-4, -12);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  // 7. Главный дисплейный заголовок на 3D-карте
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.font = '900 108px "Unbounded Variable", system-ui, sans-serif';
  const mainTitle =
    mode === 'stack' ? pillar.cardTelemetry.centerHeadline : tariff.label.split('·')[0]!.trim().toUpperCase();
  ctx.fillText(mainTitle, 512, 745);

  ctx.fillStyle = pillar.cardAccentHex;
  ctx.font = '700 31px "Golos Text Variable", system-ui, sans-serif';
  ctx.fillText(
    mode === 'stack' ? pillar.cardTelemetry.centerSub : tariff.badge,
    512,
    815,
  );

  // 8. Мини-шкала живого прогресса задачи на карте
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.beginPath();
  ctx.roundRect(140, 885, 744, 128, 28);
  ctx.fill();

  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(255,255,255,0.88)';
  ctx.font = '700 26px "Golos Text Variable", system-ui, sans-serif';
  ctx.fillText(pillar.satellite1.title, 180, 938);

  ctx.textAlign = 'right';
  ctx.fillStyle = pillar.cardAccentHex;
  ctx.fillText(pillar.satellite1.sub, 844, 938);

  // Полоса прогресса 84%
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.beginPath();
  ctx.roundRect(180, 962, 664, 20, 10);
  ctx.fill();

  ctx.fillStyle = pillar.cardAccentHex;
  ctx.beginPath();
  ctx.roundRect(180, 962, 560, 20, 10);
  ctx.fill();

  // 9. Нижняя капсула с кодом телеметрии и ценой тарифа в рублях
  ctx.fillStyle = 'rgba(10, 8, 20, 0.66)';
  ctx.beginPath();
  ctx.roundRect(84, 1090, 856, 138, 34);
  ctx.fill();

  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(255,255,255,0.78)';
  ctx.font = '600 27px "JetBrains Mono Variable", monospace';
  ctx.fillText(pillar.cardTelemetry.footerCode, 126, 1170);

  // Белая плашка цены справа
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.roundRect(646, 1114, 264, 90, 24);
  ctx.fill();

  ctx.textAlign = 'center';
  ctx.fillStyle = '#12081c';
  ctx.font = '900 38px "Unbounded Variable", system-ui, sans-serif';
  const priceText = tariff.priceRub === 0 ? '0 ₽ СТАРТ' : `${tariff.priceRub.toLocaleString('ru-RU')} ₽`;
  ctx.fillText(priceText, 778, 1173);

  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}

const ProjectCore3DGroup: React.FC<CoreMeshProps> = ({ pillar, tariff, spinTrigger, mode }) => {
  const groupRef = useRef<THREE.Group>(null);
  const cloudGroupRef = useRef<THREE.Group>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const outerGyroRef = useRef<THREE.Mesh>(null);
  const crystalRef = useRef<THREE.Mesh>(null);
  const targetSpinY = useRef(0);

  useEffect(() => {
    // При каждом переключении режима или тарифа делаем плавный 360-градусный разворот
    targetSpinY.current += Math.PI * 2;
  }, [spinTrigger]);

  const faceTexture = useMemo(
    () => createCoreFaceTexture(pillar, tariff, mode),
    [pillar, tariff, mode],
  );

  const primaryColor = useMemo(() => new THREE.Color(pillar.cardColorPrimary), [pillar.cardColorPrimary]);
  const accentColor = useMemo(() => new THREE.Color(pillar.cardAccentHex), [pillar.cardAccentHex]);

  useFrame((state, delta) => {
    if (!groupRef.current) return;
    const pointerX = state.pointer.x;
    const pointerY = state.pointer.y;

    const desiredY = -0.26 + pointerX * 0.38 + targetSpinY.current;
    const desiredX = 0.14 - pointerY * 0.25;
    const desiredZ = -0.22 + pointerX * 0.08;

    const lerpFactor = Math.min(1, delta * 5.5);
    groupRef.current.rotation.y = THREE.MathUtils.lerp(groupRef.current.rotation.y, desiredY, lerpFactor);
    groupRef.current.rotation.x = THREE.MathUtils.lerp(groupRef.current.rotation.x, desiredX, lerpFactor);
    groupRef.current.rotation.z = THREE.MathUtils.lerp(groupRef.current.rotation.z, desiredZ, lerpFactor);

    if (ringRef.current) {
      ringRef.current.rotation.x += delta * 0.75;
      ringRef.current.rotation.y += delta * 0.95;
    }
    if (outerGyroRef.current) {
      outerGyroRef.current.rotation.z -= delta * 0.45;
      outerGyroRef.current.rotation.x += delta * 0.3;
    }
    if (crystalRef.current) {
      crystalRef.current.rotation.y -= delta * 1.1;
      crystalRef.current.rotation.z += delta * 0.5;
    }
    if (cloudGroupRef.current) {
      cloudGroupRef.current.position.y = 1.25 + Math.sin(state.clock.elapsedTime * 2.1) * 0.12;
    }
  });

  return (
    <group ref={groupRef}>
      <Float speed={2.2} rotationIntensity={0.18} floatIntensity={0.45}>
        {/* Основной корпус 3D-монолита ProjectsFlow со скруглёнными фасками */}
        <RoundedBox args={[2.9, 3.85, 0.18]} radius={0.22} smoothness={6} castShadow receiveShadow>
          <meshPhysicalMaterial
            color={primaryColor}
            roughness={0.18}
            metalness={0.35}
            clearcoat={1}
            clearcoatRoughness={0.12}
          />
        </RoundedBox>

        {/* Лицевая глянцевая панель с динамической CanvasTexture */}
        <mesh position={[0, 0, 0.095]}>
          <planeGeometry args={[2.74, 3.68]} />
          <meshPhysicalMaterial
            map={faceTexture}
            roughness={0.14}
            metalness={0.15}
            clearcoat={1}
            clearcoatRoughness={0.08}
          />
        </mesh>

        {/* Задняя голографическая пластина (видна при 360° развороте) */}
        <mesh position={[0, 0, -0.095]} rotation={[0, Math.PI, 0]}>
          <planeGeometry args={[2.74, 3.68]} />
          <meshPhysicalMaterial
            map={faceTexture}
            roughness={0.2}
            metalness={0.3}
            clearcoat={0.9}
          />
        </mesh>

        {/* Дополнительное кинетическое кольцо вокруг монолита в режиме архитектуры */}
        {mode === 'stack' && (
          <mesh ref={outerGyroRef} position={[0, 0, 0]} rotation={[Math.PI / 3, 0.3, 0]}>
            <torusGeometry args={[2.35, 0.06, 20, 96]} />
            <meshPhysicalMaterial
              color={accentColor}
              roughness={0.12}
              metalness={0.75}
              clearcoat={1}
            />
          </mesh>
        )}

        {/* 3D-спутник 1: Стеклянное 3D-облако онлайн-подписки Claude */}
        <group ref={cloudGroupRef} position={[-1.85, 1.25, 0.65]} scale={0.42}>
          <mesh position={[0, 0, 0]}>
            <sphereGeometry args={[0.75, 32, 32]} />
            <meshPhysicalMaterial color="#ffffff" roughness={0.1} metalness={0.1} clearcoat={1} />
          </mesh>
          <mesh position={[-0.62, -0.18, 0.08]}>
            <sphereGeometry args={[0.55, 32, 32]} />
            <meshPhysicalMaterial color="#ffffff" roughness={0.1} metalness={0.1} clearcoat={1} />
          </mesh>
          <mesh position={[0.62, -0.16, 0.08]}>
            <sphereGeometry args={[0.58, 32, 32]} />
            <meshPhysicalMaterial color={accentColor} roughness={0.15} metalness={0.2} clearcoat={1} />
          </mesh>
        </group>

        {/* 3D-спутник 2: Металлический тор автопилота задач */}
        <mesh ref={ringRef} position={[1.9, -1.05, 0.7]} scale={0.48}>
          <torusGeometry args={[0.85, 0.26, 28, 64]} />
          <meshPhysicalMaterial
            color={accentColor}
            roughness={0.12}
            metalness={0.68}
            clearcoat={1}
          />
        </mesh>

        {/* 3D-спутник 3: Гранёный кристалл чистой прибыли и проверок */}
        <mesh ref={crystalRef} position={[1.65, 1.45, -0.35]} scale={0.44}>
          <octahedronGeometry args={[0.9, 0]} />
          <meshPhysicalMaterial
            color={primaryColor}
            emissive={primaryColor}
            emissiveIntensity={0.25}
            roughness={0.08}
            metalness={0.5}
            clearcoat={1}
          />
        </mesh>
      </Float>
    </group>
  );
};

interface ThreeProjectCoreStageProps {
  pillar: PillarConfig;
  tariff: TariffOption;
  spinTrigger: number;
  mode: 'monolith' | 'stack';
}

export const ThreeProjectCoreStage: React.FC<ThreeProjectCoreStageProps> = ({
  pillar,
  tariff,
  spinTrigger,
  mode,
}) => {
  const [webglSupported, setWebglSupported] = useState<boolean>(true);

  useEffect(() => {
    try {
      const testCanvas = document.createElement('canvas');
      const gl = testCanvas.getContext('webgl2') || testCanvas.getContext('webgl');
      if (!gl) setWebglSupported(false);
    } catch {
      setWebglSupported(false);
    }
  }, []);

  if (!webglSupported) {
    return (
      <div className="relative w-full h-[440px] sm:h-[500px] flex items-center justify-center z-10">
        <div
          className="w-[260px] h-[350px] rounded-[28px] p-6 border-2 border-white/35 shadow-2xl flex flex-col justify-between text-white"
          style={{
            background: `linear-gradient(145deg, ${pillar.cardColorPrimary}, ${pillar.cardColorSecondary})`,
          }}
        >
          <span className="text-xs font-bold tracking-wider uppercase px-3 py-1 rounded-full bg-black/35 self-start">
            {pillar.cardTelemetry.topChip}
          </span>
          <div className="text-center my-auto">
            <div className="font-display font-black text-3xl">{pillar.cardTelemetry.centerHeadline}</div>
            <div className="text-xs mt-1 opacity-85">{pillar.cardTelemetry.centerSub}</div>
          </div>
          <div className="flex items-center justify-between px-3 py-2 rounded-2xl bg-black/45 text-xs font-mono">
            <span>{pillar.cardTelemetry.footerCode}</span>
            <strong className="px-2.5 py-1 rounded-lg bg-white text-black font-display">
              {tariff.priceRub} ₽
            </strong>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-[440px] sm:h-[500px] flex items-center justify-center z-10">
      <Canvas
        camera={{ position: [0, 0, 6.2], fov: 42 }}
        dpr={[1, 2]}
        gl={{ alpha: true, antialias: true, powerPreference: 'high-performance' }}
      >
        <ambientLight intensity={1.35} />
        <directionalLight position={[4, 6, 5]} intensity={2.4} color="#ffffff" />
        <pointLight position={[-4, -2, 4]} intensity={2.1} color={pillar.cardAccentHex} />
        <pointLight position={[3, -3, 2]} intensity={1.6} color={pillar.cardColorPrimary} />

        <ProjectCore3DGroup
          pillar={pillar}
          tariff={tariff}
          spinTrigger={spinTrigger}
          mode={mode}
        />

        <ContactShadows
          position={[0, -2.35, 0]}
          opacity={0.55}
          scale={7.5}
          blur={2.4}
          far={4}
        />
      </Canvas>
    </div>
  );
};
