'use client';

import ConnectPanel from './ConnectPanel';
import CourseMapping from './CourseMapping';
import ProfileCard from './ProfileCard';
import type { CanvasCourse, ConnectionStatus, HubSubject, PendingCounts } from './types';
import type { ToastInput } from './useUndoToast';

/** The Overview tab (spec §6 C2): the profile card beside the courses panel, or the pairing flow when not connected. */
export default function CanvasOverview({ connection, courses, subjects, counts, onChange, toast }: {
  connection: ConnectionStatus;
  courses: CanvasCourse[];
  subjects: HubSubject[];
  counts: PendingCounts;
  onChange: () => void;
  toast: (t: ToastInput) => void;
}) {
  if (!connection.connected) return <ConnectPanel />;

  const mapped = courses.filter(c => c.mapping_status === 'linked' || c.mapping_status === 'created').length;
  const fresh = courses.filter(c => c.mapping_status === 'pending').length;

  return (
    <div className="sp-ov">
      <ProfileCard connection={connection} mapped={mapped} fresh={fresh} onChange={onChange} toast={toast} />
      <CourseMapping courses={courses} subjects={subjects} counts={counts} onChange={onChange} toast={toast} />
    </div>
  );
}
