import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { listSubjectCards } from '@/lib/studypulse/subjectCards';
import SubjectsGrid from '@/components/studypulse/SubjectsGrid';
import '../studypulse.css';

export default async function SubjectsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/login');
  const subjects = await listSubjectCards(parseInt(session.user.id));
  return <SubjectsGrid initialSubjects={subjects} />;
}
