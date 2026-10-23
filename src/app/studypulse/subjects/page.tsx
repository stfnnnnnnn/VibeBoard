import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { findById } from '@/lib/auth/users';
import { listSubjectCards } from '@/lib/studypulse/subjectCards';
import SubjectsGrid from '@/components/studypulse/SubjectsGrid';
import '../studypulse.css';

export default async function SubjectsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  const subjects = await listSubjectCards(parseInt(session.user.id));
  const me = await findById(parseInt(session.user.id));
  return <SubjectsGrid initialSubjects={subjects} defaultYear={me?.year_level ?? null} />;
}
