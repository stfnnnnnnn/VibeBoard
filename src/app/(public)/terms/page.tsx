// DRAFT (spec §9): the owner must review and approve this wording before any public deployment.
import type { Metadata } from 'next';
import LegalPage from '@/components/public/LegalPage';

export const metadata: Metadata = { title: 'Terms · VibeBoard' };

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Use" updated="October 23, 2026">
      <p>VibeBoard is a free student productivity app, provided as is.</p>
      <h2>Your account</h2>
      <p>Keep your login to yourself. You&apos;re responsible for what happens under your account.</p>
      <h2>Your data</h2>
      <p>What you add stays yours. Grade projections and calculations are estimates to help you plan. Always check official grades with your school.</p>
      <h2>Fair use</h2>
      <p>Don&apos;t try to break, overload or access other people&apos;s accounts.</p>
      <h2>Changes</h2>
      <p>We may update the app and these terms. If something important changes, we&apos;ll say so in the app.</p>
    </LegalPage>
  );
}
