// Fitting the app to the iPhone screen.
//
// In a Home Screen web app that draws under the status bar, iOS can report the page's
// height one status bar short, which leaves a gap under the tab bar. The installed app
// always fills the whole screen, so there we size it from the screen itself.

export function isStandalone(): boolean {
  return (
    matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isPortrait(): boolean {
  return matchMedia('(orientation: portrait)').matches;
}

/** Sets --app-h to the full screen height in the installed app (portrait); elsewhere the CSS default applies. */
export function fitToScreen(): void {
  const root = document.documentElement.style;
  if (isStandalone() && isPortrait()) {
    root.setProperty('--app-h', `${Math.max(screen.width, screen.height)}px`);
  } else {
    root.removeProperty('--app-h');
  }
}

export function watchScreen(): void {
  fitToScreen();
  addEventListener('resize', fitToScreen);
  addEventListener('orientationchange', fitToScreen);
}

/** Measures a CSS length by applying it to a hidden element. */
function measure(css: string, read: (el: HTMLElement) => number): number {
  const el = document.createElement('div');
  el.style.cssText = `position:fixed;top:0;left:0;width:0;visibility:hidden;pointer-events:none;${css}`;
  document.body.appendChild(el);
  const value = read(el);
  el.remove();
  return Math.round(value);
}

/** What the device reports about its screen, for troubleshooting layout on the phone. */
export function screenReport(): string[] {
  const height = (el: HTMLElement) => el.getBoundingClientRect().height;
  const pad = (side: 'top' | 'bottom') => (el: HTMLElement) =>
    parseFloat(getComputedStyle(el).getPropertyValue(`padding-${side}`));
  const app = document.getElementById('app')?.getBoundingClientRect();
  const tabbar = document.querySelector('.tabbar')?.getBoundingClientRect();
  return [
    `mode ${isStandalone() ? 'home screen app' : 'browser'} · ${isPortrait() ? 'portrait' : 'landscape'}`,
    `screen ${screen.width}×${screen.height} · window ${innerWidth}×${innerHeight}`,
    `100% ${document.documentElement.clientHeight} · 100vh ${measure('height:100vh', height)} · 100dvh ${measure('height:100dvh', height)}`,
    `safe area top ${measure('padding-top:env(safe-area-inset-top)', pad('top'))} · bottom ${measure('padding-bottom:env(safe-area-inset-bottom)', pad('bottom'))}`,
    `app height ${Math.round(app?.height ?? 0)} · tab bar bottom ${Math.round(tabbar?.bottom ?? 0)}`,
  ];
}
