import { ButtonHTMLAttributes } from 'react';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'pink' | 'blue' | 'ghost';
  fullWidth?: boolean;
}

export default function PillButton({
  children,
  variant = 'pink',
  fullWidth = false,
  className = '',
  ...props
}: Props) {
  const base = fullWidth ? '' : 'w-auto px-8';
  const variantClass = {
    pink:  'vb-btn-pink',
    blue:  'vb-btn-blue',
    ghost: 'vb-btn-ghost',
  }[variant];

  return (
    <button className={`${variantClass} ${base} ${className}`} {...props}>
      {children}
    </button>
  );
}
