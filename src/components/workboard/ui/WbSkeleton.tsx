export interface WbSkeletonProps {
  width?: number | string;
  height?: number | string;
  radius?: number | string;
  style?: React.CSSProperties;
}

export default function WbSkeleton({ width = '100%', height = 14, radius, style }: WbSkeletonProps) {
  return <span aria-hidden className="wb-skeleton" style={{ display: 'block', width, height, borderRadius: radius, ...style }} />;
}
