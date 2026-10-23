// DRAFT (spec §9): the owner must review and approve this wording before any public deployment.
import type { Metadata } from 'next';
import LegalPage from '@/components/public/LegalPage';

export const metadata: Metadata = { title: 'Privacy · VibeBoard' };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="October 23, 2026">
      <p>VibeBoard is a student project. We keep only what the app needs to work, and we never sell your data.</p>
      <h2>What we store</h2>
      <ul>
        <li>Your name and email address.</li>
        <li>If you sign in with Google: your Google account ID and, if you choose to give it, your year level. We don&apos;t get your Google password.</li>
        <li>If you use a password: a one-way hash of it, never the password itself.</li>
        <li>What you add to the app: subjects, grades, tasks, schedules, money entries and habits.</li>
        <li>If you connect Canvas: an access token, stored encrypted, and the course items it syncs.</li>
      </ul>
      <h2>Why</h2>
      <p>To show your board, keep you signed in, let you reset your password, and sync Canvas if you ask us to.</p>
      <h2>Emails</h2>
      <p>We only email you to confirm your address or reset your password.</p>
      <h2>Deleting your data</h2>
      <p>Ask us to delete your account and we will remove it along with everything linked to it.</p>
    </LegalPage>
  );
}
