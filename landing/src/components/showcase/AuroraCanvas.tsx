import React, { useEffect, useRef } from 'react';

interface AuroraCanvasProps {
  colors: [string, string, string];
}

export const AuroraCanvas: React.FC<AuroraCanvasProps> = ({ colors }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const colorsRef = useRef(colors);
  colorsRef.current = colors;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let animId = 0;
    let t = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    window.addEventListener('resize', resize);

    const renderFrame = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      ctx.clearRect(0, 0, w, h);

      const [c1, c2, c3] = colorsRef.current;
      const ribbons = [
        { color: c1, amp: 68, freq: 0.0022, speed: 1.0, yOffset: h * 0.62, width: 84, alpha: 0.28 },
        { color: c2, amp: 52, freq: 0.0028, speed: 1.35, yOffset: h * 0.56, width: 56, alpha: 0.34 },
        { color: c3, amp: 38, freq: 0.0034, speed: 1.7, yOffset: h * 0.5, width: 32, alpha: 0.42 },
      ];

      ctx.save();
      ctx.globalCompositeOperation = 'screen';

      for (const r of ribbons) {
        ctx.beginPath();
        for (let x = -40; x <= w + 40; x += 24) {
          const diagonalLift = (x / w - 0.5) * -h * 0.38;
          const wave =
            Math.sin(x * r.freq + t * r.speed) * r.amp +
            Math.cos(x * r.freq * 0.6 - t * 0.8) * (r.amp * 0.45);
          const y = r.yOffset + diagonalLift + wave;
          if (x === -40) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = r.color;
        ctx.lineWidth = r.width;
        ctx.lineCap = 'round';
        ctx.shadowColor = r.color;
        ctx.shadowBlur = 42;
        ctx.globalAlpha = r.alpha;
        ctx.stroke();
      }

      ctx.restore();
    };

    if (prefersReduced) {
      renderFrame();
      return () => {
        window.removeEventListener('resize', resize);
      };
    }

    const loop = () => {
      t += 0.012;
      renderFrame();
      animId = requestAnimationFrame(loop);
    };

    animId = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 w-screen h-screen pointer-events-none z-0 opacity-90"
      aria-hidden="true"
    />
  );
};
