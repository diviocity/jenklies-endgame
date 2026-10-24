import { getMeta } from '../logic/state';
import { formatDateTime } from '../logic/time';
import { useStore } from '../store';
import { AffirmationEditor } from './AffirmationEditor';
import { History } from './History';
import { IndulgenceEditor } from './IndulgenceEditor';
import { BackupPage, SettingsPage } from './Settings';
import { TemplateEditor } from './TemplateEditor';
import { BuildStamp, PageTitle } from './common';

const PAGES = {
  history: History,
  template: TemplateEditor,
  indulgences: IndulgenceEditor,
  affirmations: AffirmationEditor,
  settings: SettingsPage,
  backup: BackupPage,
};

export function More({ sub, backupDue }: { sub?: string; backupDue: boolean }) {
  const state = useStore();
  const Page = sub ? PAGES[sub as keyof typeof PAGES] : undefined;
  if (Page) return <Page />;

  const meta = getMeta(state);
  const items: { href: string; title: string; detail: string; warn?: boolean }[] = [
    { href: 'history', title: 'History', detail: `${state.pulls.size} pulls · ledger · redemptions` },
    { href: 'template', title: 'Weekly template', detail: `${state.templateTasks.size} tasks` },
    {
      href: 'indulgences',
      title: 'Indulgences',
      detail: `${[...state.indulgences.values()].filter((i) => i.active).length} active`,
    },
    {
      href: 'affirmations',
      title: 'Affirmations',
      detail: `${[...state.affirmations.values()].filter((a) => !a.removed).length} in the pool`,
    },
    { href: 'settings', title: 'Settings', detail: 'Deadlines · names · sound' },
    {
      href: 'backup',
      title: 'Backup',
      detail: meta.lastBackupAt ? `Last backup ${formatDateTime(meta.lastBackupAt)}` : 'Never backed up',
      warn: backupDue,
    },
  ];

  return (
    <div class="page">
      <PageTitle eyebrow="// system" title="More" />
      <ul class="menu">
        {items.map((item) => (
          <li key={item.href}>
            <a class="panel" href={`#/more/${item.href}`}>
              <span>
                <b>{item.title}</b>
                <small class={item.warn ? 'warn-text' : ''}>{item.detail}</small>
              </span>
              <span aria-hidden="true">›</span>
            </a>
          </li>
        ))}
      </ul>
      <BuildStamp />
    </div>
  );
}
