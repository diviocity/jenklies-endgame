import type { Change } from '../types';

/** A user-facing refusal (shown as a message, not a crash). */
export class ActionError extends Error {}

export interface ActionResult<T = undefined> {
  changes: Change[];
  result: T;
}

export function done<T>(changes: Change[], result: T): ActionResult<T> {
  return { changes, result };
}
