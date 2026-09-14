import { redirect } from 'next/navigation';

/** This route's entire reason to exist — the class schedule, conflict warnings, workload
 *  heatmap, and events/reminders `WorkboardWeekView` used to render here alone — is now folded
 *  into the Timeline tab's own week view (see `WorkTimelineView.tsx`), which additionally shows
 *  work items alongside them and supports day-focus. A second, narrower page showing a subset
 *  of what Timeline now shows would only invite the two to drift apart, so this route redirects
 *  rather than keeping its own copy. Kept as a redirect rather than deleted outright in case
 *  anything still links here (a bookmark, browser history) — it lands the user on the surface
 *  that replaced it instead of a 404. */
export default function WorkboardCalendarPage() {
  redirect('/workboard');
}
