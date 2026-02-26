import { useRef, useEffect, useCallback } from "react";

const CELL_SIZE = 100;
const TRACE_COLOR_DESKTOP = "rgba(255,255,255,0.22)";
const TRACE_COLOR_MOBILE = "rgba(255,255,255,0.25)";
const LINE_WIDTH = 2.8;
const PAD_RADIUS = 5;
const VIA_RADIUS = 2.4;

const AMBIENT_SWEEP_RADIUS = 260;
const AMBIENT_SWEEP_BASE = 0.2;
const AMBIENT_SWEEP_PULSE = 0.1;
const MAX_PARTICLES = 30;
const PARTICLE_MAX_AGE = 4200; // ms
const PARTICLE_SPEED = 120; // px/sec
const SPAWN_INTERVAL = 120; // ms
const SPAWN_INTERVAL_CONVERGE = 70; // ms
const PARTICLE_ARRIVE_DIST = 10; // px
const PARTICLE_FADE_START = 50; // px — start fading within this distance of target
const PACKET_LENGTH = 24;
const PACKET_WIDTH = 5.2;
const PACKET_GLOW = 10;

/**
 * Seeded pseudo-random number generator (mulberry32).
 * Deterministic so the pattern is stable across redraws at the same size.
 */
function createRng(seed) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generate PCB trace layout data for the given viewport dimensions.
 * Returns { traces, pads, vias } where:
 *   - traces: array of { points: [{x,y}, ...], padIndices: number[] }
 *   - pads:   array of { x, y, radius, traceIndices: number[] }
 *   - vias:   array of { x, y, radius }
 */
