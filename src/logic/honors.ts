import type { AppState, ThemeId } from '../types';
import { depot } from './depot';
import { frontier } from './event';

// Titles and themes are earned in more than one event. The title shown is kept on the
// Frontier Expedition's state (where titles started); this gathers what's been earned.

export function earnedTitles(state: AppState): string[] {
  return [...new Set([...(frontier(state)?.titles ?? []), ...(depot(state)?.titles ?? [])])];
}

export function unlockedThemes(state: AppState): ThemeId[] {
  return [...new Set([...(frontier(state)?.themes ?? []), ...(depot(state)?.themes ?? [])])] as ThemeId[];
}
