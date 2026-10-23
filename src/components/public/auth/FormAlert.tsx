import { AlertCircle, Clock, Info } from 'lucide-react';

export default function FormAlert({ tone, children }: { tone: 'error' | 'warn' | 'info'; children: React.ReactNode }) {
  const Icon = tone === 'error' ? AlertCircle : tone === 'warn' ? Clock : Info;
  return (
    <div className={`auth-alert auth-alert--${tone}`} role="alert">
      <Icon size={18} aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}