function generateTraces(width, height) {
  const rng = createRng(42 + Math.floor(width * 0.13) + Math.floor(height * 0.17));

  const traces = [];
  const pads = [];
  const vias = [];
  const margin = 0;
  const stepX = Math.max(120, Math.min(190, Math.floor(width / 8)));
  const stepY = Math.max(110, Math.min(180, Math.floor(height / 7)));

  const clampPoint = (x, y) => ({
    x: Math.min(width - margin, Math.max(margin, x)),
    y: Math.min(height - margin, Math.max(margin, y)),
  });

  const addTrace = (rawPoints) => {
    const points = rawPoints
      .map((pt) => clampPoint(pt.x, pt.y))
      .filter((pt, idx, arr) => idx === 0 || dist(pt.x, pt.y, arr[idx - 1].x, arr[idx - 1].y) > 6);
    if (points.length < 2) return;

    const traceIdx = traces.length;
    const tracePadIndices = [];

    const padStart = { x: points[0].x, y: points[0].y, radius: PAD_RADIUS, traceIndices: [traceIdx] };
    tracePadIndices.push(pads.length);
    pads.push(padStart);

    const lastPt = points[points.length - 1];
    const padEnd = { x: lastPt.x, y: lastPt.y, radius: PAD_RADIUS, traceIndices: [traceIdx] };
    tracePadIndices.push(pads.length);
    pads.push(padEnd);

    for (let i = 0; i < points.length - 1; i++) {
      if (rng() < 0.45) {
        const t = 0.25 + rng() * 0.5;
        const vx = points[i].x + (points[i + 1].x - points[i].x) * t;
        const vy = points[i].y + (points[i + 1].y - points[i].y) * t;
        vias.push({ x: vx, y: vy, radius: VIA_RADIUS });
      }
    }

    traces.push({ points, padIndices: tracePadIndices });
  };

  const horizontalLanes = Math.max(2, Math.floor((height - margin * 2) / (stepY * 1.25)));
  for (let lane = 0; lane < horizontalLanes; lane++) {
    const yBase = margin + ((lane + 1) / (horizontalLanes + 1)) * (height - margin * 2);
    const y = yBase + (rng() - 0.5) * stepY * 0.14;
    const xStart = 0;
    const xEnd = width;
    if (xEnd - xStart < stepX * 2) continue;

    if (rng() < 0.58) {
      const jogX = xStart + (xEnd - xStart) * (0.28 + rng() * 0.44);
      const jogY = y + (rng() < 0.5 ? -1 : 1) * stepY * (0.55 + rng() * 0.45);
      addTrace([
        { x: xStart, y },
        { x: jogX, y },
        { x: jogX, y: jogY },
        { x: xEnd, y: jogY },
      ]);
    } else {
      addTrace([
        { x: xStart, y },
        { x: xEnd, y },
      ]);
    }
  }

  const verticalLanes = Math.max(2, Math.floor((width - margin * 2) / (stepX * 1.25)));
  for (let lane = 0; lane < verticalLanes; lane++) {
    const xBase = margin + ((lane + 1) / (verticalLanes + 1)) * (width - margin * 2);
    const x = xBase + (rng() - 0.5) * stepX * 0.14;
    const yStart = 0;
    const yEnd = height;
    if (yEnd - yStart < stepY * 2) continue;

    if (rng() < 0.62) {
      const jogY = yStart + (yEnd - yStart) * (0.25 + rng() * 0.5);
      const jogX = x + (rng() < 0.5 ? -1 : 1) * stepX * (0.55 + rng() * 0.45);
      addTrace([
        { x, y: yStart },
        { x, y: jogY },
        { x: jogX, y: jogY },
        { x: jogX, y: yEnd },
      ]);
    } else {
      addTrace([
        { x, y: yStart },
        { x, y: yEnd },
      ]);
    }
  }

  const baseTraces = traces.slice();
  const branchBudget = Math.max(6, Math.floor((width + height) / 240));
  for (let i = 0; i < branchBudget; i++) {
    if (baseTraces.length === 0) break;
    const base = baseTraces[Math.floor(rng() * baseTraces.length)];
    if (!base || base.points.length < 2) continue;

    const segIdx = Math.floor(rng() * (base.points.length - 1));
    const a = base.points[segIdx];
    const b = base.points[segIdx + 1];
    const t = 0.18 + rng() * 0.64;
    const anchor = {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
    };

    const horizontal = Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
    const primaryLen = (horizontal ? stepY : stepX) * (0.8 + rng() * 1.6);
    const secondaryLen = (horizontal ? stepX : stepY) * (0.55 + rng() * 1.15);
    const dirA = rng() < 0.5 ? -1 : 1;
    const dirB = rng() < 0.5 ? -1 : 1;

    if (horizontal) {
      const p2 = { x: anchor.x, y: anchor.y + dirA * primaryLen };
      const p3 = { x: p2.x + dirB * secondaryLen, y: p2.y };
      addTrace([anchor, p2, p3]);
    } else {
      const p2 = { x: anchor.x + dirA * primaryLen, y: anchor.y };
      const p3 = { x: p2.x, y: p2.y + dirB * secondaryLen };
      addTrace([anchor, p2, p3]);
    }
  }

  // Build adjacency: connect nearby pad endpoints into navigable network
  const CONNECT_THRESHOLD = Math.min(stepX, stepY) * 0.34;
  for (let i = 0; i < pads.length; i++) {
    for (let j = i + 1; j < pads.length; j++) {
      const dx = pads[i].x - pads[j].x;
      const dy = pads[i].y - pads[j].y;
      if (Math.sqrt(dx * dx + dy * dy) < CONNECT_THRESHOLD) {
        // Merge adjacency: each pad knows about the other's traces
        for (const ti of pads[j].traceIndices) {
          if (!pads[i].traceIndices.includes(ti)) {
            pads[i].traceIndices.push(ti);
          }
        }
        for (const ti of pads[i].traceIndices) {
          if (!pads[j].traceIndices.includes(ti)) {
            pads[j].traceIndices.push(ti);
          }
        }
      }
    }
  }

  // Pre-compute bounding boxes for each trace (used for fast proximity culling)
  for (const trace of traces) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of trace.points) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    trace.bbox = { minX, minY, maxX, maxY };
  }

  return { traces, pads, vias };
}

/**
 * Draw the circuit board pattern onto the given canvas context (static/mobile).
 */
