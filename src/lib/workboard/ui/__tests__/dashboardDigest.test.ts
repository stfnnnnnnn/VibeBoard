import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { WorkItem } from '../../workItems';
import { buildWorkboardDigest, dueChip } from '../../dashboardDigest';

let n = 0;
function mk(p: Partial<WorkItem>): WorkItem {
  n += 1;
  return {
    source: 'owned', id: n, title: `t${n}`, category: 'project', context: 'project', chip_label: null,
    project_name: null, course_code: null, project_id: null, user_subject_id: null, priority: 'normal',
    work_status: 'todo', work_stage: 'todo', due_at: null, deadline_time: null, start_date: null,
    estimated_hours: null, completed_at: null, note: null, life_area: null, organization_id: null,
    organization_name: null, project_context: null, link_count: 0, subtask_total: 0, subtask_done: 0,
    blocked_reason: null, blocked_since: null,
    ...p,
  } as WorkItem;
}
const T = '2026-10-30';          // Friday
const WS = '2026-10-26';         // its Monday

test('dueChip labels', () => {
  assert.deepEqual(dueChip('2026-10-28', '23:59:00', T, false), { top: '2d late', bottom: 'Wed 11:59 PM', late: true });
  assert.deepEqual(dueChip('2026-10-30', '23:59:00', T, false), { top: 'Today', bottom: '11:59 PM', late: false });
  assert.deepEqual(dueChip('2026-10-31', null, T, false), { top: 'Tomorrow', bottom: null, late: false });
  assert.deepEqual(dueChip('2026-11-02', null, T, false), { top: 'Mon', bottom: 'Nov 2', late: false });
  assert.deepEqual(dueChip('2026-11-12', '17:00:00', T, false), { top: 'Nov 12', bottom: '5 PM', late: false });
  assert.equal(dueChip(null, null, T, false), null);
});
test('a past-due revision item is never "late"', () => {
  assert.deepEqual(dueChip('2026-10-28', null, T, true), { top: 'Revision', bottom: 'Oct 28', late: false });
  assert.deepEqual(dueChip('2026-10-28', '17:00:00', T, true), { top: 'Revision', bottom: 'Wed 5 PM', late: false });
});
test('up next: overdue first, topped up to 4 from the coming week', () => {
  const late = mk({ due_at: '2026-10-28' });
  const today = mk({ due_at: '2026-10-30' });
  const nextWed = mk({ due_at: '2026-11-04' });           // within 7 days, todo: not rankUpNext material
  const nextThu = mk({ due_at: '2026-11-05' });
  const farAway = mk({ due_at: '2026-12-01' });
  const d = buildWorkboardDigest([farAway, nextThu, today, nextWed, late], T, WS);
  assert.deepEqual(d.upNext.map(i => i.key), [late, today, nextWed, nextThu].map(i => `owned-${i.id}`));
  assert.equal(d.upNext[0].href, `/workboard?item=owned-${late.id}`);
});
test('counts and week buckets', () => {
  const items = [
    mk({ due_at: '2026-10-27', context: 'academic', category: 'academic' }),                  // overdue, this week
    mk({ due_at: '2026-10-30', work_status: 'in_progress', work_stage: 'in_progress' }),        // today, in progress
    mk({ due_at: '2026-10-30', context: 'life', category: 'life' }),
    mk({ due_at: '2026-10-29', work_status: 'done', work_stage: 'done', completed_at: '2026-10-29 10:00:00' }),
    mk({ due_at: '2026-11-03' }),                                                              // next week
  ];
  const d = buildWorkboardDigest(items, T, WS);
  assert.equal(d.hasAnyItems, true);
  assert.equal(d.overdue, 1);
  assert.equal(d.inProgress, 1);
  assert.equal(d.dueThisWeek, 3);
  assert.equal(d.doneThisWeek, 1);
  assert.equal(d.totalThisWeek, 4);
  assert.equal(d.week.length, 7);
  assert.equal(d.week[0].date, WS);
  assert.equal(d.week[4].total, 2);
  assert.deepEqual(d.week[4].counts, { academic: 0, project: 1, organization: 0, life: 1 });
  assert.equal(d.week[4].items.length, 2);
});
test('labels: course code, stage tone, subtasks', () => {
  const a = mk({ context: 'academic', category: 'academic', course_code: '3TSY2526_CS0061L_TN3', due_at: '2026-10-30',
                 work_stage: 'submitted', work_status: 'in_progress', subtask_total: 5, subtask_done: 2 });
  const [item] = buildWorkboardDigest([a], T, WS).upNext;
  assert.equal(item.contextLabel, 'CS0061L');
  assert.equal(item.stageTone, 'revision');
  assert.equal(item.stageLabel, 'For Revision');
  assert.deepEqual(item.subtasks, { done: 2, total: 5 });
});
test('empty board', () => {
  const d = buildWorkboardDigest([], T, WS);
  assert.equal(d.hasAnyItems, false);
  assert.deepEqual(d.upNext, []);
});
