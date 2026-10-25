import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { seededRng } from '../logic/gacha';
import {
  describeReward,
  expeditionStatus,
  MAP_LENGTH,
  MAP_NODES,
  REGIONS,
  type MapNode,
  type Region,
} from '../logic/expedition';
import { useStore } from '../store';
import { fmt } from './common';

// ---------------------------------------------------------------- geometry
// The map is one tall drawing: the route climbs from the Outskirts (bottom) to the Endgame (top),
// with distance along it proportional to points.

const W = 360;
const PAD_TOP = 70;
const PAD_BOTTOM = 56;
const PX_PER_POINT = 0.15;
const H = PAD_TOP + PAD_BOTTOM + MAP_LENGTH * PX_PER_POINT;

function y(points: number): number {
  return PAD_TOP + (MAP_LENGTH - points) * PX_PER_POINT;
}

/** The route winds left and right as it climbs. */
function x(points: number): number {
  const wide = Math.sin((2 * Math.PI * points) / 1350 + 0.6);
  const narrow = Math.sin((2 * Math.PI * points) / 470 + 1.7);
  return W / 2 + 92 * wide + 26 * narrow;
}

function at(points: number): [number, number] {
  return [x(points), y(points)];
}

function routePath(from: number, to: number): string {
  const step = 20;
  const pts: string[] = [];
  for (let p = from; p < to; p += step) pts.push(at(p).map((v) => v.toFixed(1)).join(' '));
  pts.push(at(to).map((v) => v.toFixed(1)).join(' '));
  return `M${pts.join(' L')}`;
}

function diamond(cx: number, cy: number, r: number): string {
  return `${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}`;
}

// ---------------------------------------------------------------- terrain (original, procedural)

type Shape = { kind: 'path' | 'polygon'; d: string; cls: string };

/** Decorations for a region's band, kept clear of the route, seeded so they never move. */
function terrain(region: Region): Shape[] {
  const rng = seededRng(7919 * (region.index + 1));
  const shapes: Shape[] = [];
  const top = y(region.end);
  const bottom = y(region.start);
  const count = Math.round((bottom - top) / 34);

  // Faint contour lines across the band.
  for (let i = 1; i < Math.max(3, count / 2); i++) {
    const cy = top + ((bottom - top) * i) / Math.max(3, count / 2);
    const amp = 4 + rng() * 6;
    const phase = rng() * 6;
    let d = `M0 ${cy.toFixed(1)}`;
    for (let px = 12; px <= W; px += 12) d += ` L${px} ${(cy + amp * Math.sin(px / 40 + phase)).toFixed(1)}`;
    shapes.push({ kind: 'path', d, cls: 'contour' });
  }

  for (let i = 0; i < count; i++) {
    const cy = top + 16 + rng() * (bottom - top - 32);
    const points = MAP_LENGTH - (cy - PAD_TOP) / PX_PER_POINT;
    const rx = x(points);
    // Put it on whichever side has more room, at least 34 units from the route.
    const left = rx > W / 2;
    const span = left ? rx - 34 - 14 : W - 14 - (rx + 34);
    if (span < 24) continue;
    const cx = left ? 14 + rng() * span : rx + 34 + rng() * span;
    const s = 0.7 + rng() * 0.6;

    switch (region.index) {
      case 0: // Outskirts: low hills and outposts
        if (rng() < 0.65) {
          const w = 34 * s;
          shapes.push({ kind: 'path', d: `M${cx - w} ${cy} Q${cx} ${cy - 18 * s} ${cx + w} ${cy}`, cls: 'hill' });
        } else {
          const w = 7 * s;
          shapes.push({
            kind: 'polygon',
            d: `${cx - w},${cy} ${cx - w},${cy - 8 * s} ${cx},${cy - 13 * s} ${cx + w},${cy - 8 * s} ${cx + w},${cy}`,
            cls: 'outpost',
          });
        }
        break;
      case 1: {
        // Badlands: mesas and cracks
        if (rng() < 0.7) {
          const w = 26 * s;
          const h = 13 * s;
          shapes.push({
            kind: 'polygon',
            d: `${cx - w},${cy} ${cx - w * 0.6},${cy - h} ${cx + w * 0.6},${cy - h} ${cx + w},${cy}`,
            cls: 'mesa',
          });
        } else {
          shapes.push({
            kind: 'path',
            d: `M${cx - 16 * s} ${cy} l${8 * s} ${-4 * s} l${6 * s} ${5 * s} l${9 * s} ${-6 * s} l${7 * s} ${3 * s}`,
            cls: 'crack',
          });
        }
        break;
      }
      case 2: {
        // Deep Frontier: ridges of pines
        const n = 2 + Math.floor(rng() * 3);
        for (let k = 0; k < n; k++) {
          const px = cx + (k - n / 2) * 9 * s;
          const h = (14 + rng() * 8) * s;
          shapes.push({ kind: 'polygon', d: `${px - 5 * s},${cy} ${px},${cy - h} ${px + 5 * s},${cy}`, cls: 'pine' });
        }
        break;
      }
      case 3: {
        // The Wall: jagged cliff strata
        let d = `M${cx - 30 * s} ${cy}`;
        for (let k = 1; k <= 6; k++) d += ` L${cx - 30 * s + k * 10 * s} ${cy - (k % 2 ? 10 : 3) * s - rng() * 4}`;
        shapes.push({ kind: 'path', d, cls: 'strata' });
        break;
      }
      default: {
        // Endgame: crystal spires
        const h = (18 + rng() * 14) * s;
        const w = 4.5 * s;
        shapes.push({ kind: 'polygon', d: `${cx},${cy - h} ${cx + w},${cy - h * 0.25} ${cx},${cy} ${cx - w},${cy - h * 0.25}`, cls: 'spire' });
      }
    }
  }
  return shapes;
}

