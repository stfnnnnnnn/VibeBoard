import pool from '@/lib/db';
import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import { canvasGetAll } from './client';
import { normalizeCourse } from './normalize';
import type { CanvasConnectionRow } from './credentials';

async function discoverCourses(connection: CanvasConnectionRow): Promise<number> {
  const raw = await canvasGetAll(connection, '/courses', {
    'enrollment_state': 'active',
    'include[]': 'term',
  });

  let count = 0;
  for (const rawCourse of raw) {
    const course = normalizeCourse(rawCourse as never);
    await pool.execute(
      `INSERT INTO canvas_courses
         (connection_id, canvas_course_id, name, course_code, term, workflow_state, start_at, end_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE
         name = VALUES(name), course_code = VALUES(course_code), term = VALUES(term),
         workflow_state = VALUES(workflow_state), start_at = VALUES(start_at),
         end_at = VALUES(end_at), last_seen_at = NOW()`,
      [
        connection.id, course.canvasCourseId, course.name, course.courseCode,
        course.term, course.workflowState, course.startAt, course.endAt,
      ],
    );
    count++;
  }
  return count;
}

export interface CanvasCourseRow extends RowDataPacket {
  id:                number;
  connection_id:     number;
  canvas_course_id:  number;
  name:              string;
  mapping_status:    'pending' | 'linked' | 'created' | 'ignored';
  user_subject_id:   number | null;
}

async function getMappedCourses(connectionId: number): Promise<CanvasCourseRow[]> {
  const [rows] = await pool.execute<CanvasCourseRow[]>(
    `SELECT * FROM canvas_courses WHERE connection_id = ? AND mapping_status IN ('linked','created')`,
    [connectionId],
  );
  return rows;
}

export { discoverCourses, getMappedCourses };
