import { describe, expect, it } from 'vitest';
import {
  allowanceForSubjects,
  overtimeMinutesDisplay,
  sessionTiming,
} from '../sessionRules.js';

describe('sessionRules', () => {
  it('allowanceForSubjects: one subject 30, both 60', () => {
    expect(allowanceForSubjects('math')).toBe(30);
    expect(allowanceForSubjects('reading')).toBe(30);
    expect(allowanceForSubjects('both')).toBe(60);
  });

  it('sessionTiming at exact allowance boundary', () => {
    const checkIn = '2026-07-30T10:00:00.000Z';
    const checkInMs = Date.parse(checkIn);
    const allowance = 30;

    const atAllowance = sessionTiming(checkIn, allowance, checkInMs + 30 * 60_000);
    expect(atAllowance.elapsed_minutes).toBe(30);
    expect(atAllowance.is_overtime).toBe(false);
    expect(atAllowance.overtime_minutes).toBe(0);

    const oneOver = sessionTiming(checkIn, allowance, checkInMs + 31 * 60_000);
    expect(oneOver.elapsed_minutes).toBe(31);
    expect(oneOver.is_overtime).toBe(true);
    expect(oneOver.overtime_minutes).toBe(1);

    const oneUnder = sessionTiming(checkIn, allowance, checkInMs + 29 * 60_000);
    expect(oneUnder.elapsed_minutes).toBe(29);
    expect(oneUnder.is_overtime).toBe(false);
    expect(oneUnder.overtime_minutes).toBe(0);
  });

  it('overtimeMinutesDisplay never returns 0 when actually over', () => {
    expect(overtimeMinutesDisplay(30, 30)).toBe(0);
    expect(overtimeMinutesDisplay(30.1, 30)).toBe(1);
    expect(overtimeMinutesDisplay(31, 30)).toBe(1);
    expect(overtimeMinutesDisplay(45.2, 30)).toBe(16);
    expect(overtimeMinutesDisplay(29.9, 30)).toBe(0);
  });
});
