interface Props {
  children: React.ReactNode;
  as?: React.ElementType;
  className?: string;
}

export default function GradientText({ children, as: Tag = 'span', className = '' }: Props) {
  return (
    <Tag className={`gradient-text ${className}`}>
      {children}
    </Tag>
  );
}
