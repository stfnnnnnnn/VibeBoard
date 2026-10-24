import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import LandingNav from '@/components/public/landing/LandingNav';
import Hero from '@/components/public/landing/Hero';
import ProblemCta from '@/components/public/landing/ProblemCta';
import DayArc from '@/components/public/landing/DayArc';
import StudyPulseSection from '@/components/public/landing/StudyPulseSection';
import LandingFooter from '@/components/public/landing/LandingFooter';
import LandingMotion from '@/components/public/landing/LandingMotion';

export const metadata: Metadata = {
  title: 'VibeBoard · Ace the semester. Keep the rest in check.',
  description: 'Grades, deadlines, money and habits on one calm board. Free for students.',
};

export default async function LandingPage() {
  // DB-backed check (session_version): the edge middleware can't see revocations.
  if ((await auth())?.user) redirect('/dashboard');
  return (
    <div className="pub-root lp">
      <div className="lp-glow lp-glow--peach" aria-hidden="true" />
      <div className="lp-glow lp-glow--pink" aria-hidden="true" />
      <LandingNav />
      <main>
        <Hero />
        <ProblemCta />
        <DayArc />
        <StudyPulseSection />
      </main>
      <LandingFooter />
      <LandingMotion />
    </div>
  );
}
