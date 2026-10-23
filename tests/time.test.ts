import { describe, expect, it } from 'vitest';
import {
  dayKeyOf,
  dayTypeOf,
  deadlineAt,
  formatMinutes,
  inputToMinutes,
  isOnTime,
  minutesToInput,
} from '../src/logic/time';

describe('day boundaries', () => {
  it('a new day starts at 4:00 AM', () => {
    expect(dayKeyOf(new Date(2026, 9, 23, 4, 0))).toBe('2026-10-23');
    expect(dayKeyOf(new Date(2026, 9, 23, 3, 59))).toBe('2026-10-22');
    expect(dayKeyOf(new Date(2026, 9, 23, 23, 59))).toBe('2026-10-23');
  });

  it('handles month and year boundaries', () => {
    expect(dayKeyOf(new Date(2026, 10, 1, 1, 0))).toBe('2026-10-31');
    expect(dayKeyOf(new Date(2027, 0, 1, 2, 30))).toBe('2026-12-31');
  });

  it('classifies weekdays and weekends', () => {
    expect(dayTypeOf('2026-10-23')).toBe('weekday'); // Friday
    expect(dayTypeOf('2026-10-24')).toBe('weekend'); // Saturday
    expect(dayTypeOf('2026-10-25')).toBe('weekend'); // Sunday
    expect(dayTypeOf('2026-10-26')).toBe('weekday'); // Monday
  });
});

describe('deadlines', () => {
  it('is on time through the deadline minute', () => {
    expect(isOnTime(new Date(2026, 9, 23, 8, 59), '2026-10-23', 540)).toBe(true);
    expect(isOnTime(new Date(2026, 9, 23, 9, 0, 59), '2026-10-23', 540)).toBe(true);
    expect(isOnTime(new Date(2026, 9, 23, 9, 1), '2026-10-23', 540)).toBe(false);
  });

  it('supports deadlines after midnight', () => {
    const at = deadlineAt('2026-10-23', 1440 + 30);
    expect(at.getDate()).toBe(24);
    expect(at.getHours()).toBe(0);
    expect(at.getMinutes()).toBe(30);
  });

  it('converts time inputs, reading early hours as after midnight', () => {
    expect(inputToMinutes('09:00')).toBe(540);
    expect(inputToMinutes('22:00')).toBe(1320);
    expect(inputToMinutes('00:30')).toBe(1470);
    expect(inputToMinutes('nope')).toBeNull();
    expect(minutesToInput(1470)).toBe('00:30');
    expect(formatMinutes(1290)).toBe('9:30 PM');
    expect(formatMinutes(720)).toBe('12:00 PM');
  });
});
