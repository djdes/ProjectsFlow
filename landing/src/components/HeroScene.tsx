import { Suspense, useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { AdaptiveDpr, AdaptiveEvents, Sparkles, Text } from '@react-three/drei';
import { Bloom, EffectComposer } from '@react-three/postprocessing';
import { BlendFunction, Effect } from 'postprocessing';
import {
  AdditiveBlending,
  Color,
  DoubleSide,
  FogExp2,
  Object3D,
  Uniform,
  Vector2,
  Vector3,
  type BufferGeometry,
  type Group,
  type InstancedMesh,
  type Material,
  type Mesh,
  type Points,
} from 'three';

// ============================================================
// HeroScene v6: galactic data tower. Каждый tier — уникальный визуальный паттерн,
// bezel'ы переливаются между тёмным navy и ярким cyan в волне снизу вверх,
// вокруг — multi-layer cosmic dust с разными скоростями параллакса.
// ============================================================

// Палитра под референс: насыщенный electric-cyan (pure 100% sat), без soft-tailwind sky-оттенков.
// CYAN_EDGE — основной structural glow, MID — bright accent, HOT — почти белый с cyan-tinge.
const CYAN_EDGE = '#00b8ff';      // electric cyan, основной structural цвет
const CYAN_MID = '#22e0ff';       // ярче, для активных колец
const CYAN_LIGHT = '#5eeaff';     // светлее, для подсветок
const CYAN_HOT = '#b6f5ff';       // самый яркий — почти белый, с cyan-намёком
const CYAN_DEEP = '#003a66';      // глубокий навигационный синий для подложек
const NAVY_DEEP = '#001340';      // deep navy для nebula
const CORE_WHITE = '#ffffff';     // pure white — core beam должен быть просто белым, bloom раскрасит
const BG = '#000308';             // почти чёрный с тончайшим cool-tinge

// ----- Seeded RNG --------------------------------------------------------
function mulberry32(seed: number): () => number {
  let s = seed;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Стилевой variant tier'а — определяет паттерн colors/rings/spokes/chips.
type TierStyle = 'dense' | 'sparse' | 'asymmetric';

type Tier = {
  readonly y: number;
  readonly radius: number;
  readonly segments: number;     // 6 hex / 8 oct / 10 deca / 64 круг
  readonly label: string;
  readonly style: TierStyle;
  readonly seed: number;
  readonly phase: number;        // 0..1 фазовый сдвиг для color-wave
  readonly surroundCount: number; // ядер в окружающем кольце
  readonly surroundOffset: number; // зазор от bezel до кольца ядер
  readonly surroundY: number;     // вертикальный сдвиг кольца (выше/ниже tier'а)
};

// Разнообразие форм: octagon, decagon, круг разных размеров. Surround-rings — ядра
// которые "не касаются" слоя (offset 0.2-0.35), на разной высоте от плоскости.
const TIERS: readonly Tier[] = [
  { y: -1.95, radius: 1.5,  segments: 8,  label: 'IDEAS',   style: 'dense',      seed: 23, phase: 0.0,  surroundCount: 24, surroundOffset: 0.28, surroundY: 0.18 },
  { y: -0.9,  radius: 1.95, segments: 64, label: 'BUILD',   style: 'asymmetric', seed: 37, phase: 0.18, surroundCount: 32, surroundOffset: 0.32, surroundY: 0.05 },
  { y: 0.25,  radius: 1.45, segments: 10, label: 'LAUNCH',  style: 'sparse',     seed: 51, phase: 0.36, surroundCount: 22, surroundOffset: 0.25, surroundY: -0.12 },
  { y: 1.35,  radius: 1.05, segments: 64, label: 'GROWTH',  style: 'dense',      seed: 67, phase: 0.55, surroundCount: 18, surroundOffset: 0.3,  surroundY: 0.15 },
  { y: 2.3,   radius: 0.6,  segments: 6,  label: 'PRODUCT', style: 'sparse',     seed: 79, phase: 0.75, surroundCount: 14, surroundOffset: 0.28, surroundY: 0.0  },
];

// (scatter dots, satellites и линии между ними удалены — выглядели визуально шумно)

// ----- Neon HUD-plaques: летающие подписи вокруг башни -------------------
type Plaque = {
  readonly text: string;
  readonly anchorTier: number;    // индекс tier'а к которому прикрепляется (для tether)
  readonly angle: number;         // угловая позиция вокруг tower (radians)
  readonly distance: number;      // дистанция от центра
  readonly yOffset: number;       // вертикальное смещение от anchorTier.y
  readonly flickers: boolean;     // мерцает ли (~30% плашек активные)
};

const PLAQUES: readonly Plaque[] = [
  { text: 'IDEAS',    anchorTier: 0, angle: -Math.PI * 0.25, distance: 3.0, yOffset: 0.05,  flickers: true  },
  { text: 'FLOW',     anchorTier: 0, angle: Math.PI * 0.6,   distance: 2.8, yOffset: -0.1,  flickers: false },
  { text: 'FOCUS',    anchorTier: 1, angle: -Math.PI * 0.8,  distance: 3.3, yOffset: 0.2,   flickers: true  },
  { text: 'BUILD',    anchorTier: 1, angle: Math.PI * 0.15,  distance: 3.4, yOffset: -0.05, flickers: false },
  { text: 'SHIP',     anchorTier: 2, angle: Math.PI * 0.85,  distance: 2.7, yOffset: 0.15,  flickers: true  },
  { text: 'GROWTH',   anchorTier: 2, angle: -Math.PI * 0.5,  distance: 2.6, yOffset: -0.15, flickers: false },
  { text: 'SPARK',    anchorTier: 3, angle: Math.PI * 0.4,   distance: 2.3, yOffset: 0.1,   flickers: true  },
  { text: 'DRIVE',    anchorTier: 4, angle: -Math.PI * 0.15, distance: 1.6, yOffset: 0.15,  flickers: false },
];

function NeonPlaques(): React.ReactElement {
  return (
    <group>
      {PLAQUES.map((p, i) => (
        <NeonPlaque key={i} plaque={p} />
      ))}
    </group>
  );
}

function NeonPlaque({ plaque }: { plaque: Plaque }): React.ReactElement {
  const anchorTier = TIERS[plaque.anchorTier]!;
  const x = Math.cos(plaque.angle) * plaque.distance;
  const z = Math.sin(plaque.angle) * plaque.distance;
  const y = anchorTier.y + plaque.yOffset;

  // Размер frame'а зависит от длины текста.
  const W = Math.max(0.7, plaque.text.length * 0.11) + 0.15;
  const H = 0.18;

  const textRef = useRef<Mesh>(null);
  const frameMatRef = useRef<Material & { opacity: number }>(null);

  // Flicker для активных плашек.
  useFrame((state) => {
    if (!plaque.flickers) return;
    const t = state.clock.elapsedTime;
    // Редкое короткое мерцание: большую часть времени горит ровно, иногда коротко затухает.
    const flicker = 0.85 + 0.15 * Math.sin(t * 1.7 + plaque.angle * 4);
    // Glitch — раз в ~5 сек короткий dip.
    const glitch = Math.sin(t * 0.6 + plaque.angle * 2) > 0.97 ? 0.4 : 1;
    if (textRef.current) {
      (textRef.current.material as { opacity: number }).opacity = flicker * glitch;
    }
    if (frameMatRef.current) {
      frameMatRef.current.opacity = flicker * glitch;
    }
  });

  return (
    <group position={[x, y, z]} rotation={[0, -plaque.angle + Math.PI / 2, 0]}>
      {/* Тёмный backplate — даёт читаемость текста на любом фоне. */}
      <mesh>
        <planeGeometry args={[W, H]} />
        <meshBasicMaterial color="#020308" transparent opacity={0.75} />
      </mesh>
      {/* Frame — тонкая cyan-обводка через 4 thin плашки по бокам. */}
      <NeonFrame width={W} height={H} matRef={frameMatRef} />
      {/* Угловые brackets — L-формы в углах, cyber-UI стиль. */}
      <CornerBrackets width={W} height={H} />
      {/* Сам текст. */}
      <Text
        ref={textRef as never}
        position={[0, 0, 0.005]}
        fontSize={0.085}
        color={CYAN_HOT}
        anchorX="center"
        anchorY="middle"
        letterSpacing={0.08}
        outlineWidth={0.001}
        outlineColor={CYAN_EDGE}
        material-toneMapped={false}
      >
        {plaque.text}
      </Text>
    </group>
  );
}

function NeonFrame({
  width: w,
  height: h,
  matRef,
}: {
  width: number;
  height: number;
  matRef: React.RefObject<(Material & { opacity: number }) | null>;
}): React.ReactElement {
  const thickness = 0.004;
  const halfW = w / 2;
  const halfH = h / 2;
  return (
    <>
      {/* Top */}
      <mesh position={[0, halfH, 0.002]}>
        <planeGeometry args={[w, thickness]} />
        <meshBasicMaterial ref={matRef as never} color={CYAN_EDGE} toneMapped={false} transparent opacity={1} />
      </mesh>
      {/* Bottom */}
      <mesh position={[0, -halfH, 0.002]}>
        <planeGeometry args={[w, thickness]} />
        <meshBasicMaterial color={CYAN_EDGE} toneMapped={false} transparent opacity={0.9} />
      </mesh>
      {/* Left */}
      <mesh position={[-halfW, 0, 0.002]}>
        <planeGeometry args={[thickness, h]} />
        <meshBasicMaterial color={CYAN_EDGE} toneMapped={false} transparent opacity={0.9} />
      </mesh>
      {/* Right */}
      <mesh position={[halfW, 0, 0.002]}>
        <planeGeometry args={[thickness, h]} />
        <meshBasicMaterial color={CYAN_EDGE} toneMapped={false} transparent opacity={0.9} />
      </mesh>
    </>
  );
}

function CornerBrackets({ width: w, height: h }: { width: number; height: number }): React.ReactElement {
  const bracketLen = 0.04;
  const thickness = 0.008;
  const halfW = w / 2;
  const halfH = h / 2;
  // 4 угла × 2 короткие палочки (горизонтальная + вертикальная) = 8 mesh'ей.
  const corners = [
    { x: -halfW, y: halfH, sx: 1, sy: -1 },   // top-left
    { x: halfW, y: halfH, sx: -1, sy: -1 },   // top-right
    { x: -halfW, y: -halfH, sx: 1, sy: 1 },   // bottom-left
    { x: halfW, y: -halfH, sx: -1, sy: 1 },   // bottom-right
  ];
  return (
    <>
      {corners.map((c, i) => (
        <group key={i} position={[c.x, c.y, 0.003]}>
          <mesh position={[(c.sx * bracketLen) / 2, 0, 0]}>
            <planeGeometry args={[bracketLen, thickness]} />
            <meshBasicMaterial color={CYAN_HOT} toneMapped={false} />
          </mesh>
          <mesh position={[0, (c.sy * bracketLen) / 2, 0]}>
            <planeGeometry args={[thickness, bracketLen]} />
            <meshBasicMaterial color={CYAN_HOT} toneMapped={false} />
          </mesh>
        </group>
      ))}
    </>
  );
}


// ----- Хелпер: hsl(navy ↔ cyan) интерполяция через t ∈ [0..1] ----------
// Целевые цвета смещены к pure cyan (195° hue, 100% sat) — как в референсе.
const NAVY_HSL = { h: 217, s: 90, l: 14 }; // глубокий navy
const CYAN_HSL = { h: 195, s: 100, l: 62 }; // pure electric cyan
function navyToCyan(t: number): string {
  const h = NAVY_HSL.h + (CYAN_HSL.h - NAVY_HSL.h) * t;
  const s = NAVY_HSL.s + (CYAN_HSL.s - NAVY_HSL.s) * t;
  const l = NAVY_HSL.l + (CYAN_HSL.l - NAVY_HSL.l) * t;
  return `hsl(${h}, ${s}%, ${l}%)`;
}
// Pre-bake палитра — color objects кэшируются и мутируются вместо аллокаций.
const PALETTE_STEPS = 60;
const PALETTE: Color[] = Array.from({ length: PALETTE_STEPS }).map(
  (_, i) => new Color(navyToCyan(i / (PALETTE_STEPS - 1))),
);

// ============================================================
// SurroundingCoresLayer — кольцо из мелких ядер вокруг каждого tier'а,
// на радиусе tier.radius + tier.surroundOffset, с лёгким вертикальным сдвигом.
// Ядра не касаются bezel'а — "плавающие" data-cores. Все ядра в одном
// instancedMesh = 1 draw call на 110+ ядер.
// ============================================================
type SurroundingCore = {
  readonly pos: Vector3;
  readonly phase: number; // для индивидуального мерцания
};

const SURROUNDING_CORES: SurroundingCore[] = (() => {
  const all: SurroundingCore[] = [];
  for (const tier of TIERS) {
    const ringRadius = tier.radius + tier.surroundOffset;
    const ringY = tier.y + tier.surroundY;
    const rng = mulberry32(tier.seed * 31);
    for (let i = 0; i < tier.surroundCount; i++) {
      // Равномерное распределение по окружности.
      const angle = (i / tier.surroundCount) * Math.PI * 2;
      all.push({
        pos: new Vector3(Math.cos(angle) * ringRadius, ringY, Math.sin(angle) * ringRadius),
        phase: rng() * Math.PI * 2,
      });
    }
  }
  return all;
})();

// Connections между surrounding cores. Структурируем как массив объектов чтоб ниже бегали pulses.
type ConstellationLink = {
  readonly from: Vector3;
  readonly to: Vector3;
  readonly speed: number;
  readonly phase: number;
};
const CONSTELLATION_LINKS: ConstellationLink[] = (() => {
  const links: ConstellationLink[] = [];
  const seen = new Set<string>();
  const MAX_DIST = 1.4;
  const rng = mulberry32(777);
  for (let i = 0; i < SURROUNDING_CORES.length; i++) {
    const a = SURROUNDING_CORES[i]!;
    const sorted = SURROUNDING_CORES
      .map((other, j) => ({ j, d: a.pos.distanceTo(other.pos) }))
      .filter((x) => x.j !== i && x.d <= MAX_DIST)
      .sort((x, y) => x.d - y.d)
      .slice(0, 2);
    for (const { j } of sorted) {
      const key = i < j ? `${i}-${j}` : `${j}-${i}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const b = SURROUNDING_CORES[j]!;
      links.push({ from: a.pos, to: b.pos, speed: 0.25 + rng() * 0.45, phase: rng() });
    }
  }
  return links;
})();

const SURROUND_CONNECTIONS_POS: Float32Array = (() => {
  const arr = new Float32Array(CONSTELLATION_LINKS.length * 6);
  for (let i = 0; i < CONSTELLATION_LINKS.length; i++) {
    const c = CONSTELLATION_LINKS[i]!;
    arr.set([c.from.x, c.from.y, c.from.z, c.to.x, c.to.y, c.to.z], i * 6);
  }
  return arr;
})();

function SurroundingConstellation(): React.ReactElement {
  return (
    <lineSegments>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[SURROUND_CONNECTIONS_POS, 3]} />
      </bufferGeometry>
      <lineBasicMaterial color={CYAN_MID} transparent opacity={0.4} toneMapped={false} />
    </lineSegments>
  );
}

// Constellation pulses: instanced sphere'ы летают вдоль связей между ядрами.
// Один draw call на все ~220 импульсов.
function ConstellationPulses(): React.ReactElement {
  const meshRef = useRef<InstancedMesh>(null);
  const dummy = useMemo(() => new Object3D(), []);
  // Throttle до 30fps — 220 matrix updates на каждый импульс. Pulses едут плавно
  // (interpolation), 30fps на глаз не отличить от 60.
  const accRef = useRef(0);

  useFrame((state, delta) => {
    if (!meshRef.current) return;
    accRef.current += delta;
    if (accRef.current < 1 / 30) return;
    accRef.current = 0;
    const t = state.clock.elapsedTime;
    for (let i = 0; i < CONSTELLATION_LINKS.length; i++) {
      const c = CONSTELLATION_LINKS[i]!;
      const u = (t * c.speed + c.phase) % 1;
      dummy.position.set(
        c.from.x + (c.to.x - c.from.x) * u,
        c.from.y + (c.to.y - c.from.y) * u,
        c.from.z + (c.to.z - c.from.z) * u,
      );
      const peak = Math.sin(u * Math.PI);
      dummy.scale.setScalar(0.4 + peak * 0.9);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined as never, undefined as never, CONSTELLATION_LINKS.length]}
    >
      {/* 8×8 → 6×6 segments: 64 → 36 tri × ~220 pulses = -6.2k tri. На размере 0.02 разница незаметна. */}
      <sphereGeometry args={[0.02, 6, 6]} />
      <meshBasicMaterial color={CYAN_HOT} toneMapped={false} />
    </instancedMesh>
  );
}

function SurroundingCoresLayer(): React.ReactElement {
  const meshRef = useRef<InstancedMesh>(null);
  const dummy = useMemo(() => new Object3D(), []);
  // Throttle до 30fps — 110 matrix updates каждый frame не критичны для плавности
  // пульсаций scale. Экономия — половина instance-обновлений.
  const accRef = useRef(0);

  useFrame((state, delta) => {
    if (!meshRef.current) return;
    accRef.current += delta;
    if (accRef.current < 1 / 30) return;
    accRef.current = 0;
    const t = state.clock.elapsedTime;
    for (let i = 0; i < SURROUNDING_CORES.length; i++) {
      const core = SURROUNDING_CORES[i]!;
      const pulse = 1 + Math.sin(t * 2.0 + core.phase) * 0.25;
      dummy.position.copy(core.pos);
      dummy.scale.setScalar(pulse);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined as never, undefined as never, SURROUNDING_CORES.length]}
    >
      {/* 10×10 → 8×8 segments: 100 → 64 треугольников на сферу × 110 сфер = -3.9k tri. */}
      <sphereGeometry args={[0.028, 8, 8]} />
      <meshBasicMaterial color={CYAN_HOT} toneMapped={false} />
    </instancedMesh>
  );
}

// ============================================================
// TickMarksInstanced — N tick'ов на bezel'е через instancedMesh, один draw call.
// ============================================================
function TickMarksInstanced({
  count,
  innerR,
  outerR,
}: {
  count: number;
  innerR: number;
  outerR: number;
}): React.ReactElement {
  const meshRef = useRef<InstancedMesh>(null);
  const len = outerR - innerR;
  const mid = (innerR + outerR) / 2;

  return (
    <instancedMesh
      ref={(m) => {
        if (!m) return;
        meshRef.current = m;
        const dummy = new Object3D();
        for (let i = 0; i < count; i++) {
          const angle = (i / count) * Math.PI * 2;
          dummy.position.set(Math.cos(angle) * mid, 0, Math.sin(angle) * mid);
          // X-axis по умолчанию (+1, 0, 0). Поворот вокруг Y на -angle совмещает его с
          // радиальным вектором (cos angle, 0, sin angle), и tick'и легли вдоль радиуса.
          dummy.rotation.set(0, -angle, 0);
          // Scale в формате box-armature: длина по X (radial), тонкий по Y (vertical) и Z.
          dummy.scale.set(len, 0.0015, 0.001);
          dummy.updateMatrix();
          m.setMatrixAt(i, dummy.matrix);
        }
        m.instanceMatrix.needsUpdate = true;
      }}
      args={[undefined as never, undefined as never, count]}
    >
      <boxGeometry args={[1, 1, 1]} />
      <meshBasicMaterial color={CYAN_EDGE} transparent opacity={0.55} toneMapped={false} />
    </instancedMesh>
  );
}

// ============================================================
// CircuitDisk — слой с уникальным паттерном по style.
// Bezel-ring анимируется через ref на свой материал.
// ============================================================
function CircuitDisk({ tier, tierIdx }: { tier: Tier; tierIdx: number }): React.ReactElement {
  const bezelMatRef = useRef<Material & { color: Color }>(null);
  const innerMatRefs = useRef<Array<(Material & { color: Color }) | null>>([]);
  // Polygonal tier'ы (6/8/10 граней) рисуем bezel'ом нужным количеством сегментов.
  // 64-сегментные — плавный круг (рендерим как 96-сегментное кольцо для гладкости).
  const ringSegments = tier.segments < 16 ? tier.segments : 96;

  // Параметры по стилю:
  const params = useMemo(() => {
    switch (tier.style) {
      case 'dense':
        return { ringCount: 5, spokeCount: 12, chipCount: 5, tickCount: 36 };
      case 'sparse':
        return { ringCount: 3, spokeCount: 6, chipCount: 2, tickCount: 18 };
      case 'asymmetric':
        return { ringCount: 4, spokeCount: 8, chipCount: 6, tickCount: 28 };
    }
  }, [tier.style]);

  const ringRadii = useMemo(
    () =>
      Array.from({ length: params.ringCount }).map(
        (_, i) =>
          tier.radius *
          (0.22 + (i / Math.max(1, params.ringCount - 1)) * 0.76),
      ),
    [tier.radius, params.ringCount],
  );

  const spokeAngles = useMemo(() => {
    const rng = mulberry32(tier.seed * 17);
    return Array.from({ length: params.spokeCount }).map((_, i) => {
      const base = (i / params.spokeCount) * Math.PI * 2;
      // asymmetric — pulls spokes к одной стороне.
      if (tier.style === 'asymmetric') {
        return base + (rng() - 0.5) * 0.4;
      }
      return base;
    });
  }, [tier.seed, tier.style, params.spokeCount]);

  const chipPositions = useMemo(() => {
    const rng = mulberry32(tier.seed * 5);
    return Array.from({ length: params.chipCount }).map(() => {
      if (tier.style === 'asymmetric') {
        // 70% чипов в одной половине окружности.
        return rng() < 0.7 ? rng() * Math.PI : Math.PI + rng() * Math.PI;
      }
      return rng() * Math.PI * 2;
    });
  }, [tier.seed, tier.style, params.chipCount]);

  // Color wave: каждый кадр сдвигаем индекс палитры по времени + tier.phase.
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    // Полный цикл волны ≈ 6 сек. Wave идёт снизу вверх (tier.phase нарастает у верхних).
    const wave = 0.5 + 0.5 * Math.sin(t * 1.05 - tier.phase * Math.PI * 2);
    const idx = Math.min(PALETTE_STEPS - 1, Math.floor(wave * (PALETTE_STEPS - 1)));
    const c = PALETTE[idx]!;
    if (bezelMatRef.current) bezelMatRef.current.color.copy(c);
    // Inner rings — тот же color но чуть тусклее (сами материалы opacity делают).
    for (const mat of innerMatRefs.current) {
      if (mat) mat.color.copy(c);
    }
  });

  return (
    <group position={[0, tier.y, 0]}>
      {/* Тонкая подложка-диск (силуэт). Принимает форму tier'а (hex/oct/deca/circle). */}
      <mesh>
        <cylinderGeometry args={[tier.radius * 0.98, tier.radius * 0.98, 0.008, tier.segments]} />
        <meshBasicMaterial color={CYAN_DEEP} transparent opacity={0.1} side={DoubleSide} />
      </mesh>

      {/* Главный bezel — следует форме tier'а. */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[tier.radius - 0.005, tier.radius + 0.005, ringSegments]} />
        <meshBasicMaterial
          ref={bezelMatRef as never}
          color={CYAN_EDGE}
          toneMapped={false}
          side={DoubleSide}
        />
      </mesh>

      {/* Concentric rings — внутренние кольца ВСЕГДА круглые (даже для polygonal tier'ов),
          даёт визуальный контраст с polygonal bezel'ом — как в reference картинке.
          Segments 96 → 64: на глаз неотличимо, экономия треугольников. */}
      {ringRadii.map((r, i) => (
        <mesh key={i} rotation={[Math.PI / 2, 0, 0]}>
          <ringGeometry args={[r - 0.0025, r + 0.0025, 64]} />
          <meshBasicMaterial
            ref={(m: (Material & { color: Color }) | null) => {
              innerMatRefs.current[i] = m;
            }}
            color={CYAN_MID}
            toneMapped={false}
            transparent
            opacity={0.3 + i * 0.09}
            side={DoubleSide}
          />
        </mesh>
      ))}

      {/* Tick marks по bezel'у — INSTANCED. Раньше было ~30 mesh'ей на tier × 5 tiers = 150 draw call'ов.
          Теперь — 1 instanced mesh на tier × 5 = 5 draw call'ов. */}
      <TickMarksInstanced
        count={params.tickCount}
        innerR={tier.radius - 0.04}
        outerR={tier.radius + 0.005}
      />

      {/* Radial spokes — углы по стилю. Ярче чем раньше для electric-look. */}
      <group rotation={[Math.PI / 2, 0, 0]}>
        {spokeAngles.map((angle, i) => {
          const inner = ringRadii[0]!;
          const outer = ringRadii[ringRadii.length - 1]!;
          const mid = (inner + outer) / 2;
          const len = outer - inner;
          return (
            <mesh
              key={i}
              position={[Math.cos(angle) * mid, Math.sin(angle) * mid, 0]}
              rotation={[0, 0, angle]}
            >
              <boxGeometry args={[len, 0.0022, 0.0008]} />
              <meshBasicMaterial color={CYAN_LIGHT} transparent opacity={0.4} toneMapped={false} />
            </mesh>
          );
        })}
      </group>

      {/* Chip-widgets. */}
      {chipPositions.map((angle, i) => {
        const r = tier.radius + 0.055;
        return (
          <group
            key={i}
            position={[Math.cos(angle) * r, 0.012, Math.sin(angle) * r]}
            rotation={[0, -angle + Math.PI / 2, 0]}
          >
            <mesh>
              <boxGeometry args={[0.13, 0.025, 0.065]} />
              <meshPhysicalMaterial color="#070914" roughness={0.4} metalness={0.7} clearcoat={0.6} />
            </mesh>
            <mesh position={[0, 0.015, 0]}>
              <boxGeometry args={[0.09, 0.001, 0.038]} />
              <meshBasicMaterial color={CYAN_EDGE} toneMapped={false} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

// ============================================================
// Architectural base — большая octagonal платформа.
// ============================================================
function ArchitecturalBase(): React.ReactElement {
  const Y = -2.9;
  const octRadii = [3.3, 2.95, 2.6];
  const innerCircRadii = [2.15, 1.7, 1.2, 0.75];
  const indicators = useMemo(() => {
    const rng = mulberry32(401);
    return Array.from({ length: 14 }).map((_, i) => ({
      angle: (i / 14) * Math.PI * 2 + (rng() - 0.5) * 0.04,
      bright: rng() < 0.4,
    }));
  }, []);

  return (
    <group position={[0, Y, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
        <circleGeometry args={[3.25, 8]} />
        <meshBasicMaterial color={CYAN_DEEP} transparent opacity={0.18} side={DoubleSide} />
      </mesh>

      {octRadii.map((r, i) => (
        <mesh key={`oct-${i}`} position={[0, i * 0.008, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <ringGeometry args={[r - 0.012, r + 0.012, 8]} />
          <meshBasicMaterial
            color={i === 0 ? CYAN_EDGE : CYAN_LIGHT}
            toneMapped={false}
            transparent
            opacity={i === 0 ? 0.95 : 0.55 - i * 0.1}
            side={DoubleSide}
          />
        </mesh>
      ))}

      {innerCircRadii.map((r, i) => (
        <mesh key={`circ-${i}`} position={[0, 0.03 + i * 0.005, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <ringGeometry args={[r - 0.004, r + 0.004, 96]} />
          <meshBasicMaterial
            color={CYAN_LIGHT}
            toneMapped={false}
            transparent
            opacity={0.45 - i * 0.07}
            side={DoubleSide}
          />
        </mesh>
      ))}

      <group rotation={[Math.PI / 2, 0, 0]}>
        {Array.from({ length: 48 }).map((_, i) => {
          const angle = (i / 48) * Math.PI * 2;
          const inner = octRadii[0]! - 0.08;
          const outer = octRadii[0]! - 0.02;
          const mid = (inner + outer) / 2;
          return (
            <mesh
              key={i}
              position={[Math.cos(angle) * mid, Math.sin(angle) * mid, 0]}
              rotation={[0, 0, angle]}
            >
              <boxGeometry args={[outer - inner, 0.003, 0.001]} />
              <meshBasicMaterial color={CYAN_EDGE} transparent opacity={0.5} toneMapped={false} />
            </mesh>
          );
        })}
      </group>

      {indicators.map((ind, i) => {
        const r = octRadii[0]! - 0.18;
        return (
          <group
            key={i}
            position={[Math.cos(ind.angle) * r, 0.02, Math.sin(ind.angle) * r]}
            rotation={[0, -ind.angle + Math.PI / 2, 0]}
          >
            <mesh>
              <boxGeometry args={[0.18, 0.03, 0.09]} />
              <meshPhysicalMaterial color="#070914" roughness={0.4} metalness={0.7} clearcoat={0.6} />
            </mesh>
            <mesh position={[0, 0.018, 0]}>
              <boxGeometry args={[0.12, 0.001, 0.05]} />
              <meshBasicMaterial color={ind.bright ? CYAN_HOT : CYAN_EDGE} toneMapped={false} />
            </mesh>
          </group>
        );
      })}

      {/* Bright ring под beam'ом. */}
      <mesh position={[0, 0.06, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.35, 0.42, 64]} />
        <meshBasicMaterial color={CYAN_HOT} toneMapped={false} side={DoubleSide} />
      </mesh>
      <mesh position={[0, 0.062, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.42, 0.45, 64]} />
        <meshBasicMaterial color={CYAN_EDGE} toneMapped={false} transparent opacity={0.6} side={DoubleSide} />
      </mesh>
    </group>
  );
}

// ============================================================
// CenterCore: white-hot центр + cyan halo + outer wash + pulse rings.
// ============================================================
function CenterCore(): React.ReactElement {
  const haloRef = useRef<Mesh>(null);
  const pulse1Ref = useRef<Mesh>(null);
  const pulse2Ref = useRef<Mesh>(null);
  const yMin = -2.85;
  const yMax = TIERS[TIERS.length - 1]!.y + 0.5;
  const height = yMax - yMin;
  const centerY = (yMin + yMax) / 2;

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (haloRef.current) {
      (haloRef.current.material as { opacity: number }).opacity = 0.35 + Math.sin(t * 1.6) * 0.12;
    }
    // Кольца-пульсы поднимаются вдоль beam'а.
    if (pulse1Ref.current) {
      const u = (t * 0.35) % 1;
      pulse1Ref.current.position.y = yMin + u * height;
      const mat = pulse1Ref.current.material as { opacity: number };
      mat.opacity = Math.sin(u * Math.PI) * 0.9;
      pulse1Ref.current.scale.setScalar(1 + u * 0.5);
    }
    if (pulse2Ref.current) {
      const u = ((t * 0.35) + 0.5) % 1;
      pulse2Ref.current.position.y = yMin + u * height;
      const mat = pulse2Ref.current.material as { opacity: number };
      mat.opacity = Math.sin(u * Math.PI) * 0.9;
      pulse2Ref.current.scale.setScalar(1 + u * 0.5);
    }
  });

  return (
    <group position={[0, centerY, 0]}>
      {/* Pure white core — bloom превратит в яркую звезду. Чуть толще для большего bloom-сигнала. */}
      <mesh>
        <cylinderGeometry args={[0.03, 0.03, height, 16]} />
        <meshBasicMaterial color={CORE_WHITE} toneMapped={false} />
      </mesh>
      {/* Inner halo — насыщенный cyan, ярче. */}
      <mesh ref={haloRef}>
        <cylinderGeometry args={[0.06, 0.16, height, 24, 1, true]} />
        <meshBasicMaterial
          color={CYAN_MID}
          toneMapped={false}
          transparent
          opacity={0.55}
          side={DoubleSide}
          blending={AdditiveBlending}
        />
      </mesh>
      {/* Outer wash — мягкий wide halo. */}
      <mesh>
        <cylinderGeometry args={[0.14, 0.28, height, 24, 1, true]} />
        <meshBasicMaterial
          color={CYAN_EDGE}
          toneMapped={false}
          transparent
          opacity={0.12}
          side={DoubleSide}
          blending={AdditiveBlending}
        />
      </mesh>

      {/* Pulse rings — едут снизу вверх по beam'у. */}
      <mesh ref={pulse1Ref} position={[0, 0, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.06, 0.085, 32]} />
        <meshBasicMaterial color={CORE_WHITE} toneMapped={false} transparent opacity={0} side={DoubleSide} />
      </mesh>
      <mesh ref={pulse2Ref} position={[0, 0, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.06, 0.085, 32]} />
        <meshBasicMaterial color={CYAN_HOT} toneMapped={false} transparent opacity={0} side={DoubleSide} />
      </mesh>
    </group>
  );
}

// (ScatterDotsLayer + SatellitesLayer + BatchedLines удалены вместе с данными)

// ============================================================
// GalaxyDust — multi-layer cosmic dust: 3 слоя на разных расстояниях.
// Дальний — тусклый, плотный, медленный. Ближний — яркий, разреженный.
// ============================================================
function GalaxyDustLayer({
  count,
  radiusMin,
  radiusMax,
  yRange,
  size,
  opacity,
  color,
  speed,
  seed,
  spiral = true,
}: {
  count: number;
  radiusMin: number;
  radiusMax: number;
  yRange: number;
  size: number;
  opacity: number;
  color: string;
  speed: number;
  seed: number;
  spiral?: boolean;
}): React.ReactElement {
  const pointsRef = useRef<Points<BufferGeometry>>(null);
  const positions = useMemo(() => {
    const arr = new Float32Array(count * 3);
    const rng = mulberry32(seed);
    // Log-spiral parameters: 3 рукава 120° apart, spin-factor определяет крутизну закрутки.
    const ARMS = 3;
    const SPIN = 1.8;
    const ARM_SPREAD = 0.35; // jitter поперёк рукава

    for (let i = 0; i < count; i++) {
      let x: number;
      let z: number;
      const y = (rng() - 0.5) * yRange;
      if (spiral) {
        // Параметр t ∈ [0..1] — нормированная позиция вдоль рукава.
        const t = Math.pow(rng(), 0.7); // bias к центру для большей плотности у башни
        const r = radiusMin + (radiusMax - radiusMin) * t;
        const arm = Math.floor(rng() * ARMS);
        const armAngle = (arm / ARMS) * Math.PI * 2;
        // Spin: чем дальше от центра — тем сильнее «закручено». Это и даёт галактический look.
        const spinAngle = t * SPIN * Math.PI * 2;
        // Jitter поперёк рукава: гаусс-приближение через 2 равномерных RNG.
        const jitter = ((rng() + rng() - 1) * ARM_SPREAD);
        const angle = armAngle + spinAngle + jitter;
        x = Math.cos(angle) * r;
        z = Math.sin(angle) * r;
      } else {
        const angle = rng() * Math.PI * 2;
        const r = radiusMin + (radiusMax - radiusMin) * Math.pow(rng(), 1.5);
        x = Math.cos(angle) * r;
        z = Math.sin(angle) * r;
      }
      arr[i * 3] = x;
      arr[i * 3 + 1] = y;
      arr[i * 3 + 2] = z;
    }
    return arr;
  }, [count, radiusMin, radiusMax, yRange, seed, spiral]);

  useFrame((_, delta) => {
    if (!pointsRef.current) return;
    pointsRef.current.rotation.y += delta * speed;
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        color={color}
        size={size}
        transparent
        opacity={opacity}
        sizeAttenuation
        blending={AdditiveBlending}
        depthWrite={false}
        toneMapped={false}
      />
    </points>
  );
}

// Nebula-glow — большой sprite вокруг башни, мягкая аура.
function NebulaGlow(): React.ReactElement {
  const meshRef = useRef<Mesh>(null);
  useFrame((state) => {
    if (!meshRef.current) return;
    const t = state.clock.elapsedTime;
    meshRef.current.scale.setScalar(1 + Math.sin(t * 0.3) * 0.05);
  });
  return (
    <mesh ref={meshRef} position={[0, 0, -2]}>
      <sphereGeometry args={[6, 32, 32]} />
      <meshBasicMaterial
        color={NAVY_DEEP}
        transparent
        opacity={0.12}
        side={DoubleSide}
        blending={AdditiveBlending}
        depthWrite={false}
      />
    </mesh>
  );
}

// Простой тёмный пол вместо MeshReflectorMaterial — без отражения, без extra render pass.
// Главный жирный win по FPS: убираем целый full-screen pass на 512² resolution каждый кадр.
// Визуально компенсируем bloom'ом от башни сверху + декоративными кольцами на полу.
function SimpleFloor(): React.ReactElement {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -2.92, 0]}>
      <circleGeometry args={[10, 64]} />
      <meshBasicMaterial color="#020308" />
    </mesh>
  );
}

// ============================================================
// OrbitCamera — мышь крутит камеру по spherical-coords вокруг башни.
// Башня всегда в центре кадра, камера обходит её по сфере радиуса R.
// ============================================================
function OrbitCamera(): React.ReactElement {
  const { camera } = useThree();
  const mouseRef = useRef({ x: 0, y: 0 });
  // Текущие spherical-координаты (анимируем к target).
  const currentRef = useRef({ yaw: 0, pitch: 0.08 });
  const targetRef = useRef({ yaw: 0, pitch: 0.08 });

  // Базовая дистанция камеры.
  const R = 11;
  const BASE_YAW = 0;
  const BASE_PITCH = 0.08;
  // Лимиты движения (radians).
  const YAW_RANGE = 0.45;    // ~26° влево/вправо
  const PITCH_RANGE = 0.22;  // ~12° вверх/вниз

  useEffect(() => {
    const handler = (e: PointerEvent): void => {
      mouseRef.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      mouseRef.current.y = -(((e.clientY / window.innerHeight) * 2) - 1);
    };
    window.addEventListener('pointermove', handler, { passive: true });
    return () => window.removeEventListener('pointermove', handler);
  }, []);

  useFrame(() => {
    targetRef.current.yaw = BASE_YAW + mouseRef.current.x * YAW_RANGE;
    targetRef.current.pitch = BASE_PITCH + mouseRef.current.y * PITCH_RANGE;
    // Лерп текущих к target — soft easing.
    currentRef.current.yaw += (targetRef.current.yaw - currentRef.current.yaw) * 0.06;
    currentRef.current.pitch += (targetRef.current.pitch - currentRef.current.pitch) * 0.06;

    // Spherical → cartesian. Башня в (0,0,0), камера на сфере радиуса R.
    const { yaw, pitch } = currentRef.current;
    const cosP = Math.cos(pitch);
    camera.position.x = R * Math.sin(yaw) * cosP;
    camera.position.y = R * Math.sin(pitch) + 0.6;
    camera.position.z = R * Math.cos(yaw) * cosP;
    camera.lookAt(0, 0, 0);
  });

  return <></>;
}

// ============================================================
// Lensing — кастомный postprocessing-эффект radial distortion вокруг точки.
// Эмулирует gravitational lensing у ядра (Interstellar-vibe).
// ============================================================
const lensingFragmentShader = /* glsl */ `
  uniform vec2 lensCenter;
  uniform float lensStrength;
  uniform float lensRadius;

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec2 toCenter = uv - lensCenter;
    // Корректируем по aspect чтоб искажение оставалось круговым на широких экранах.
    float aspect = resolution.x / resolution.y;
    vec2 toCenterCorrected = toCenter;
    toCenterCorrected.x *= aspect;
    float dist = length(toCenterCorrected);

    if (dist < lensRadius) {
      // Quadratic falloff: ближе к центру — сильнее warp.
      float warp = 1.0 - (dist / lensRadius);
      warp = warp * warp * lensStrength;
      vec2 warpedUv = uv - toCenter * warp;
      outputColor = texture2D(inputBuffer, warpedUv);
    } else {
      outputColor = inputColor;
    }
  }
`;

class LensingEffect extends Effect {
  constructor() {
    super('LensingEffect', lensingFragmentShader, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, Uniform<unknown>>([
        ['lensCenter', new Uniform(new Vector2(0.5, 0.5))],
        // Strength снижен с 0.25 → 0.08 чтоб не было видимого "чёрного пятна" в центре.
        // Radius меньше: 0.18 → 0.12 — компактнее, не цепляет много пространства.
        ['lensStrength', new Uniform(0.08)],
        ['lensRadius', new Uniform(0.12)],
      ]),
    });
  }
}

// React-обёртка над LensingEffect — каждый кадр проецирует world-origin в screen UV
// и обновляет uniform `lensCenter`. Так искажение всегда стоит на ядре, даже когда
// камера движется (orbit/parallax).
function Lensing(): React.ReactElement {
  const effect = useMemo(() => new LensingEffect(), []);
  const tmp = useMemo(() => new Vector3(), []);
  useFrame(({ camera, size }) => {
    // Проекция точки (0, 0, 0) [центр башни] в NDC, потом в UV [0..1].
    tmp.set(0, 0, 0).project(camera);
    const uv = effect.uniforms.get('lensCenter')!.value as Vector2;
    uv.set((tmp.x + 1) / 2, (tmp.y + 1) / 2);
    // size используется во встроенной uniform resolution автоматически.
    void size;
  });
  return <primitive object={effect} />;
}

function SceneAtmosphere(): React.ReactElement {
  const { scene } = useThree();
  useMemo(() => {
    scene.fog = new FogExp2(BG, 0.055);
    scene.background = new Color(BG);
  }, [scene]);
  return <></>;
}

function RotatingTower(): React.ReactElement {
  const groupRef = useRef<Group>(null);
  const { size } = useThree();
  const offsetX = size.width >= 1024 ? 1.5 : 0;
  useFrame((_, delta) => {
    if (!groupRef.current) return;
    groupRef.current.rotation.y += delta * 0.09;
  });
  return (
    <group ref={groupRef} position={[offsetX, 0, 0]}>
      <ArchitecturalBase />
      <CenterCore />
      {TIERS.map((tier, i) => (
        <CircuitDisk key={i} tier={tier} tierIdx={i} />
      ))}
      <SurroundingConstellation />
      <ConstellationPulses />
      <SurroundingCoresLayer />
      <NeonPlaques />
    </group>
  );
}

export default function HeroScene(): React.ReactElement {
  return (
    <Canvas
      // DPR cap 1.25 — на retina-экранах ещё меньше пикселей. AdaptiveDpr может
      // понизить до 1 если FPS падает (ниже см. компонент).
      dpr={[1, 1.25]}
      camera={{ position: [0, 0.6, 11], fov: 36 }}
      gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
      style={{ background: 'transparent' }}
      shadows={false}
    >
      <SceneAtmosphere />
      <OrbitCamera />

      <ambientLight intensity={0.12} />
      <directionalLight position={[6, 8, -4]} intensity={0.6} color="#c7d2fe" />
      <pointLight position={[-4, 1, 4]} intensity={1.4} color={CYAN_EDGE} distance={14} />
      <pointLight position={[0, -2.5, 2]} intensity={1.2} color={CYAN_LIGHT} distance={10} />

      {/* Adaptive quality: drei отслеживает FPS, при падении понижает DPR и приостанавливает
          ивенты. На low-end железе сцена плавная за счёт автоматического downgrade. */}
      <AdaptiveDpr pixelated />
      <AdaptiveEvents />

      <Suspense fallback={null}>
        <SimpleFloor />
        <NebulaGlow />
        {/* Galaxy dust: 540 → 360 точек. Размер каждой точки чуть подняли — на глаз
            плотность облака не упала. */}
        <GalaxyDustLayer count={220} radiusMin={6}   radiusMax={20} yRange={14} size={0.04}  opacity={0.45} color={CYAN_LIGHT} speed={0.005} seed={101} />
        <GalaxyDustLayer count={100} radiusMin={3.5} radiusMax={9}  yRange={9}  size={0.055} opacity={0.6}  color={CYAN_LIGHT} speed={0.02}  seed={202} />
        <GalaxyDustLayer count={40}  radiusMin={2}   radiusMax={5}  yRange={7}  size={0.07}  opacity={0.85} color={CYAN_HOT}   speed={-0.03} seed={303} />

        <RotatingTower />

        {/* Sparkles 25 → 15. */}
        <Sparkles count={15} scale={[5, 7, 5]} size={1.6} speed={0.4} color={CYAN_HOT} opacity={0.55} />

        {/* multisampling={0} — отключает MSAA в postprocessing-пайплайне. Bloom и так
            блюрит края, MSAA здесь не нужен. Big GPU-win. */}
        <EffectComposer multisampling={0}>
          <Bloom
            intensity={1.65}
            luminanceThreshold={0.25}
            luminanceSmoothing={0.45}
            mipmapBlur
            radius={0.7}
          />
        </EffectComposer>
      </Suspense>
    </Canvas>
  );
}
