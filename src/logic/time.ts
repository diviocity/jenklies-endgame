import { DAY } from '../config';
import type { BucketId, DayType, Minutes } from '../types';

export const WEEKDAY_BUCKETS: BucketId[] = ['morning', 'afternoon', 'evening'];
export const WEEKEND_BUCKETS: BucketId[] = ['half1', 'half2'];

export const BUCKET_LABELS: Record<BucketId, string> = {
  morning: 'Morning',
  afternoon: 'Afternoon',
  evening: 'Evening',
  half1: '1st Half',
  half2: '2nd Half',
};

export const DEFAULT_DEADLINES: Record<BucketId, Minutes> = {
  morning: 9 * 60,
  afternoon: 17 * 60,
  evening: 21 * 60 + 30,
  half1: 13 * 60,
  half2: 21 * 60 + 30,
};

export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function dateToKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The game day a moment belongs to. Before 4:00 AM local time counts as the previous day. */
export function dayKeyOf(at: Date): string {
  const minutes = at.getHours() * 60 + at.getMinutes();
  if (minutes >= DAY.startMinutes) return dateToKey(at);
  return dateToKey(new Date(at.getFullYear(), at.getMonth(), at.getDate() - 1));
}

/** Local midnight of a day key's calendar date. */
export function keyToDate(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function weekdayOf(key: string): number {
  return keyToDate(key).getDay();
}

export function dayTypeOfWeekday(weekday: number): DayType {
  return weekday === 0 || weekday === 6 ? 'weekend' : 'weekday';
}

export function dayTypeOf(key: string): DayType {
  return dayTypeOfWeekday(weekdayOf(key));
}

export function bucketsFor(type: DayType): BucketId[] {
  return type === 'weekday' ? WEEKDAY_BUCKETS : WEEKEND_BUCKETS;
}

export function bucketDayType(bucket: BucketId): DayType {
  return WEEKDAY_BUCKETS.includes(bucket) ? 'weekday' : 'weekend';
}

/** The exact moment a deadline falls on, for a given day. */
export function deadlineAt(key: string, deadline: Minutes): Date {
  const d = keyToDate(key);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, deadline);
}

/** On time means completed before the deadline minute is over ("by 9:00" includes 9:00). */
export function isOnTime(completedAt: Date, key: string, deadline: Minutes): boolean {
  return completedAt.getTime() < deadlineAt(key, deadline).getTime() + 60_000;
}

/** Formats minutes as a clock time, e.g. 1290 → "9:30 PM". */
export function formatMinutes(m: Minutes): string {
  const wrapped = ((m % 1440) + 1440) % 1440;
  const h = Math.floor(wrapped / 60);
  const min = wrapped % 60;
  const suffix = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad(min)} ${suffix}`;
}

/** Minutes → "HH:MM" for <input type="time">. */
export function minutesToInput(m: Minutes): string {
  const wrapped = ((m % 1440) + 1440) % 1440;
  return `${pad(Math.floor(wrapped / 60))}:${pad(wrapped % 60)}`;
}

/** "HH:MM" → minutes. Times before 4:00 AM are read as after midnight, i.e. the end of the same game day. */
export function inputToMinutes(value: string): Minutes | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  const total = h * 60 + m;
  return total < DAY.startMinutes ? total + 1440 : total;
}

export function formatDayKey(key: string): string {
  const d = keyToDate(key);
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function daysBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / 86_400_000);
}
