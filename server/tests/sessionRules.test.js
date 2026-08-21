import { describe, expect, it } from 'vitest';
import {
  allowanceForSubjects,
  encodeSubjects,
  labelForSubjects,
  normalizeSubjects,
  overtimeMinutesDisplay,
  parseSubjectList,
  sessionTiming,
} from '../sessionRules.js';

describe('sessionRules', () => {
  it('allowanceForSubjects: one subject 30, two subjects 60', () => {
    expect(allowanceForSubjects('math')).toBe(30);
    expect(allowanceForSubjects('reading')).toBe(30);
    expect(allowanceForSubjects('efl')).toBe(30);
    expect(allowanceForSubjects('both')).toBe(60);
    expect(allowanceForSubjects('math+reading')).toBe(60);
    expect(allowanceForSubjects('math+efl')).toBe(60);
    expect(allowanceForSubjects('efl+reading')).toBe(60);
  });

  it('normalizeSubjects accepts efl and pairs; maps legacy both', () => {
    expect(normalizeSubjects('efl')).toBe('efl');
    expect(normalizeSubjects('both')).toBe('math+reading');
    expect(normalizeSubjects('math+efl')).toBe('math+efl');
    expect(normalizeSubjects('reading+math')).toBe('math+reading');
    expect(normalizeSubjects(['efl', 'math'])).toBe('math+efl');
    expect(normalizeSubjects('science')).toBeNull();
  });

  it('encodeSubjects caps at two and labels pairs', () => {
    expect(encodeSubjects('math+reading')).toBe('math+reading');
    expect(encodeSubjects('math')).toBe('math');
    expect(encodeSubjects(['math', 'reading', 'efl'])).toBe('math+reading');
    expect(parseSubjectList('math+efl')).toEqual(['math', 'efl']);
    expect(labelForSubjects('math+efl')).toBe('Math · EFL');
    expect(labelForSubjects('both')).toBe('Math · Reading');
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