function drawCircuitBoard(ctx, data, traceColor, dpr) {
  const { traces, pads, vias } = data;

  ctx.save();
  ctx.scale(dpr, dpr);

  ctx.clearRect(0, 0, ctx.canvas.width / dpr, ctx.canvas.height / dpr);

  // Draw traces
  ctx.strokeStyle = traceColor;
  ctx.lineWidth = LINE_WIDTH;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (const trace of traces) {
    if (trace.points.length < 2) continue;
    ctx.beginPath();
    ctx.moveTo(trace.points[0].x, trace.points[0].y);
    for (let i = 1; i < trace.points.length; i++) {
      ctx.lineTo(trace.points[i].x, trace.points[i].y);
    }
    ctx.stroke();
  }

  // Draw pads (stroke circles)
  for (const pad of pads) {
    ctx.beginPath();
    ctx.arc(pad.x, pad.y, pad.radius, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Draw vias (filled circles)
  ctx.fillStyle = traceColor;
  for (const via of vias) {
    ctx.beginPath();
    ctx.arc(via.x, via.y, via.radius, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

// ─── Geometry helpers ──────────────────────────────────────────────────────────

/** Distance from point (px,py) to line segment (ax,ay)-(bx,by). */
function pointToSegmentDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    // Degenerate segment
    const ex = px - ax;
    const ey = py - ay;
    return Math.sqrt(ex * ex + ey * ey);
  }
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = ax + t * dx;
  const projY = ay + t * dy;
  const ex = px - projX;
  const ey = py - projY;
  return Math.sqrt(ex * ex + ey * ey);
}

/** Minimum distance from point to any segment of a trace. */
function pointToTraceDist(px, py, trace) {
  let minDist = Infinity;
  const pts = trace.points;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = pointToSegmentDist(px, py, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y);
    if (d < minDist) minDist = d;
  }
  return minDist;
}

/** Euclidean distance between two points. */
function dist(x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Interpolate trace color between idle (white) and bright (Northwestern purple) based on factor 0-1. */
function traceColorInterp(factor) {
  // idle: rgba(255,255,255,0.22), bright: rgba(78,42,132,0.50)
  const r = Math.round(255 + factor * (78 - 255));
  const g = Math.round(255 + factor * (42 - 255));
  const b = Math.round(255 + factor * (132 - 255));
  const alpha = 0.22 + factor * (0.50 - 0.22);
  return `rgba(${r},${g},${b},${alpha.toFixed(4)})`;
}

function traceInfluenceFactor(trace, x, y, radius) {
  const bb = trace.bbox;
  if (
    x < bb.minX - radius ||
    x > bb.maxX + radius ||
    y < bb.minY - radius ||
    y > bb.maxY + radius
  ) {
    return 0;
  }
  const d = pointToTraceDist(x, y, trace);
  if (d >= radius) return 0;
  return 1 - d / radius;
}

function ambientSweep(now, width, height) {
  return {
    x: width * 0.5 + Math.cos(now * 0.00023) * width * 0.34,
    y: height * 0.5 + Math.sin(now * 0.00017) * height * 0.29,
    strength: AMBIENT_SWEEP_BASE + Math.sin(now * 0.0015) * AMBIENT_SWEEP_PULSE,
  };
}

// ─── Particle helpers ──────────────────────────────────────────────────────────

function createParticle(x, y, traceIndex, segmentIndex, t, targetX, targetY, idle, dir = 1) {
  const initialAngle = Math.atan2(targetY - y, targetX - x);
  return {
    x,
    y,
    prevX: x,
    prevY: y,
    angle: Number.isFinite(initialAngle) ? initialAngle : 0,
    targetX,
    targetY,
    traceIndex,
    segmentIndex,
    t,
    dir,
    speed: PARTICLE_SPEED,
    opacity: idle ? 0.35 : 0.9,
    age: 0,
    idle,
  };
}

function drawParticlePacket(ctx, particle, alpha) {
  const length = particle.idle ? PACKET_LENGTH * 0.88 : PACKET_LENGTH;
  const width = particle.idle ? PACKET_WIDTH * 0.9 : PACKET_WIDTH;
  const halfLength = length * 0.5;
  const halfWidth = width * 0.5;
  const clampedAlpha = Math.max(0, Math.min(1, alpha));

  ctx.save();
  ctx.translate(particle.x, particle.y);
  ctx.rotate(particle.angle);

  ctx.shadowColor = `rgba(170,130,235,${(0.45 * clampedAlpha).toFixed(3)})`;
  ctx.shadowBlur = PACKET_GLOW;

  const gradient = ctx.createLinearGradient(-halfLength, 0, halfLength, 0);
  gradient.addColorStop(0, "rgba(140,100,200,0)");
  gradient.addColorStop(0.16, `rgba(140,100,200,${(0.55 * clampedAlpha).toFixed(3)})`);
  gradient.addColorStop(0.5, `rgba(205,180,255,${(0.95 * clampedAlpha).toFixed(3)})`);
  gradient.addColorStop(0.84, `rgba(140,100,200,${(0.55 * clampedAlpha).toFixed(3)})`);
  gradient.addColorStop(1, "rgba(140,100,200,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(-halfLength, -halfWidth, length, width);

  ctx.fillStyle = `rgba(240,232,255,${(0.35 * clampedAlpha).toFixed(3)})`;
  ctx.fillRect(-length * 0.16, -width * 0.18, length * 0.32, width * 0.36);

  ctx.restore();
}

/** Find the segment index and t value for the point on the trace closest to (px, py). */
function findClosestSegment(trace, px, py) {
  let bestSeg = 0;
  let bestT = 0;
  let bestDist = Infinity;
  const pts = trace.points;
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i].x, ay = pts[i].y;
    const bx = pts[i + 1].x, by = pts[i + 1].y;
    const dx = bx - ax, dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    let t = 0;
    if (lenSq > 0) {
      t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
    }
    const projX = ax + t * dx;
    const projY = ay + t * dy;
    const d = dist(px, py, projX, projY);
    if (d < bestDist) {
      bestDist = d;
      bestSeg = i;
      bestT = t;
    }
  }
  return { segmentIndex: bestSeg, t: bestT };
}

/** Get position on trace at given segment index and t. */
function positionOnTrace(trace, segmentIndex, t) {
  const pts = trace.points;
  const si = Math.min(segmentIndex, pts.length - 2);
  const a = pts[si];
  const b = pts[si + 1];
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  };
}

/** Length of a segment. */
function segmentLength(trace, segmentIndex) {
  const pts = trace.points;
  const si = Math.min(segmentIndex, pts.length - 2);
  const a = pts[si];
  const b = pts[si + 1];
  return dist(a.x, a.y, b.x, b.y);
}

function chooseSegmentDirection(trace, segmentIndex, targetX, targetY) {
  const pts = trace.points;
  const si = Math.max(0, Math.min(segmentIndex, pts.length - 2));
  const startPt = pts[si];
  const endPt = pts[si + 1];
  const dStart = dist(startPt.x, startPt.y, targetX, targetY);
  const dEnd = dist(endPt.x, endPt.y, targetX, targetY);
  return dEnd < dStart ? 1 : -1;
}

// ─── Component ─────────────────────────────────────────────────────────────────

export default function CircuitBoard({ mobile = false, convergeTo = null }) {
  const canvasRef = useRef(null);
  const ctxRef = useRef(null);
  const dataRef = useRef(null);
  const particlesRef = useRef([]);
  const lastSpawnTimeRef = useRef(0);
  const lastFrameTimeRef = useRef(0);
  const animFrameRef = useRef(null);
  const convergeToRef = useRef(convergeTo);
  const dprRef = useRef(1);

  // Keep convergeToRef in sync with prop
  useEffect(() => {
    convergeToRef.current = convergeTo;
  }, [convergeTo]);

  // ── Animated draw (desktop) ──────────────────────────────────────────────────

  const drawAnimated = useCallback((ctx, data, dpr, now, dt) => {
    const { traces, pads, vias } = data;
    const converge = convergeToRef.current;

    const w = ctx.canvas.width / dpr;
    const h = ctx.canvas.height / dpr;

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    // Passive ambient energy sweep across the board
    const ambient = ambientSweep(now, w, h);
    const secondaryAmbient = {
      x: w * 0.5 + Math.sin(now * 0.00011) * w * 0.42,
      y: h * 0.5 + Math.cos(now * 0.00019) * h * 0.36,
      strength: 0.45,
    };
    const ambientRadius = converge ? AMBIENT_SWEEP_RADIUS * 1.2 : AMBIENT_SWEEP_RADIUS;

    // ── Draw traces with passive ambient brightness sweeps ────────────────
    ctx.lineWidth = LINE_WIDTH;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    for (const trace of traces) {
      if (trace.points.length < 2) continue;

      let color = TRACE_COLOR_DESKTOP;
      let colorFactor =
        traceInfluenceFactor(trace, ambient.x, ambient.y, ambientRadius) * ambient.strength;
      colorFactor = Math.max(
        colorFactor,
        traceInfluenceFactor(trace, secondaryAmbient.x, secondaryAmbient.y, ambientRadius * 0.82) *
          secondaryAmbient.strength
      );
      if (colorFactor > 0) {
        color = traceColorInterp(Math.min(colorFactor, 1));
      }

      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(trace.points[0].x, trace.points[0].y);
      for (let i = 1; i < trace.points.length; i++) {
        ctx.lineTo(trace.points[i].x, trace.points[i].y);
      }
      ctx.stroke();
    }

    // ── Draw pads with passive ambient brightness ─────────────────────────
    for (const pad of pads) {
      let color = TRACE_COLOR_DESKTOP;
      let colorFactor = 0;
      const dAmbient = dist(ambient.x, ambient.y, pad.x, pad.y);
      if (dAmbient < ambientRadius) {
        colorFactor = Math.max(
          colorFactor,
          (1 - dAmbient / ambientRadius) * ambient.strength
        );
      }
      const dSecondary = dist(secondaryAmbient.x, secondaryAmbient.y, pad.x, pad.y);
      if (dSecondary < ambientRadius * 0.82) {
        colorFactor = Math.max(
          colorFactor,
          (1 - dSecondary / (ambientRadius * 0.82)) * secondaryAmbient.strength
        );
      }
      if (colorFactor > 0) {
        color = traceColorInterp(Math.min(colorFactor, 1));
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = LINE_WIDTH;
      ctx.beginPath();
      ctx.arc(pad.x, pad.y, pad.radius, 0, Math.PI * 2);
      ctx.stroke();
    }

    // ── Draw vias with passive ambient brightness ─────────────────────────
    for (const via of vias) {
      let color = TRACE_COLOR_DESKTOP;
      let colorFactor = 0;
      const dAmbient = dist(ambient.x, ambient.y, via.x, via.y);
      if (dAmbient < ambientRadius) {
        colorFactor = Math.max(
          colorFactor,
          (1 - dAmbient / ambientRadius) * ambient.strength
        );
      }
      const dSecondary = dist(secondaryAmbient.x, secondaryAmbient.y, via.x, via.y);
      if (dSecondary < ambientRadius * 0.82) {
        colorFactor = Math.max(
          colorFactor,
          (1 - dSecondary / (ambientRadius * 0.82)) * secondaryAmbient.strength
        );
      }
      if (colorFactor > 0) {
        color = traceColorInterp(Math.min(colorFactor, 1));
      }
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(via.x, via.y, via.radius, 0, Math.PI * 2);
      ctx.fill();
    }

    // ── Spawn particles ───────────────────────────────────────────────────
    const particles = particlesRef.current;
    const spawnInterval = converge ? SPAWN_INTERVAL_CONVERGE : SPAWN_INTERVAL;

    if (
      now - lastSpawnTimeRef.current > spawnInterval &&
      particles.length < MAX_PARTICLES &&
      pads.length > 0
    ) {
      lastSpawnTimeRef.current = now;

      const sourcePad = pads[Math.floor(Math.random() * pads.length)];
      if (sourcePad.traceIndices.length > 0) {
        const traceIdx = sourcePad.traceIndices[Math.floor(Math.random() * sourcePad.traceIndices.length)];
        const trace = traces[traceIdx];
        const { segmentIndex, t } = findClosestSegment(trace, sourcePad.x, sourcePad.y);

        let targetX = sourcePad.x;
        let targetY = sourcePad.y;
        if (converge) {
          targetX = converge.x;
          targetY = converge.y;
        } else if (pads.length > 1) {
          let targetPad = pads[Math.floor(Math.random() * pads.length)];
          let guard = 0;
          while (targetPad === sourcePad && guard < 6) {
            targetPad = pads[Math.floor(Math.random() * pads.length)];
            guard++;
          }
          targetX = targetPad.x + (Math.random() - 0.5) * 16;
          targetY = targetPad.y + (Math.random() - 0.5) * 16;
        } else {
          const angle = Math.random() * Math.PI * 2;
          targetX = sourcePad.x + Math.cos(angle) * 700;
          targetY = sourcePad.y + Math.sin(angle) * 700;
        }

        const initialDir = chooseSegmentDirection(trace, segmentIndex, targetX, targetY);
        const startT = initialDir > 0 ? Math.min(0.03, Math.max(0, t)) : Math.max(0.97, Math.min(1, t));
        particles.push(
          createParticle(
            sourcePad.x,
            sourcePad.y,
            traceIdx,
            segmentIndex,
            startT,
            targetX,
            targetY,
            false,
            initialDir
          )
        );
      }
    }

    // ── Update and draw particles ─────────────────────────────────────────
    const dtSec = dt / 1000;
    let i = 0;
    while (i < particles.length) {
      const p = particles[i];
      p.age += dt;

      // Advance along trace
      const trace = traces[p.traceIndex];
      if (!trace) {
        particles.splice(i, 1);
        continue;
      }

      const sLen = segmentLength(trace, p.segmentIndex);
      if (sLen > 0) {
        const tAdvance = (p.speed * dtSec) / sLen;
        p.t += p.dir * tAdvance;
      }

      // Handle segment transitions
      if (p.dir > 0 && p.t >= 1) {
        p.t = 0;
        p.segmentIndex += 1;
        if (p.segmentIndex >= trace.points.length - 1) {
          // Reached end of trace — try to find connected trace via pad adjacency
          const endPadIndices = trace.padIndices;
          let jumped = false;
          for (const pi of endPadIndices) {
            const pad = pads[pi];
            // Find a different trace that's closer to the target
            for (const ti of pad.traceIndices) {
              if (ti === p.traceIndex) continue;
              const nextTrace = traces[ti];
              const nextDist = pointToTraceDist(p.targetX, p.targetY, nextTrace);
              const curDist = dist(p.x, p.y, p.targetX, p.targetY);
              if (nextDist < curDist) {
                p.traceIndex = ti;
                const closest = findClosestSegment(nextTrace, pad.x, pad.y);
                p.segmentIndex = closest.segmentIndex;
                p.dir = chooseSegmentDirection(nextTrace, p.segmentIndex, p.targetX, p.targetY);
                p.t = p.dir > 0 ? Math.min(0.03, Math.max(0, closest.t)) : Math.max(0.97, Math.min(1, closest.t));
                jumped = true;
                break;
              }
            }
            if (jumped) break;
          }
          if (!jumped) {
            // No connected trace closer to target — remove particle
            particles.splice(i, 1);
            continue;
          }
        }
      } else if (p.dir < 0 && p.t <= 0) {
        p.t = 1;
        p.segmentIndex -= 1;
        if (p.segmentIndex < 0) {
          // Reached start of trace — try to find connected trace via pad adjacency
          const startPadIndices = trace.padIndices;
          let jumped = false;
          for (const pi of startPadIndices) {
            const pad = pads[pi];
            for (const ti of pad.traceIndices) {
              if (ti === p.traceIndex) continue;
              const nextTrace = traces[ti];
              const nextDist = pointToTraceDist(p.targetX, p.targetY, nextTrace);
              const curDist = dist(p.x, p.y, p.targetX, p.targetY);
              if (nextDist < curDist) {
                p.traceIndex = ti;
                const closest = findClosestSegment(nextTrace, pad.x, pad.y);
                p.segmentIndex = closest.segmentIndex;
                p.dir = chooseSegmentDirection(nextTrace, p.segmentIndex, p.targetX, p.targetY);
                p.t = p.dir > 0 ? Math.min(0.03, Math.max(0, closest.t)) : Math.max(0.97, Math.min(1, closest.t));
                jumped = true;
                break;
              }
            }
            if (jumped) break;
          }
          if (!jumped) {
            particles.splice(i, 1);
            continue;
          }
        }
      }

      // Update position
      const currentTrace = traces[p.traceIndex];
      if (currentTrace) {
        p.prevX = p.x;
        p.prevY = p.y;
        const pos = positionOnTrace(currentTrace, p.segmentIndex, p.t);
        p.x = pos.x;
        p.y = pos.y;
        const moveDx = p.x - p.prevX;
        const moveDy = p.y - p.prevY;
        if (moveDx * moveDx + moveDy * moveDy > 0.0001) {
          p.angle = Math.atan2(moveDy, moveDx);
        }
      }

      // Remove if close to target or too old
      const dToTarget = dist(p.x, p.y, p.targetX, p.targetY);
      if (dToTarget < PARTICLE_ARRIVE_DIST || p.age > PARTICLE_MAX_AGE) {
        particles.splice(i, 1);
        continue;
      }

      // Fade opacity as approaching target
      const baseOpacity = p.idle ? 0.35 : 0.9;
      p.opacity = baseOpacity;
      if (dToTarget < PARTICLE_FADE_START) {
        p.opacity = baseOpacity * (dToTarget / PARTICLE_FADE_START);
      }
      const pulse = 0.82 + 0.18 * Math.sin((now + p.age * 3) * 0.014);
      drawParticlePacket(ctx, p, p.opacity * pulse);

      i++;
    }

    ctx.restore();
  }, []);

  // ── Generate and start/stop loop ─────────────────────────────────────────────

  const generate = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    dprRef.current = dpr;
    const w = window.innerWidth;
    const h = window.innerHeight;

    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;

    const data = generateTraces(w, h);
    dataRef.current = data;

    // Cache canvas context in ref
    ctxRef.current = canvas.getContext("2d");

    // Reset particles on regenerate
    particlesRef.current = [];

    if (mobile) {
      // Static draw for mobile
      drawCircuitBoard(ctxRef.current, data, TRACE_COLOR_MOBILE, dpr);
    }
    // For desktop, the animation loop handles drawing
  }, [mobile]);

  useEffect(() => {
    // Capture canvas ref at the start of the effect to avoid stale closures in cleanup
    const canvas = canvasRef.current;

    generate();

    let resizeTimeout;
    const onResize = (() => {
      let timeout;
      return () => {
        clearTimeout(timeout);
        timeout = setTimeout(generate, 150);
        resizeTimeout = timeout;
      };
    })();
    window.addEventListener("resize", onResize);

    // ── Animation loop (desktop only) ─────────────────────────────────────
    if (!mobile) {
      lastFrameTimeRef.current = performance.now();

      const loop = (timestamp) => {
        const data = dataRef.current;
        if (!canvas || !data) {
          animFrameRef.current = requestAnimationFrame(loop);
          return;
        }

        const dt = timestamp - lastFrameTimeRef.current;
        lastFrameTimeRef.current = timestamp;

        // Clamp dt to avoid huge jumps (e.g. after tab switch)
        const clampedDt = Math.min(dt, 100);

        const ctx = ctxRef.current;
        if (!ctx) {
          animFrameRef.current = requestAnimationFrame(loop);
          return;
        }
        const dpr = dprRef.current;
        drawAnimated(ctx, data, dpr, Date.now(), clampedDt);

        animFrameRef.current = requestAnimationFrame(loop);
      };

      animFrameRef.current = requestAnimationFrame(loop);
    }

    return () => {
      window.removeEventListener("resize", onResize);
      clearTimeout(resizeTimeout);
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
    };
  }, [generate, mobile, drawAnimated]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 0,
        pointerEvents: "none",
      }}
    />
  );
}
