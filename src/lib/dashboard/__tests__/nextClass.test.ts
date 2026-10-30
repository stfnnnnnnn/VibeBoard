import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ClassOccurrence } from '@/lib/workboard/aggregate';
import { pickNextClass, timeLabel } from '../nextClass';

let n = 0;
function occ(p: Partial<ClassOccurrence>): ClassOccurrence {
  n += 1;
  return {
    block_id: n, user_subject_id: null, course_code: `CS00${n}`, subject_name: null, section: null,
    instructor: null, meeting_link: null, trimester: null, year_level: null, units: null,
    date: '2026-10-30', start_time: '13:00', end_time: '14:30', venue: 'Rm 402', is_online: false,
    modality: 'face_to_face', override: null, ...p,
  } as ClassOccurrence;
}
const ov = (modality: string, extra: Record<string, unknown> = {}) =>
  ({ id: 1, modality, note: null, room: null, moved_date: null, moved_start_time: null, moved_end_time: null, ...extra }) as ClassOccurrence['override'];

test('timeLabel drops :00 and uses 12-hour time', () => {
  assert.equal(timeLabel('13:00'), '1 PM');
  assert.equal(timeLabel('13:30'), '1:30 PM');
  assert.equal(timeLabel('00:15'), '12:15 AM');
  assert.equal(timeLabel('12:00'), '12 PM');
});
test('picks the earliest class that has not ended', () => {
  const later = occ({ start_time: '16:00', end_time: '17:30' });
  const soon = occ({ start_time: '13:00', end_time: '14:30' });
  const r = pickNextClass([later, soon], '2026-10-30', '10:00');
  assert.equal(r?.courseCode, soon.course_code);
  assert.equal(r?.when, 'today');
  assert.equal(r?.timeLabel, '1 PM');
  assert.equal(r?.place, 'Rm 402');
});
test('an in-progress class reads "now"', () => {
  const r = pickNextClass([occ({ start_time: '13:00', end_time: '14:30' })], '2026-10-30', '13:40');
  assert.equal(r?.when, 'now');
});
test('rolls to tomorrow, then to a weekday label', () => {
  const ended = occ({ start_time: '08:00', end_time: '09:00' });
  const tmrw = occ({ date: '2026-10-31', start_time: '09:00', end_time: '10:00' });
  assert.equal(pickNextClass([ended, tmrw], '2026-10-30', '12:00')?.when, 'tomorrow');
  const mon = occ({ date: '2026-11-02', start_time: '09:00', end_time: '10:00' });
  assert.equal(pickNextClass([ended, mon], '2026-10-30', '12:00')?.when, 'Mon');
});
test('skips cancelled classes and the original slot of a rescheduled one', () => {
  const cancelled = occ({ override: ov('cancelled') });
  const ghost = occ({ start_time: '14:00', end_time: '15:00', override: ov('rescheduled') });
  const makeup = occ({ start_time: '16:00', end_time: '17:00', override: ov('rescheduled'), moved_from: '2026-10-29' });
  assert.equal(pickNextClass([cancelled, ghost, makeup], '2026-10-30', '10:00')?.courseCode, makeup.course_code);
});
test('online classes and room overrides set the place', () => {
  assert.equal(pickNextClass([occ({ override: ov('online_sync') })], '2026-10-30', '10:00')?.place, 'Online');
  assert.equal(pickNextClass([occ({ modality: 'online_async' })], '2026-10-30', '10:00')?.place, 'Online');
  assert.equal(pickNextClass([occ({ override: ov('room', { room: 'Lab 2' }) })], '2026-10-30', '10:00')?.place, 'Lab 2');
});
test('null when nothing is left', () => {
  assert.equal(pickNextClass([], '2026-10-30', '10:00'), null);
});
