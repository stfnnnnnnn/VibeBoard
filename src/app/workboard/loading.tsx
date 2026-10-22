import './workboard.css';
import WbSkeleton from '@/components/workboard/ui/WbSkeleton';

export default function WorkboardLoading() {
  return (
    <div className="vb-bg min-h-screen" style={{ padding: '40px 5%' }} aria-busy="true" aria-label="Loading Workboard">
      <WbSkeleton width={220} height={34} style={{ marginBottom: 10 }} />
      <WbSkeleton width={300} height={14} style={{ marginBottom: 24 }} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14, marginBottom: 22 }}>
        {[0, 1, 2, 3].map(i => <WbSkeleton key={i} height={96} radius={16} />)}
      </div>
      <WbSkeleton height={40} radius={10} style={{ marginBottom: 18, maxWidth: 420 }} />
      <div style={{ display: 'grid', gap: 8 }}>
        {Array.from({ length: 8 }, (_, i) => <WbSkeleton key={i} height={34} />)}
      </div>
    </div>
  );
}
