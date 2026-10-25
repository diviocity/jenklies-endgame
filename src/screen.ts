// Fitting the app to the iPhone screen.
//
// In a Home Screen web app that draws under the status bar, iOS can report the page's
// height one status bar short, which leaves a gap under the tab bar. On iPhone (and on
// iPad when the app isn't sharing the screen) the installed app fills the whole screen,
// so there we size it from the screen itself. Everywhere else keeps the normal layout.

export function isStandalone(): boolean {
  return (
    matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/** Safari's own flag for an app opened from an iPhone or iPad Home Screen; other platforms don't set it. */
function isIosHomeScreenApp(): boolean {
  return (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function isPortrait(): boolean {
  return matchMedia('(orientation: portrait)').matches;
}

/** The app's window is as wide as the screen (not Split View, Slide Over or a Stage Manager window). */
function fillsScreenWidth(): boolean {
  return Math.abs(innerWidth - Math.min(screen.width, screen.height)) <= 1;
}

let fitted = false;

/** Whether the app is currently sized from the screen rather than the page. */
export function isFittedToScreen(): boolean {
  return fitted;
}

/** Sets --app-h to the full screen height when the installed iOS app fills the screen; elsewhere the CSS default applies. */
export function fitToScreen(): void {
  const root = document.documentElement.style;
  fitted = isIosHomeScreenApp() && isPortrait() && fillsScreenWidth();
  if (fitted) {
    root.setProperty('--app-h', `${Math.max(screen.width, screen.height)}px`);
  } else {
    root.removeProperty('--app-h');
  }
}

/** A field that brings up the keyboard. */
function isTyping(): boolean {
  const el = document.activeElement;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLElement && el.isContentEditable) return true;
  return el instanceof HTMLInputElement && !['checkbox', 'radio', 'button', 'submit', 'range', 'color', 'file'].includes(el.type);
}

/**
 * When fitted, the page is taller than the height iOS reports, so it could scroll by a
 * status bar's worth. Content scrolls inside the app, so keep the page itself at the top.
 * While typing, iOS scrolls the page to lift the field above the keyboard, so leave it be
 * and settle back once the field loses focus.
 */
function keepPageAtTop(): void {
  if (fitted && !isTyping() && (scrollX !== 0 || scrollY !== 0)) scrollTo(0, 0);
}

export function watchScreen(): void {
  fitToScreen();
  addEventListener('resize', fitToScreen);
  addEventListener('orientationchange', fitToScreen);
  addEventListener('scroll', keepPageAtTop, { passive: true });
  // After the keyboard closes; wait a tick so moving between fields doesn't jump.
  addEventListener('focusout', () => setTimeout(keepPageAtTop, 100));
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
    `mode ${isStandalone() ? 'installed app' : 'browser'} · ${isPortrait() ? 'portrait' : 'landscape'} · sized from ${fitted ? 'screen' : 'page'}`,
    `screen ${screen.width}×${screen.height} · window ${innerWidth}×${innerHeight}`,
    `100% ${document.documentElement.clientHeight} · 100vh ${measure('height:100vh', height)} · 100dvh ${measure('height:100dvh', height)}`,
    `safe area top ${measure('padding-top:env(safe-area-inset-top)', pad('top'))} · bottom ${measure('padding-bottom:env(safe-area-inset-bottom)', pad('bottom'))}`,
    `app height ${Math.round(app?.height ?? 0)} · tab bar bottom ${Math.round(tabbar?.bottom ?? 0)}`,
    `page height ${document.documentElement.scrollHeight} · page scrolled ${Math.round(scrollY)}`,
  ];
}
