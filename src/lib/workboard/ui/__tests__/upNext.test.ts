import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { WorkItem } from '../../workItems';
import { rankUpNext, showAllGroups, foldLabel, UP_NEXT_LIMIT } from '../upNext';
import { itemKey } from '../itemKey';

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
const T = '2026-10-20';

test('overdue first (oldest first), then today by time with untimed last, then tomorrow', () => {
  const od2 = mk({ due_at: '2026-10-10 00:00:00' });
  const od1 = mk({ due_at: '2026-07-07' });
  const todayUntimed = mk({ due_at: '2026-10-20' });
  const today9 = mk({ due_at: '2026-10-20 00:00:00', deadline_time: '09:00:00' });
  const tmrw = mk({ due_at: '2026-10-21' });
  const ranked = rankUpNext([tmrw, todayUntimed, od2, today9, od1], T);
  assert.deepEqual(ranked.map(i => i.id), [od1.id, od2.id, today9.id, todayUntimed.id, tmrw.id]);
});

test('later-this-week items rank only when in progress, by priority then date', () => {
  const todoThu = mk({ due_at: '2026-10-22' });
  const ipSatLow = mk({ due_at: '2026-10-24', work_status: 'in_progress', work_stage: 'in_progress', priority: 'low' });
  const ipThuHigh = mk({ due_at: '2026-10-25', work_status: 'in_progress', work_stage: 'in_progress', priority: 'high' });
  const ipFar = mk({ due_at: '2026-11-30', work_status: 'in_progress', work_stage: 'in_progress' });
  const ranked = rankUpNext([todoThu, ipSatLow, ipThuHigh, ipFar], T);
  assert.deepEqual(ranked.map(i => i.id), [ipThuHigh.id, ipSatLow.id]);
});

test('done and undated items never rank; a past-due revision item ranks as today', () => {
  const done = mk({ due_at: '2026-10-20', work_status: 'done', work_stage: 'done' });
  const undated = mk({});
  const rev = mk({ context: 'academic', due_at: '2026-10-01', work_stage: 'submitted', work_status: 'in_progress' });
  const od = mk({ due_at: '2026-10-19' });
  assert.deepEqual(rankUpNext([done, undated, rev, od], T).map(i => i.id), [od.id, rev.id]);
});

test('showAllGroups puts every not-done, not-shown item in exactly one group', () => {
  const ods = [1, 2, 3, 4, 5, 6].map(d => mk({ due_at: `2026-10-0${d}` }));
  const wk = mk({ due_at: '2026-10-26' });
  const nxt = mk({ due_at: '2026-11-01' });
  const lat = mk({ due_at: '2026-12-01' });
  const nd = mk({});
  const wait = mk({ due_at: '2026-10-22', blocked_since: '2026-10-15 10:00:00', work_stage: 'blocked' });
  const done = mk({ work_status: 'done', work_stage: 'done' });
  const all = [...ods, wk, nxt, lat, nd, wait, done];
  const shown = new Set(rankUpNext(all, T).slice(0, UP_NEXT_LIMIT).map(itemKey));
  const g = showAllGroups(all, T, shown);
  assert.deepEqual(g.more_overdue.map(i => i.id), [ods[4].id, ods[5].id]);
  assert.deepEqual(g.this_week.map(i => i.id), [wk.id]);
  assert.deepEqual(g.next_week.map(i => i.id), [nxt.id]);
  assert.deepEqual(g.later.map(i => i.id), [lat.id]);
  assert.deepEqual(g.waiting.map(i => i.id), [wait.id]);
  assert.deepEqual(g.no_deadline.map(i => i.id), [nd.id]);
  const total = Object.values(g).reduce((s, a) => s + a.length, 0);
  assert.equal(total + shown.size, all.length - 1);
});

test('foldLabel summarises non-empty groups and is empty when nothing remains', () => {
  const e = { more_overdue: [], this_week: [], next_week: [], later: [], waiting: [], no_deadline: [] };
  assert.equal(foldLabel(e), '');
  const x = mk({});
  assert.equal(foldLabel({ ...e, this_week: [x, x], more_overdue: [x], no_deadline: [x], later: [x], waiting: [x] }),
    '+3 more this week · 1 no deadline · 2 later');
});
