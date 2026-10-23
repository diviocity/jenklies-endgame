import type { ComponentChildren } from 'preact';
import { createPortal } from 'preact/compat';
import { useEffect, useState } from 'preact/hooks';
import { getMeta } from '../logic/state';
import { getState, tick } from '../store';
import type { Rarity } from '../types';

// ---------------------------------------------------------------- tiny global UI bus

type DialogRequest = {
  title: string;
  body?: ComponentChildren;
  confirmLabel?: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
};

type Toast = { id: number; text: string; kind: 'info' | 'error' | 'good' };

let dialog: DialogRequest | null = null;
let toasts: Toast[] = [];
const uiListeners = new Set<() => void>();
const notifyUi = () => uiListeners.forEach((l) => l());

function useUiBus() {
  const [, set] = useState(0);
  useEffect(() => {
    const l = () => set((n) => n + 1);
    uiListeners.add(l);
    return () => void uiListeners.delete(l);
  }, []);
}

export function confirmDialog(opts: Omit<DialogRequest, 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => {
    dialog = { ...opts, resolve };
    notifyUi();
  });
}

let toastId = 0;
export function toast(text: string, kind: Toast['kind'] = 'info'): void {
  const t = { id: ++toastId, text, kind };
  toasts = [...toasts.slice(-2), t];
  notifyUi();
  setTimeout(() => {
    toasts = toasts.filter((x) => x.id !== t.id);
    notifyUi();
  }, kind === 'error' ? 4500 : 2500);
}

/** Shows a run() outcome's error, if any. Returns the result when it worked. */
export function report<T>(outcome: { ok: true; result: T } | { ok: false; error: string }): T | undefined {
  if (!outcome.ok) {
    toast(outcome.error, 'error');
    return undefined;
  }
  return outcome.result;
}

export function UiHost() {
  useUiBus();
  const close = (ok: boolean) => {
    dialog?.resolve(ok);
    dialog = null;
    notifyUi();
  };
  return (
    <>
      {dialog && (
        <div class="overlay" onClick={() => close(false)}>
          <div class="dialog panel" role="alertdialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div class="eyebrow">// confirm</div>
            <h2>{dialog.title}</h2>
            {dialog.body && <div class="dialog-body">{dialog.body}</div>}
            <div class="row gap end">
              <button class="btn ghost" onClick={() => close(false)}>
                Cancel
              </button>
              <button class={`btn ${dialog.danger ? 'danger' : 'primary'}`} onClick={() => close(true)}>
                {dialog.confirmLabel ?? 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
      <div class="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} class={`toast ${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
    </>
  );
}

// ---------------------------------------------------------------- sheets

/** Renders full-screen layers at the top of the page, outside the scrolling content. */
export function Portal({ children }: { children: ComponentChildren }) {
  return createPortal(children, document.body);
}

export function Sheet(props: { title: string; onClose: () => void; children: ComponentChildren }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props.onClose]);
  return (
    <Portal>
      <div class="overlay sheet-overlay" onClick={props.onClose}>
        <div class="sheet" role="dialog" aria-modal="true" aria-label={props.title} onClick={(e) => e.stopPropagation()}>
          <div class="sheet-head">
            <h2>{props.title}</h2>
            <button class="icon-btn" aria-label="Close" onClick={props.onClose}>
              ✕
            </button>
          </div>
          <div class="sheet-body">{props.children}</div>
        </div>
      </div>
    </Portal>
  );
}

// ---------------------------------------------------------------- bits

export function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const update = () => {
      setNow(new Date());
      void tick();
    };
    const id = setInterval(update, intervalMs);
    document.addEventListener('visibilitychange', update);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', update);
    };
  }, [intervalMs]);
  return now;
}

export function Stars({ rarity }: { rarity: Rarity }) {
  return (
    <span class={`stars r${rarity}`} aria-label={`${rarity} star`}>
      {'★'.repeat(rarity)}
    </span>
  );
}

export function fmt(n: number): string {
  return n.toLocaleString('en-US');
}

export function names() {
  return getMeta(getState()).settings;
}

export function SparkIcon() {
  return (
    <svg class="cur-icon spark" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 1 L10 6 L15 8 L10 10 L8 15 L6 10 L1 8 L6 6 Z" fill="currentColor" />
    </svg>
  );
}

export function ShardIcon() {
  return (
    <svg class="cur-icon shard" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 1 L14 5 L12 14 L4 14 L2 5 Z" fill="none" stroke="currentColor" stroke-width="1.6" />
      <path d="M8 1 L8 14 M2 5 L14 5" stroke="currentColor" stroke-width="1" opacity="0.6" />
    </svg>
  );
}

export function Amount(props: { value: number; currency: 'sparks' | 'shards'; signed?: boolean }) {
  const sign = props.signed && props.value > 0 ? '+' : '';
  return (
    <span class={`amount ${props.currency}`}>
      {props.currency === 'sparks' ? <SparkIcon /> : <ShardIcon />}
      {sign}
      {fmt(props.value)}
    </span>
  );
}

export function Segmented<T extends string>(props: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div class="segmented" role="tablist">
      {props.options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={props.value === o.value}
          class={props.value === o.value ? 'on' : ''}
          onClick={() => props.onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function PageTitle(props: { eyebrow: string; title: string; children?: ComponentChildren }) {
  return (
    <div class="page-title">
      <div>
        <div class="eyebrow">{props.eyebrow}</div>
        <h1>{props.title}</h1>
      </div>
      {props.children}
    </div>
  );
}

export function BackLink() {
  return (
    <a class="back" href="#/more">
      ‹ More
    </a>
  );
}

export function Empty(props: { children: ComponentChildren }) {
  return <div class="empty">{props.children}</div>;
}
