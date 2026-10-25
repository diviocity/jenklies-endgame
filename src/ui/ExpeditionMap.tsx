import { describeReward, expeditionStatus, MAP_LENGTH, MAP_NODES, REGIONS, type MapNode, type Region } from '../logic/expedition';
import { useStore } from '../store';
import { fmt } from './common';

const NODE_GLYPH: Record<MapNode['kind'], string> = { node: '', cache: '◆', regionEnd: '★', final: '★' };

function nodeLabel(node: MapNode): string {
  const kind = node.kind === 'cache' ? 'Cache' : node.kind === 'node' ? 'Node' : node.kind === 'final' ? 'Finish' : 'Region end';
  return `${kind} ${node.index} at ${fmt(node.at)}: ${describeReward(node)}`;
}

/** The expedition route: five regions of nodes, with gates, progress and rewards. */
export function ExpeditionMap() {
  const state = useStore();
  const status = expeditionStatus(state);
  if (!status) return null;
  const { position, nextNode, gate, banked } = status;
  const pct = Math.min(100, (position / MAP_LENGTH) * 100);

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
          (you're Rank {status.rank}). {banked > 0 ? `${fmt(banked)} points banked; ` : ''}they move you forward as soon as your rank allows.
        </p>
      ) : (
        nextNode && (
          <p class="map-next">
            Next: <b>{describeReward(nextNode)}</b> in {fmt(nextNode.at - position)} points.
          </p>
        )
      )}

      <ol class="regions">
        {REGIONS.map((region) => (
          <RegionRow key={region.index} region={region} position={position} rank={status.rank} />
        ))}
      </ol>
      <p class="hint small">
        ◆ Cache · ★ Region end. Progress is permanent: a lower rank pauses the map but never moves it back.
      </p>
    </section>
  );
}

function RegionRow({ region, position, rank }: { region: Region; position: number; rank: number }) {
  const nodes = MAP_NODES.filter((n) => n.region === region.index);
  const cleared = position >= region.end;
  const started = position > region.start || (position === region.start && rank >= region.minRank);
  const locked = rank < region.minRank && !cleared;
  const inRegion = Math.min(1, Math.max(0, (position - region.start) / (region.end - region.start)));
  const state = cleared ? 'cleared' : locked ? 'locked' : started ? 'active' : 'ahead';
  const chip = cleared ? 'Cleared' : locked ? `Rank ${region.minRank}+` : started ? `${Math.round(inRegion * 100)}%` : 'Ahead';
  const end = nodes[nodes.length - 1];

  return (
    <li class={`region ${state}`}>
      <div class="region-head">
        <span class="mono region-no">0{region.index + 1}</span>
        <b>{region.name}</b>
        <span class={`region-chip ${state}`}>{chip}</span>
      </div>
      <div class="region-track" role="list" aria-label={`${region.name} nodes`}>
        <i class="region-fill" style={{ width: `${inRegion * 100}%` }} />
        {nodes.map((n) => {
          const reached = position >= n.at;
          const next = !reached && MAP_NODES.find((m) => m.at > position) === n;
          return (
            <span
              key={n.index}
              role="listitem"
              class={`map-node ${n.kind} ${reached ? 'reached' : ''} ${next ? 'next' : ''}`}
              style={{ left: `${((n.at - region.start) / (region.end - region.start)) * 100}%` }}
              title={nodeLabel(n)}
              aria-label={`${nodeLabel(n)}${reached ? ', claimed' : ''}`}
            >
              {NODE_GLYPH[n.kind]}
            </span>
          );
        })}
      </div>
      <small class="mono muted">
        {fmt(region.end - region.start)} pts · end: {describeReward(end)}
      </small>
    </li>
  );
}
