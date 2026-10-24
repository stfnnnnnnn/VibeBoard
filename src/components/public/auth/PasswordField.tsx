'use client';
import { useState } from 'react';
import { Lock } from 'lucide-react';
import Field from './Field';
import { scorePassword } from '@/lib/auth/passwordStrength';

export default function PasswordField(p: {
  id: string; label: string; value: string; onChange: (v: string) => void; onBlur?: () => void;
  error?: React.ReactNode; autoComplete: 'current-password' | 'new-password'; meter?: boolean;
  labelAside?: React.ReactNode; inputRef?: React.Ref<HTMLInputElement>; placeholder?: string;
}) {
  const [show, setShow] = useState(false);
  const s = p.meter && p.value ? scorePassword(p.value) : null;
  return (
    <>
      <Field
        id={p.id} label={p.label} icon={Lock} type={show ? 'text' : 'password'} value={p.value} onChange={p.onChange}
        onBlur={p.onBlur} error={p.error} autoComplete={p.autoComplete} labelAside={p.labelAside} inputRef={p.inputRef}
        placeholder={p.placeholder ?? 'Your password'} required
        hint={s ? <span>{s.label}{s.hint ? ` · ${s.hint}` : ''}</span> : undefined}
        hintLive={false} warn={s?.label === 'Too long'}
        trailing={
          <button type="button" className="auth-eye" onClick={() => setShow(v => !v)} aria-pressed={show}
            aria-label={show ? 'Hide password' : 'Show password'}>
            {show ? 'Hide' : 'Show'}
          </button>
        }
      />
      {s && (
        <div className="auth-meter" data-score={s.score} aria-hidden="true" style={{ marginTop: -8, marginBottom: 14 }}>
          <i /><i /><i /><i />
        </div>
      )}
    </>
  );
}
