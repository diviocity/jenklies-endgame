import { useEffect, useState } from 'preact/hooks';
import { BACKUP } from '../config';
import { balances } from '../logic/actions';
import { getMeta } from '../logic/state';
import { daysBetween } from '../logic/time';
import { isReady, useStore } from '../store';
import { Bag } from './Bag';
import { Collection } from './Collection';
import { Amount, UiHost } from './common';
import { More } from './More';
import { Pull } from './Pull';
import { Today } from './Today';

type Tab = 'today' | 'pull' | 'bag' | 'collection' | 'more';

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
    id: 'collection',
    label: 'Collection',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z" />
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

export function App() {
  const state = useStore();
  const route = useRoute();
  if (!isReady()) return <div class="boot">INITIALIZING…</div>;

  const tab = (TABS.some((t) => t.id === route[0]) ? route[0] : 'today') as Tab;
  const { sparks, shards } = balances(state);
  const meta = getMeta(state);
  const due = backupDue(meta.lastBackupAt);

  return (
    <div class="app">
      <header class="topbar">
        <div class="brand">
          <span class="brand-mark" aria-hidden="true" />
          <span>
            JENKLIES<b>//ENDGAME</b>
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
      <main>
        {tab === 'today' && <Today />}
        {tab === 'pull' && <Pull />}
        {tab === 'bag' && <Bag />}
        {tab === 'collection' && <Collection />}
        {tab === 'more' && <More sub={route[1]} backupDue={due} />}
      </main>
      <nav class="tabbar">
        {TABS.map((t) => (
          <a key={t.id} href={`#/${t.id}`} class={tab === t.id ? 'on' : ''} aria-current={tab === t.id ? 'page' : undefined}>
            {t.icon}
            <span>{t.label}</span>
            {t.id === 'more' && due && <i class="dot" aria-label="Backup due" />}
          </a>
        ))}
      </nav>
      <UiHost />
    </div>
  );
}
