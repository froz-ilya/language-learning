import { describe, expect, it } from 'vitest';
import { backupFilename, DAY, daysSince, isBackupDue, lastBackupLabel, type DataInfo } from './backupReminder';

const NOW = new Date(2026, 9, 27, 12, 0, 0).getTime();

const base = { backupEvery: 7, lastBackupAt: 0, backupSnoozeUntil: 0 };
const data = (extra: Partial<DataInfo> = {}): DataInfo => ({ cards: 50, firstCardAt: NOW - 30 * DAY, worth: 50, ...extra });

describe('isBackupDue', () => {
  it('is off when backupEvery is 0', () => {
    expect(isBackupDue({ ...base, backupEvery: 0, lastBackupAt: NOW - 100 * DAY }, NOW, data())).toBe(false);
  });

  it('is never due without data', () => {
    expect(isBackupDue({ ...base, lastBackupAt: NOW - 100 * DAY }, NOW, data({ cards: 0, firstCardAt: 0, worth: 0 }))).toBe(false);
    expect(isBackupDue(base, NOW, data({ cards: 0, firstCardAt: 0, worth: 0 }))).toBe(false);
  });

  it('never backed up + young, small data: not due', () => {
    expect(isBackupDue(base, NOW, data({ cards: 5, firstCardAt: NOW - 2 * DAY, worth: 5 }))).toBe(false);
    // A freshly installed level (many preset cards, nothing studied) isn't worth nagging about yet.
    expect(isBackupDue(base, NOW, data({ cards: 600, firstCardAt: NOW - DAY, worth: 0 }))).toBe(false);
  });

  it('never backed up + data older than the interval: due', () => {
    expect(isBackupDue(base, NOW, data({ cards: 5, firstCardAt: NOW - 7 * DAY, worth: 5 }))).toBe(true);
  });

  it('never backed up + young but enough words: due', () => {
    expect(isBackupDue(base, NOW, data({ cards: 25, firstCardAt: NOW - DAY, worth: 20 }))).toBe(true);
  });

  it('is not due while snoozed', () => {
    const s = { ...base, lastBackupAt: NOW - 30 * DAY, backupSnoozeUntil: NOW + 1000 };
    expect(isBackupDue(s, NOW, data())).toBe(false);
    expect(isBackupDue(s, NOW + 1000, data())).toBe(true);
  });

  it('is due once the interval has passed', () => {
    expect(isBackupDue({ ...base, lastBackupAt: NOW - 7 * DAY }, NOW, data())).toBe(true);
    expect(isBackupDue({ ...base, backupEvery: 3, lastBackupAt: NOW - 4 * DAY }, NOW, data())).toBe(true);
  });

  it('is not due before the interval has passed', () => {
    expect(isBackupDue({ ...base, lastBackupAt: NOW - 7 * DAY + 1 }, NOW, data())).toBe(false);
    expect(isBackupDue({ ...base, backupEvery: 5, lastBackupAt: NOW - 2 * DAY }, NOW, data())).toBe(false);
  });
});

describe('daysSince', () => {
  it('counts whole days', () => {
    expect(daysSince(NOW, NOW)).toBe(0);
    expect(daysSince(NOW - DAY + 1, NOW)).toBe(0);
    expect(daysSince(NOW - DAY, NOW)).toBe(1);
    expect(daysSince(NOW - 3.5 * DAY, NOW)).toBe(3);
  });

  it('is never negative', () => {
    expect(daysSince(NOW + 5 * DAY, NOW)).toBe(0);
  });
});

describe('labels', () => {
  it('describes the last backup', () => {
    expect(lastBackupLabel(0, NOW)).toBe('Never');
    expect(lastBackupLabel(NOW - 1000, NOW)).toBe('Today');
    expect(lastBackupLabel(NOW - DAY, NOW)).toBe('Yesterday');
    expect(lastBackupLabel(NOW - 3 * DAY, NOW)).toBe('3 days ago');
  });

  it('names the file by date', () => {
    expect(backupFilename(new Date(2026, 0, 5))).toBe('deutsch-backup-2026-01-05.json');
  });
});
