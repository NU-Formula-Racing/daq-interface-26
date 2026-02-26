import { useRef, useEffect, useCallback } from "react";

const CELL_SIZE = 100;
const TRACE_COLOR_DESKTOP = "rgba(255,255,255,0.22)";
const TRACE_COLOR_MOBILE = "rgba(255,255,255,0.25)";
const LINE_WIDTH = 1.5;
const PAD_RADIUS = 4;
const VIA_RADIUS = 2;

const INFLUENCE_RADIUS = 180;
const MAX_PARTICLES = 30;
const PARTICLE_MAX_AGE = 2000; // ms
const PARTICLE_SPEED = 250; // px/sec
const SPAWN_INTERVAL = 80; // ms
const SPAWN_INTERVAL_IDLE = 500; // ms
const SPAWN_INTERVAL_CONVERGE = 40; // ms
const IDLE_TIMEOUT = 3000; // ms
const SPAWN_RADIUS = 250; // px — find pads within this distance of cursor
const TRAIL_LENGTH = 4;
const PARTICLE_ARRIVE_DIST = 10; // px
const PARTICLE_FADE_START = 50; // px — start fading within this distance of target
const TRAIL_OPACITIES = [0.15, 0.3, 0.5];
const TRAIL_RADII = [1, 1.5, 1.8];

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
  const rng = createRng(42);

  const cols = Math.ceil(width / CELL_SIZE);
  const rows = Math.ceil(height / CELL_SIZE);
  const cx = width / 2;
  const cy = height / 2;
  const maxDist = Math.sqrt(cx * cx + cy * cy);

  const traces = [];
  const pads = [];
  const vias = [];

  // Helper: distance-from-center probability weighting
  // Cells near center have higher probability of spawning a trace.
  const spawnProbability = (col, row) => {
    const cellX = (col + 0.5) * CELL_SIZE;
    const cellY = (row + 0.5) * CELL_SIZE;
    const dist = Math.sqrt((cellX - cx) ** 2 + (cellY - cy) ** 2);
    const normalized = dist / maxDist; // 0 = center, 1 = corner
    // Higher probability near center, tapering toward edges
    return 0.45 * (1 - normalized * 0.7);
  };

  // Directions: 0 = right, 1 = down, 2 = left, 3 = up
  const dirVectors = [
    { dx: 1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: -1 },
  ];

  // 45-degree bend directions relative to primary direction
  const bendOffsets = [1, -1]; // turn clockwise or counter-clockwise

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (rng() > spawnProbability(col, row)) continue;

      // Starting point: center of cell with slight jitter
      const startX = (col + 0.5) * CELL_SIZE + (rng() - 0.5) * CELL_SIZE * 0.4;
      const startY = (row + 0.5) * CELL_SIZE + (rng() - 0.5) * CELL_SIZE * 0.4;

      // Pick a primary direction
      const dirIdx = Math.floor(rng() * 4);
      const dir = dirVectors[dirIdx];

      // First segment: extend 1-4 cells
      const seg1Len = (1 + Math.floor(rng() * 4)) * CELL_SIZE;
      const midX = startX + dir.dx * seg1Len;
      const midY = startY + dir.dy * seg1Len;

      const points = [{ x: startX, y: startY }, { x: midX, y: midY }];

      // Optionally add a 45-degree bend and second segment
      if (rng() < 0.65) {
        const bendDir = bendOffsets[Math.floor(rng() * 2)];
        const newDirIdx = (dirIdx + bendDir + 4) % 4;
        const newDir = dirVectors[newDirIdx];

        // For 45-degree appearance, we move diagonally for a short distance
        // then continue in the new orthogonal direction
        const diagLen = CELL_SIZE * 0.5;
        const diagX = midX + (dir.dx + newDir.dx) * diagLen * 0.7;
        const diagY = midY + (dir.dy + newDir.dy) * diagLen * 0.7;
        points.push({ x: diagX, y: diagY });

        const seg2Len = (1 + Math.floor(rng() * 3)) * CELL_SIZE;
        const endX = diagX + newDir.dx * seg2Len;
        const endY = diagY + newDir.dy * seg2Len;
        points.push({ x: endX, y: endY });
      }

      const traceIdx = traces.length;
      const tracePadIndices = [];

      // Place pads at start and end of the trace
      const padStart = { x: points[0].x, y: points[0].y, radius: PAD_RADIUS, traceIndices: [traceIdx] };
      tracePadIndices.push(pads.length);
      pads.push(padStart);

      const lastPt = points[points.length - 1];
      const padEnd = { x: lastPt.x, y: lastPt.y, radius: PAD_RADIUS, traceIndices: [traceIdx] };
      tracePadIndices.push(pads.length);
      pads.push(padEnd);

      // Place vias at random points along segments
      for (let i = 0; i < points.length - 1; i++) {
        if (rng() < 0.4) {
          const t = 0.2 + rng() * 0.6; // avoid placing too close to endpoints
          const vx = points[i].x + (points[i + 1].x - points[i].x) * t;
          const vy = points[i].y + (points[i + 1].y - points[i].y) * t;
          vias.push({ x: vx, y: vy, radius: VIA_RADIUS });
        }
      }

      traces.push({ points, padIndices: tracePadIndices });
    }
  }

  // Build adjacency: check if any pads from different traces are close enough to be "connected"
  const CONNECT_THRESHOLD = CELL_SIZE * 0.3;
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

