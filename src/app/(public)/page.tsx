import type { Metadata } from 'next';
import LandingNav from '@/components/public/landing/LandingNav';
import Hero from '@/components/public/landing/Hero';
import ProblemCta from '@/components/public/landing/ProblemCta';
import DayArc from '@/components/public/landing/DayArc';
import StudyPulseSection from '@/components/public/landing/StudyPulseSection';
import LandingFooter from '@/components/public/landing/LandingFooter';

export const metadata: Metadata = {
  title: 'VibeBoard · Ace the semester. Keep the rest in check.',
  description: 'Grades, deadlines, money and habits on one calm board. Free for students.',
};

export default function LandingPage() {
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
    </div>
  );
}
