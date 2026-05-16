import React, { useEffect, useRef } from "react";

export function ParticleOrb({ className = "" }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0, w = 0, h = 0;
    const isMobile = window.innerWidth < 768;
    const dpr = isMobile ? 1 : Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      w = r.width; h = r.height;
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    // Fibonacci-lattice sphere
    const N = isMobile ? 200 : 400;
    const phi = Math.PI * (3 - Math.sqrt(5));
    const particles = Array.from({ length: N }, (_, i) => {
      const y = 1 - (i / (N - 1)) * 2;
      const r = Math.sqrt(1 - y * y);
      const t = phi * i;
      return { x: Math.cos(t) * r, y, z: Math.sin(t) * r, r: 0.6 + Math.random() * 1.4 };
    });

    const orbits = Array.from({ length: isMobile ? 25 : 50 }, () => ({
      a: Math.random() * Math.PI * 2,
      tilt: Math.random() * Math.PI,
      speed: 0.003 + Math.random() * 0.008,
      dist: 1.15 + Math.random() * 0.35,
      size: 0.8 + Math.random() * 1.6,
    }));

    let t = 0, mx = 0, my = 0;
    const onMove = (e: MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      mx = ((e.clientX - r.left) / r.width  - 0.5) * 0.8;
      my = ((e.clientY - r.top)  / r.height - 0.5) * 0.8;
    };
    window.addEventListener("mousemove", onMove);

    const render = () => {
      t += 0.005;
      ctx.clearRect(0, 0, w, h);
      const cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.32;

      // Halo
      const halo = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * 2.2);
      halo.addColorStop(0,   "rgba(217,179,130,0.28)");
      halo.addColorStop(0.4, "rgba(217,179,130,0.08)");
      halo.addColorStop(1,   "rgba(0,0,0,0)");
      ctx.fillStyle = halo; ctx.fillRect(0, 0, w, h);

      const ry = t + mx * 0.5;
      const rx = Math.sin(t * 0.7) * 0.2 + my * 0.4;
      const cY = Math.cos(ry), sY = Math.sin(ry);
      const cX = Math.cos(rx), sX = Math.sin(rx);

      const proj = particles.map(p => {
        const x = p.x * cY - p.z * sY;
        let z = p.x * sY + p.z * cY;
        const y = p.y * cX - z * sX;
        z     = p.y * sX + z * cX;
        const s = 600 / (600 + z * R);
        return { x: cx + x * R * s, y: cy + y * R * s, z, s };
      }).sort((a, b) => a.z - b.z);

      for (const p of proj) {
        const d = (p.z + 1) / 2;
        ctx.beginPath();
        ctx.arc(p.x, p.y, (0.8 + d * 1.8) * p.s, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(232,196,142,${0.15 + d * 0.75})`;
        ctx.fill();
      }

      for (const o of orbits) {
        o.a += o.speed;
        const x = Math.cos(o.a) * o.dist;
        const z = Math.sin(o.a) * o.dist;
        const y = Math.sin(o.a * 0.7 + o.tilt) * 0.3;
        const x2 = x * cY - z * sY;
        let z2 = x * sY + z * cY;
        const y2 = y * cX - z2 * sX;
        z2     = y * sX + z2 * cX;
        const s = 600 / (600 + z2 * R);
        ctx.beginPath();
        ctx.arc(cx + x2 * R * s, cy + y2 * R * s, o.size * s, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255,220,170,${0.3 + ((z2 + 1.5) / 3) * 0.7})`;
        ctx.fill();
      }

      const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.55);
      core.addColorStop(0,   "rgba(255,230,180,0.55)");
      core.addColorStop(0.5, "rgba(217,179,130,0.18)");
      core.addColorStop(1,   "rgba(0,0,0,0)");
      ctx.fillStyle = core;
      ctx.beginPath(); ctx.arc(cx, cy, R * 0.55, 0, Math.PI * 2); ctx.fill();

      raf = requestAnimationFrame(render);
    };
    render();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMove);
    };
  }, []);

  return <canvas ref={canvasRef} className={`w-full h-full block ${className}`} />;
}
