interface Props {
  children: React.ReactNode;
  className?: string;
  strong?: boolean;
  as?: React.ElementType;
}

export default function GlassCard({ children, className = '', strong = false, as: Tag = 'div' }: Props) {
  return (
    <Tag className={`${strong ? 'glass-strong' : 'glass'} rounded-2xl shadow-lg ${className}`}>
      {children}
    </Tag>
  );
}