// ─── Particle helpers ──────────────────────────────────────────────────────────

function createParticle(x, y, traceIndex, segmentIndex, t, targetX, targetY, idle) {
  return {
    x,
    y,
    targetX,
    targetY,
    traceIndex,
    segmentIndex,
    t,
    speed: PARTICLE_SPEED,
    opacity: idle ? 0.3 : 0.8,
    trail: [],
    age: 0,
    idle,
  };
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

// ─── Component ─────────────────────────────────────────────────────────────────

export default function CircuitBoard({ mobile = false, convergeTo = null }) {
  const canvasRef = useRef(null);
  const ctxRef = useRef(null);
  const dataRef = useRef(null);
  const mouseRef = useRef({ x: -9999, y: -9999 });
  const lastMoveTimeRef = useRef(0);
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
    const mouse = mouseRef.current;
    const lastMove = lastMoveTimeRef.current;
    const isIdle = now - lastMove > IDLE_TIMEOUT;
    const converge = convergeToRef.current;

    const w = ctx.canvas.width / dpr;
    const h = ctx.canvas.height / dpr;

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    // Determine the point for proximity brightening
    const brightX = mouse.x;
    const brightY = mouse.y;

    // ── Draw traces with proximity-based brightness ───────────────────────
    ctx.lineWidth = LINE_WIDTH;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    for (const trace of traces) {
      if (trace.points.length < 2) continue;

      let color = TRACE_COLOR_DESKTOP;

      if (!isIdle) {
        // Quick bounding box check
        const bb = trace.bbox;
        const outsideBB =
          brightX < bb.minX - INFLUENCE_RADIUS ||
          brightX > bb.maxX + INFLUENCE_RADIUS ||
          brightY < bb.minY - INFLUENCE_RADIUS ||
          brightY > bb.maxY + INFLUENCE_RADIUS;

        if (!outsideBB) {
          const d = pointToTraceDist(brightX, brightY, trace);
          if (d < INFLUENCE_RADIUS) {
            const factor = 1 - d / INFLUENCE_RADIUS;
            color = traceColorInterp(factor);
          }
        }
      }

      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(trace.points[0].x, trace.points[0].y);
      for (let i = 1; i < trace.points.length; i++) {
        ctx.lineTo(trace.points[i].x, trace.points[i].y);
      }
      ctx.stroke();
    }

    // ── Draw pads with proximity brightness ───────────────────────────────
    for (const pad of pads) {
      let color = TRACE_COLOR_DESKTOP;
      if (!isIdle) {
        const d = dist(brightX, brightY, pad.x, pad.y);
        if (d < INFLUENCE_RADIUS) {
          const factor = 1 - d / INFLUENCE_RADIUS;
          color = traceColorInterp(factor);
        }
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = LINE_WIDTH;
      ctx.beginPath();
      ctx.arc(pad.x, pad.y, pad.radius, 0, Math.PI * 2);
      ctx.stroke();
    }

    // ── Draw vias with proximity brightness ───────────────────────────────
    for (const via of vias) {
      let color = TRACE_COLOR_DESKTOP;
      if (!isIdle) {
        const d = dist(brightX, brightY, via.x, via.y);
        if (d < INFLUENCE_RADIUS) {
          const factor = 1 - d / INFLUENCE_RADIUS;
          color = traceColorInterp(factor);
        }
      }
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(via.x, via.y, via.radius, 0, Math.PI * 2);
      ctx.fill();
    }

    // ── Spawn particles ───────────────────────────────────────────────────
    const particles = particlesRef.current;
    let spawnInterval = SPAWN_INTERVAL;
    if (converge) {
      spawnInterval = SPAWN_INTERVAL_CONVERGE;
    } else if (isIdle) {
      spawnInterval = SPAWN_INTERVAL_IDLE;
    }

    if (now - lastSpawnTimeRef.current > spawnInterval && particles.length < MAX_PARTICLES) {
      lastSpawnTimeRef.current = now;

      if (converge) {
        // Spawn from random pads across the viewport
        if (pads.length > 0) {
          const padIdx = Math.floor(Math.random() * pads.length);
          const pad = pads[padIdx];
          if (pad.traceIndices.length > 0) {
            const traceIdx = pad.traceIndices[Math.floor(Math.random() * pad.traceIndices.length)];
            const trace = traces[traceIdx];
            const { segmentIndex, t } = findClosestSegment(trace, pad.x, pad.y);
            particles.push(
              createParticle(pad.x, pad.y, traceIdx, segmentIndex, t, converge.x, converge.y, false)
            );
          }
        }
      } else if (isIdle) {
        // Spawn at random pads, travel in random direction
        if (pads.length > 0) {
          const padIdx = Math.floor(Math.random() * pads.length);
          const pad = pads[padIdx];
          if (pad.traceIndices.length > 0) {
            const traceIdx = pad.traceIndices[Math.floor(Math.random() * pad.traceIndices.length)];
            const trace = traces[traceIdx];
            const { segmentIndex, t } = findClosestSegment(trace, pad.x, pad.y);
            // Random target far away
            const angle = Math.random() * Math.PI * 2;
            const targetX = pad.x + Math.cos(angle) * 1000;
            const targetY = pad.y + Math.sin(angle) * 1000;
            particles.push(
              createParticle(pad.x, pad.y, traceIdx, segmentIndex, t, targetX, targetY, true)
            );
          }
        }
      } else {
        // Spawn from pads near cursor
        const nearbyPads = [];
        for (let i = 0; i < pads.length; i++) {
          const d = dist(mouse.x, mouse.y, pads[i].x, pads[i].y);
          if (d < SPAWN_RADIUS && pads[i].traceIndices.length > 0) {
            nearbyPads.push(i);
          }
        }
        if (nearbyPads.length > 0) {
          const padIdx = nearbyPads[Math.floor(Math.random() * nearbyPads.length)];
          const pad = pads[padIdx];
          const traceIdx = pad.traceIndices[Math.floor(Math.random() * pad.traceIndices.length)];
          const trace = traces[traceIdx];
          const { segmentIndex, t } = findClosestSegment(trace, pad.x, pad.y);
          particles.push(
            createParticle(pad.x, pad.y, traceIdx, segmentIndex, t, mouse.x, mouse.y, false)
          );
        }
      }
    }

    // ── Update and draw particles ─────────────────────────────────────────
    const dtSec = dt / 1000;
    let i = 0;
    while (i < particles.length) {
      const p = particles[i];
      p.age += dt;

      // Update target for non-idle, non-converge particles (follow mouse)
      if (!p.idle && !converge) {
        p.targetX = mouse.x;
        p.targetY = mouse.y;
      }

      // Store trail
      p.trail.push({ x: p.x, y: p.y });
      if (p.trail.length > TRAIL_LENGTH) {
        p.trail.shift();
      }

      // Advance along trace
      const trace = traces[p.traceIndex];
      if (!trace) {
        particles.splice(i, 1);
        continue;
      }

      const sLen = segmentLength(trace, p.segmentIndex);
      if (sLen > 0) {
        // Determine direction: which end of segment is closer to target?
        const pts = trace.points;
        const si = Math.min(p.segmentIndex, pts.length - 2);
        const startPt = pts[si];
        const endPt = pts[si + 1];
        const dStart = dist(startPt.x, startPt.y, p.targetX, p.targetY);
        const dEnd = dist(endPt.x, endPt.y, p.targetX, p.targetY);
        const direction = dEnd < dStart ? 1 : -1;

        const tAdvance = (p.speed * dtSec) / sLen;
        p.t += direction * tAdvance;
      }

      // Handle segment transitions
      if (p.t >= 1) {
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
                p.t = closest.t;
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
      } else if (p.t <= 0) {
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
                p.t = closest.t;
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
        const pos = positionOnTrace(currentTrace, p.segmentIndex, p.t);
        p.x = pos.x;
        p.y = pos.y;
      }

      // Remove if close to target or too old
      const dToTarget = dist(p.x, p.y, p.targetX, p.targetY);
      if (dToTarget < PARTICLE_ARRIVE_DIST || p.age > PARTICLE_MAX_AGE) {
        particles.splice(i, 1);
        continue;
      }

      // Fade opacity as approaching target
      if (dToTarget < PARTICLE_FADE_START) {
        p.opacity = (p.idle ? 0.3 : 0.8) * (dToTarget / PARTICLE_FADE_START);
      }

      // ── Render particle trail ─────────────────────────────────────────
      for (let ti = 0; ti < p.trail.length; ti++) {
        const trailPt = p.trail[ti];
        // Map trail index: trail[0] is oldest, trail[length-1] is newest
        const reverseIdx = p.trail.length - 1 - ti;
        if (reverseIdx >= TRAIL_OPACITIES.length) continue;
        const opMult = TRAIL_OPACITIES[TRAIL_OPACITIES.length - 1 - reverseIdx];
        const rad = TRAIL_RADII[TRAIL_RADII.length - 1 - reverseIdx];
        ctx.fillStyle = `rgba(140,100,200,${(opMult * p.opacity).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(trailPt.x, trailPt.y, rad, 0, Math.PI * 2);
        ctx.fill();
      }

      // ── Render particle dot ───────────────────────────────────────────
      ctx.fillStyle = `rgba(140,100,200,${p.opacity.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
      ctx.fill();

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

    // ── Mouse tracking (desktop only) ─────────────────────────────────────
    let onMouseMove = null;
    if (!mobile) {
      onMouseMove = (e) => {
        mouseRef.current = { x: e.clientX, y: e.clientY };
        lastMoveTimeRef.current = Date.now();
      };
      window.addEventListener("mousemove", onMouseMove);
    }

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
      if (onMouseMove) {
        window.removeEventListener("mousemove", onMouseMove);
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
