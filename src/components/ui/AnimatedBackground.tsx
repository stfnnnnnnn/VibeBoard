interface Props {
  children: React.ReactNode;
  className?: string;
  scrollable?: boolean;
}

export default function AnimatedBackground({ children, className = '', scrollable = false }: Props) {
  return (
    <div className={`vb-bg ${scrollable ? 'min-h-screen' : 'min-h-screen overflow-hidden'} ${className}`}>
      {children}
    </div>
  );
}
