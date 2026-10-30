import { LogOut } from 'lucide-react';
import ProfilePopover, { type ProfileInfo } from './ProfilePopover';

export default function DashboardHeader({ firstName, dateLine, profile, signOut }: {
  firstName: string; dateLine: string; profile: ProfileInfo; signOut: () => Promise<void>;
}) {
  return (
    <header className="db-header">
      <div>
        <div className="db-dateline">{dateLine}</div>
        <h1 className="db-title gradient-text">{firstName}&apos;s Home</h1>
      </div>
      <div className="db-header-actions">
        <form action={signOut} style={{ margin: 0 }}>
          <button type="submit" className="db-btn"><LogOut size={15} aria-hidden="true" />Sign out</button>
        </form>
        <ProfilePopover profile={profile} signOut={signOut} />
      </div>
    </header>
  );
}
