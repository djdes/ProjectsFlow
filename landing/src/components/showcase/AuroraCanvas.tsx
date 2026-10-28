import React, { useEffect, useRef } from 'react';

interface AuroraCanvasProps {
  glowRgb: [number, number, number];
}

/**
 * Caustic Horizon Grid & Volumetric Vertical Glass Columns Canvas
 * Dealt by deal-showcase.mjs: `caustic-water-grid` + Pinterest references (Solane V-beam + Recognito vertical columns)
 */
export const AuroraCanvas: React.FC<AuroraCanvasProps> = ({ glowRgb }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const currentRgb = useRef<[number, number, number]>([...glowRgb]);
  const targetRgb = useRef<[number, number, number]>([...glowRgb]);

  useEffect(() => {
    targetRgb.current = [...glowRgb];
  }, [glowRgb]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId = 0;
    let time = 0;

    const handleResize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.floor(window.innerWidth * dpr);
      canvas.height = Math.floor(window.innerHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    handleResize();
    window.addEventListener('resize', handleResize);

    const render = () => {
      time += 0.012;
      const w = window.innerWidth;
      const h = window.innerHeight;

      currentRgb.current[0] += (targetRgb.current[0] - currentRgb.current[0]) * 0.06;
      currentRgb.current[1] += (targetRgb.current[1] - currentRgb.current[1]) * 0.06;
      currentRgb.current[2] += (targetRgb.current[2] - currentRgb.current[2]) * 0.06;

      const r = Math.round(currentRgb.current[0]);
      const g = Math.round(currentRgb.current[1]);
      const b = Math.round(currentRgb.current[2]);

      ctx.clearRect(0, 0, w, h);
      ctx.save();
      ctx.globalCompositeOperation = 'screen';

      // 1. Recognito-inspired vertical glass columns with subtle wave modulation
      const colCount = 12;
      const colWidth = w / colCount;
      for (let i = 0; i < colCount; i++) {
        const wave = Math.sin(time * 1.1 + i * 0.55) * 0.5 + 0.5;
        const colAlpha = 0.018 + wave * 0.035;
        const x = i * colWidth;

        const colGrad = ctx.createLinearGradient(x, 0, x, h);
        colGrad.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0)`);
        colGrad.addColorStop(0.45, `rgba(${r}, ${g}, ${b}, ${colAlpha})`);
        colGrad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);

        ctx.fillStyle = colGrad;
        ctx.fillRect(x, 0, colWidth - 1, h);

        // Subtle column divider line
        ctx.strokeStyle = `rgba(255, 255, 255, 0.025)`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }

      // 2. Perspective Horizon Grid (caustic-water-grid)
      const horizonY = h * 0.58;
      const vanishX = w * 0.62; // Aligned with the 3D Exploded Stack stage on the right
      const gridLines = 14;

      ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, 0.11)`;
      ctx.lineWidth = 1;

      for (let i = -gridLines; i <= gridLines; i++) {
        ctx.beginPath();
        ctx.moveTo(vanishX + i * 28, horizonY);
        ctx.lineTo(vanishX + i * 195, h + 40);
        ctx.stroke();
      }

      // Animated horizontal perspective scanlines moving forward
      const rowCount = 9;
      const offset = (time * 0.35) % 1;
      for (let row = 0; row < rowCount; row++) {
        const t = (row + offset) / rowCount;
        const easedT = t * t; // perspective foreshortening
        const y = horizonY + easedT * (h - horizonY);
        const alpha = (1 - t) * 0.16;

        ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      // 3. Solane-inspired luminous converging energy arcs
      for (let arcIdx = 0; arcIdx < 2; arcIdx++) {
        ctx.beginPath();
        const dir = arcIdx === 0 ? -1 : 1;
        const startX = arcIdx === 0 ? -40 : w + 40;
        const startY = h * (0.28 + Math.sin(time + arcIdx) * 0.04);
        const ctrlX = vanishX + dir * 180;
        const ctrlY = horizonY + 40;
        const endX = vanishX;
        const endY = horizonY + 90;

        ctx.moveTo(startX, startY);
        ctx.quadraticCurveTo(ctrlX, ctrlY, endX, endY);

        ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, 0.18)`;
        ctx.lineWidth = 2.5;
        ctx.shadowColor = `rgb(${r}, ${g}, ${b})`;
        ctx.shadowBlur = 28;
        ctx.stroke();
      }

      // 4. Pulsing concentric energy ring under the 3D stack
      const pulseRadius = 140 + Math.sin(time * 1.8) * 18;
      const radialGlow = ctx.createRadialGradient(
        vanishX,
        horizonY + 20,
        10,
        vanishX,
        horizonY + 20,
        pulseRadius * 2.2
      );
      radialGlow.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.22)`);
      radialGlow.addColorStop(0.5, `rgba(${r}, ${g}, ${b}, 0.06)`);
      radialGlow.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);

      ctx.fillStyle = radialGlow;
      ctx.beginPath();
      ctx.arc(vanishX, horizonY + 20, pulseRadius * 2.2, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
      animId = window.requestAnimationFrame(render);
    };

    animId = window.requestAnimationFrame(render);
    return () => {
      window.cancelAnimationFrame(animId);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="fixed inset-0 w-full h-full pointer-events-none z-0 opacity-90"
    />
  );
};
