import { useEffect, useState } from 'preact/hooks';
import { BACKUP } from '../config';
import { balances } from '../logic/actions';
import { getMeta } from '../logic/state';
import { dayKeyOf, daysBetween, formatDayKey } from '../logic/time';
import { frontier } from '../logic/event';
import { describeReward, REGIONS } from '../logic/expedition';
import { activeHibernation } from '../logic/hibernation';
import { provisionsAlert } from '../logic/provisions';
import { play } from '../sound';
import { isReady, onExpeditionClaims, useStore } from '../store';
import { Bag } from './Bag';
import { Amount, toast, UiHost, useNow } from './common';
import { Events } from './Events';
import { FocusPill, ForgottenEnd } from './Monumental';
import { wake } from './Hibernation';
import { More } from './More';
import { Pull } from './Pull';
import { Today } from './Today';
import { WeeklyReport } from './WeeklyReport';

type Tab = 'today' | 'pull' | 'bag' | 'events' | 'more';

function parseHash(): string[] {
  return location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
}

function useRoute(): string[] {
  const [route, setRoute] = useState(parseHash);
  useEffect(() => {
    const onChange = () => {
      setRoute(parseHash());
      document.querySelector('main')?.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

const TABS: { id: Tab; label: string; icon: preact.JSX.Element }[] = [
  {
    id: 'today',
    label: 'Today',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 5h3v3H4zM10 6.5h10M4 11h3v3H4zM10 12.5h10M4 17h3v3H4zM10 18.5h10" />
      </svg>
    ),
  },
  {
    id: 'pull',
    label: 'Pull',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 2l9 10-9 10-9-10z" />
        <path d="M12 7l4.5 5-4.5 5-4.5-5z" />
      </svg>
    ),
  },
  {
    id: 'bag',
    label: 'Bag',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 8l9-5 9 5v9l-9 5-9-5z" />
        <path d="M3 8l9 5 9-5M12 13v9" />
      </svg>
    ),
  },
  {
    id: 'events',
    label: 'Events',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 21V3M5 4h12l-3 4 3 4H5" />
        <path d="M9 21l3-5 3 3 4-6" />
      </svg>
    ),
  },
  {
    id: 'more',
    label: 'More',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 6h16M4 12h16M4 18h10" />
      </svg>
    ),
  },
];

function backupDue(lastBackupAt: string | null): boolean {
  return !lastBackupAt || daysBetween(new Date(lastBackupAt), new Date()) >= BACKUP.remindAfterDays;
}

/** Announces expedition nodes as they're reached. */
function useExpeditionToasts() {
  useEffect(
    () =>
      onExpeditionClaims((nodes) => {
        play('clear');
        const big = nodes.filter((n) => n.selector);
        for (const n of big) toast(`${REGIONS[n.region].name} cleared! ${describeReward(n)}`, 'good');
        const rest = nodes.filter((n) => !n.selector);
        if (rest.length === 1) toast(`Expedition node reached: ${describeReward(rest[0])}`, 'good');
        else if (rest.length > 1) {
          const sparks = rest.reduce((sum, n) => sum + n.sparks, 0);
          toast(`${rest.length} expedition nodes reached: +${sparks.toLocaleString('en-US')} Sparks`, 'good');
        }
      }),
    [],
  );
}

export function App() {
  const state = useStore();
  const route = useRoute();
  useExpeditionToasts();
  const now = useNow();
  const theme = state.meta.get('meta')?.settings.theme ?? 'default';
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  const hibernation = isReady() ? activeHibernation(state, now) : null;
  const supplyDown = isReady() && provisionsAlert(state, now).down;
  useEffect(() => {
    document.documentElement.toggleAttribute('data-hibernating', !!hibernation);
  }, [!!hibernation]);
  if (!isReady()) return <div class="boot">INITIALIZING…</div>;

  // The Collection tab moved into the Bag; old links land there.
  const collectionLink = route[0] === 'collection';
  const tab = (collectionLink ? 'bag' : TABS.some((t) => t.id === route[0]) ? route[0] : 'today') as Tab;
  const { sparks, shards } = balances(state);
  const meta = getMeta(state);
  const due = backupDue(meta.lastBackupAt);
  const title = frontier(state)?.activeTitle;

  return (
    <div class="app">
      <header class="topbar">
        <div class="brand">
          <span class="brand-mark" aria-hidden="true" />
          <span class="brand-text">
            <span>
              JENKLIES<b>//ENDGAME</b>
            </span>
            {title && <small class="brand-title">{title}</small>}
          </span>
        </div>
        <div class="wallet">
          {due && (
            <a class="chip warn" href="#/more/backup">
              BACKUP
            </a>
          )}
          <Amount value={sparks} currency="sparks" />
          <Amount value={shards} currency="shards" />
        </div>
      </header>
      {hibernation && (
        <div class="hibernate-banner" role="status">
          <span>
            <b>Hibernating</b>
            <small class="mono">since {formatDayKey(dayKeyOf(new Date(hibernation.startAt)))} · progress is paused</small>
          </span>
          <button class="btn" onClick={wake}>
            Wake up
          </button>
        </div>
      )}
      <FocusPill />
      <main>
        {tab === 'today' && <Today />}
        {tab === 'pull' && <Pull />}
        {tab === 'bag' && <Bag view={collectionLink ? 'affirmations' : undefined} />}
        {tab === 'events' && <Events sub={route[1]} />}
        {tab === 'more' && <More sub={route[1]} backupDue={due} />}
      </main>
      <nav class="tabbar">
        {TABS.map((t) => (
          <a key={t.id} href={`#/${t.id}`} class={tab === t.id ? 'on' : ''} aria-current={tab === t.id ? 'page' : undefined}>
            {t.icon}
            <span>{t.label}</span>
            {t.id === 'more' && due && <i class="dot" aria-label="Backup due" />}
            {t.id === 'events' && supplyDown && <i class="dot" aria-label="Supply line down" />}
          </a>
        ))}
      </nav>
      <WeeklyReport />
      <ForgottenEnd />
      <UiHost />
    </div>
  );
}