const TERRAIN = REGIONS.map(terrain);
const FULL_ROUTE = routePath(0, MAP_LENGTH);

// ---------------------------------------------------------------- component

function nodeKindName(node: MapNode): string {
  return node.kind === 'cache' ? 'Cache' : node.kind === 'node' ? 'Node' : node.kind === 'final' ? 'Expedition end' : 'Region end';
}

/** The expedition route drawn as a frontier map, plus a summary of where you stand. */
export function ExpeditionMap() {
  const state = useStore();
  const status = expeditionStatus(state);
  const scroller = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const position = status?.position ?? 0;
  const travelled = useMemo(() => (position > 0 ? routePath(0, position) : ''), [position]);

  // Open scrolled to where you are.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const scale = el.clientWidth / W;
    el.scrollTop = Math.max(0, y(position) * scale - el.clientHeight * 0.55);
  }, []);

  if (!status) return null;
  const { nextNode, gate, banked, rank } = status;
  const pct = Math.min(100, (position / MAP_LENGTH) * 100);
  const focus = MAP_NODES.find((n) => n.index === selected) ?? nextNode;
  // The next gate you haven't met, drawn as a barrier across the route.
  const nextGate = REGIONS.find((r) => r.minRank > rank && r.start >= position);
  const [mx, my] = at(position);

  return (
    <section class="panel expedition">
      <div class="row between">
        <h3 class="section-label">Expedition map</h3>
        <span class="mono small muted">
          {fmt(position)} / {fmt(MAP_LENGTH)}
        </span>
      </div>
      <div class="meter" aria-label={`Expedition ${Math.round(pct)}% complete`}>
        <i style={{ width: `${pct}%` }} />
      </div>

      {status.complete ? (
        <p class="map-next done">Expedition complete. Every node claimed.</p>
      ) : gate ? (
        <p class="map-next gated">
          <b>
            Gate: {gate.name} needs Rank {gate.minRank}
          </b>{' '}
          (you're Rank {rank}).{' '}
          {banked > 0
            ? `${fmt(banked)} points are banked and move you forward as soon as your rank allows.`
            : 'Points you earn now are banked until your rank allows.'}
        </p>
      ) : (
        nextNode && (
          <p class="map-next">
            Next: <b>{describeReward(nextNode)}</b> in {fmt(nextNode.at - position)} points.
          </p>
        )
      )}

      <div class="map-window" ref={scroller}>
        <svg
          class="frontier"
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`Expedition map: ${fmt(position)} of ${fmt(MAP_LENGTH)} points, in ${status.region.name}.`}
        >
          <defs>
            <pattern id="hazard" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="5" height="10" class="hazard-a" />
              <rect x="5" width="5" height="10" class="hazard-b" />
            </pattern>
          </defs>

          {REGIONS.map((region) => {
            const top = y(region.end);
            const bottom = y(region.start);
            const cleared = position >= region.end;
            const locked = rank < region.minRank && !cleared;
            return (
              <g key={region.index} class={`band band-${region.index} ${cleared ? 'cleared' : locked ? 'locked' : ''}`}>
                <rect x="0" y={top} width={W} height={bottom - top} class="band-fill" />
                {TERRAIN[region.index].map((shape, i) =>
                  shape.kind === 'path' ? (
                    <path key={i} d={shape.d} class={`terrain ${shape.cls}`} />
                  ) : (
                    <polygon key={i} points={shape.d} class={`terrain ${shape.cls}`} />
                  ),
                )}
                <line x1="0" x2={W} y1={bottom} y2={bottom} class="band-edge" />
                <text x="10" y={bottom - 10} class="band-label">
                  {String(region.index + 1).padStart(2, '0')} {region.name.toUpperCase()}
                </text>
                <text x="10" y={bottom - 24} class={`band-rank ${locked ? 'locked' : ''}`}>
                  {cleared ? 'CLEARED' : `RANK ${region.minRank}+`}
                </text>
              </g>
            );
          })}

          {/* The beacon at the end of the route. */}
          <g class="beacon" transform={`translate(${x(MAP_LENGTH)} ${y(MAP_LENGTH) - 30})`}>
            <polygon points="0,-22 7,0 0,8 -7,0" />
            <line x1="0" y1="8" x2="0" y2="22" />
          </g>

          <path d={FULL_ROUTE} class="route" />
          {travelled && <path d={travelled} class="route-done" />}

          {nextGate && (
            <g class="gate" transform={`translate(${x(nextGate.start)} ${y(nextGate.start)})`}>
              <rect x="-34" y="-5" width="68" height="10" fill="url(#hazard)" />
              <text
                x={x(nextGate.start) > W / 2 ? -40 : 40}
                y="4"
                class="gate-label"
                text-anchor={x(nextGate.start) > W / 2 ? 'end' : 'start'}
              >
                RANK {nextGate.minRank} GATE
              </text>
            </g>
          )}

          {MAP_NODES.map((n) => {
            const [nx, ny] = at(n.at);
            const reached = position >= n.at;
            const r = n.selector ? 9 : n.kind === 'cache' ? 6.5 : 5;
            const select = () => setSelected(n.index);
            return (
              <g
                key={n.index}
                class={`node ${n.kind} ${reached ? 'reached' : ''} ${focus?.index === n.index ? 'focus' : ''}`}
                role="button"
                tabIndex={0}
                aria-label={`${nodeKindName(n)} ${n.index}: ${describeReward(n)}${reached ? ', claimed' : ''}`}
                onClick={select}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && select()}
              >
                <circle cx={nx} cy={ny} r={r + 9} class="hit" />
                <polygon points={diamond(nx, ny, r)} />
                {n.selector && (
                  <text x={nx} y={ny + 3.5} class="node-star">
                    {n.selector}
                  </text>
                )}
              </g>
            );
          })}

          {!status.complete && (
            <g class="you" transform={`translate(${mx} ${my})`}>
              <circle r="12" class="you-pulse" />
              <circle r="5.5" class="you-dot" />
            </g>
          )}
        </svg>
      </div>

      {focus && (
        <div class="node-detail">
          <span class={`node-badge ${focus.kind}`}>{nodeKindName(focus)}</span>
          <span class="grow">
            <b>{describeReward(focus)}</b>
            <small class="mono muted">
              {REGIONS[focus.region].name} · node {focus.index} ·{' '}
              {position >= focus.at ? 'claimed' : `${fmt(focus.at - position)} points away`}
            </small>
          </span>
        </div>
      )}
      <p class="hint small">
        Tap a node to see its reward. ◆ Cache · numbered marker: region end (selector rarity). Progress is permanent: a
        lower rank pauses the map but never moves it back.
      </p>
    </section>
  );
}
