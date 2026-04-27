// Subtle animated circuit board background.
// Generates a deterministic grid of traces + nodes, animates slow pulses along select traces.
// Ported from the Claude Design handoff bundle (circuit-board.jsx).

import { useEffect, useRef } from 'react';

function hexToRgba(hex, a) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

export default function CircuitBoard({ accent = '#a78bfa', density = 0.85, className = '' }) {
  const canvasRef = useRef(null);
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });
  const stateRef = useRef(null);

  const buildGraph = (w, h) => {
    let seed = 1337;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0xffffffff;
    };

    const cell = 80;
    const cols = Math.ceil(w / cell) + 1;
    const rows = Math.ceil(h / cell) + 1;

    const nodes = [];
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (rnd() > 0.55 / density) continue;
        const jx = (rnd() - 0.5) * cell * 0.4;
        const jy = (rnd() - 0.5) * cell * 0.4;
        nodes.push({
          id: nodes.length,
          x: x * cell + jx,
          y: y * cell + jy,
          gx: x,
          gy: y,
          size: rnd() < 0.15 ? 3 : rnd() < 0.4 ? 2 : 1.2,
        });
      }
    }

    const edges = [];
    const used = new Set();
    for (const n of nodes) {
      const others = nodes
        .filter((m) => m !== n)
        .map((m) => ({ m, d: Math.hypot(m.x - n.x, m.y - n.y) }))
        .sort((a, b) => a.d - b.d)
        .slice(1, 7);

      const k = 1 + Math.floor(rnd() * 2.4);
      for (let i = 0; i < Math.min(k, others.length); i++) {
        const m = others[i].m;
        const key = n.id < m.id ? `${n.id}-${m.id}` : `${m.id}-${n.id}`;
        if (used.has(key)) continue;
        used.add(key);

        const horizFirst = rnd() > 0.5;
        const corner = horizFirst ? { x: m.x, y: n.y } : { x: n.x, y: m.y };
        const segments = [
          { a: { x: n.x, y: n.y }, b: corner },
          { a: corner, b: { x: m.x, y: m.y } },
        ].filter((s) => Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y) > 1);

        const length = segments.reduce(
          (sum, s) => sum + Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y),
          0,
        );

        edges.push({
          id: edges.length,
          a: n,
          b: m,
          segments,
          length,
          pulses:
            rnd() < 0.28
              ? Array.from({ length: 1 + Math.floor(rnd() * 2) }, () => ({
                  t: rnd(),
                  speed: 0.10 + rnd() * 0.14,
                }))
              : [],
        });
      }
    }

    return { nodes, edges };
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = canvas.getBoundingClientRect();
      sizeRef.current = { w: rect.width, h: rect.height, dpr };
      canvas.width = Math.floor(rect.width * dpr);
      canvas.height = Math.floor(rect.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      stateRef.current = buildGraph(rect.width, rect.height);
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    let last = performance.now();
    let raf = 0;

    const tick = (now) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const { w, h } = sizeRef.current;
      const state = stateRef.current;
      if (!state) {
        raf = requestAnimationFrame(tick);
        return;
      }

      ctx.clearRect(0, 0, w, h);

      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(180, 200, 220, 0.08)';
      ctx.beginPath();
      for (const e of state.edges) {
        for (const s of e.segments) {
          ctx.moveTo(s.a.x, s.a.y);
          ctx.lineTo(s.b.x, s.b.y);
        }
      }
      ctx.stroke();

      ctx.strokeStyle = 'rgba(200, 220, 240, 0.14)';
      ctx.beginPath();
      for (const e of state.edges) {
        if ((e.id % 7) !== 0) continue;
        for (const s of e.segments) {
          ctx.moveTo(s.a.x, s.a.y);
          ctx.lineTo(s.b.x, s.b.y);
        }
      }
      ctx.stroke();

      for (const n of state.nodes) {
        ctx.fillStyle = 'rgba(15, 22, 32, 1)';
        ctx.strokeStyle = 'rgba(180, 200, 220, 0.28)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }

      for (const e of state.edges) {
        if (!e.pulses.length) continue;
        for (const p of e.pulses) {
          p.t += p.speed * dt;
          if (p.t > 1.15) p.t = -0.15;
          if (p.t < 0 || p.t > 1) continue;

          const target = p.t * e.length;
          let acc = 0;
          let pos = null;
          for (const s of e.segments) {
            const segLen = Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);
            if (acc + segLen >= target) {
              const f = (target - acc) / segLen;
              pos = {
                x: s.a.x + (s.b.x - s.a.x) * f,
                y: s.a.y + (s.b.y - s.a.y) * f,
              };
              break;
            }
            acc += segLen;
          }
          if (!pos) continue;

          const grad = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, 18);
          grad.addColorStop(0, hexToRgba(accent, 0.55));
          grad.addColorStop(0.4, hexToRgba(accent, 0.18));
          grad.addColorStop(1, hexToRgba(accent, 0));
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(pos.x, pos.y, 18, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = hexToRgba(accent, 0.95);
          ctx.beginPath();
          ctx.arc(pos.x, pos.y, 1.6, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [accent, density]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        display: 'block',
        pointerEvents: 'none',
      }}
    />
  );
}
