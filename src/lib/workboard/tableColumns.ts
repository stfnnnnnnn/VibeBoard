import type { WorkContext } from '@/lib/workboard/workContexts';
import { LIFE_AREA_LABELS, CONTEXT_LABELS } from '@/lib/workboard/workContexts';
import type { WorkItem } from '@/lib/workboard/workItems';
import { formatDeadline, formatDeadlineTime } from '@/lib/workboard/dueSemantics';

export type ColumnKey =
  | 'context' | 'course' | 'organization' | 'area' | 'project'
  | 'work' | 'status' | 'priority' | 'deadline' | 'time' | 'estimate' | 'links';

export interface TableColumn {
  key:      ColumnKey;
  label:    string;
  /** Columns dropped first when width is short. Spec §29 keeps Work, Status, Deadline. */
  priority: 'essential' | 'high' | 'low';
  align?:   'right';
}

const WORK:     TableColumn = { key: 'work',     label: 'Work',     priority: 'essential' };
const STATUS:   TableColumn = { key: 'status',   label: 'Status',   priority: 'essential' };
const DEADLINE: TableColumn = { key: 'deadline', label: 'Deadline', priority: 'essential' };
const TIME:     TableColumn = { key: 'time',     label: 'Time',     priority: 'low' };
const LINKS:    TableColumn = { key: 'links',    label: 'Links',    priority: 'low' };
const PRIORITY: TableColumn = { key: 'priority', label: 'Priority', priority: 'high' };

/** Fixed per context — the user never configures these (spec §7, §34). */
export const COLUMNS_BY_CONTEXT: Record<WorkContext | 'all', TableColumn[]> = {
  all: [
    { key: 'context', label: 'Context', priority: 'high' },
    WORK, STATUS, PRIORITY, DEADLINE, TIME, LINKS,
  ],
  academic: [
    { key: 'course',  label: 'Course',  priority: 'high' },
    { key: 'project', label: 'Project', priority: 'low' },
    { ...WORK, label: 'Activity' },
    STATUS, DEADLINE, TIME, LINKS,
  ],
  organization: [
    { key: 'organization', label: 'Organization',         priority: 'high' },
    { key: 'project',      label: 'Project / Initiative', priority: 'low' },
    WORK, STATUS, DEADLINE, TIME, LINKS,
  ],
  project: [
    { key: 'project', label: 'Project', priority: 'high' },
    WORK, STATUS, PRIORITY, DEADLINE,
    { key: 'estimate', label: 'Estimate', priority: 'low', align: 'right' },
    LINKS,
  ],
  life: [
    { key: 'area', label: 'Area', priority: 'high' },
    WORK, STATUS, PRIORITY, DEADLINE, TIME, LINKS,
  ],
};

const DASH = '—';

/**
 * The display string for a non-interactive cell. Returns null for the four columns
 * rendered by dedicated components (work, status, priority, links) so the row branches.
 * Every absent optional value renders an em dash — the spec is explicit that a cell must
 * never be blank.
 *
 * `course` and `project` deliberately read the first-class `course_code` / `project_name`
 * fields rather than `chip_label`: that field collapses project-then-course into one
 * value, which would put a project name under the Academic table's "Course" column.
 */
export function cellValue(item: WorkItem, key: ColumnKey): string | null {
  switch (key) {
    case 'context':      return CONTEXT_LABELS[item.context];
    case 'course':       return item.course_code ?? DASH;
    case 'organization': return item.organization_name ?? DASH;
    case 'area':         return item.life_area ? LIFE_AREA_LABELS[item.life_area] : DASH;
    case 'project':      return item.project_name ?? DASH;
    case 'deadline':     return formatDeadline(item) ?? DASH;
    case 'time':         return formatDeadlineTime(item);
    case 'estimate':     return item.estimated_hours === null ? DASH : item.estimated_hours + 'h';
    default:             return null;
  }
}
