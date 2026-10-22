import WbSkeleton from '@/components/workboard/ui/WbSkeleton';

/* Route-level and Suspense placeholder shaped like the header, hero and first tab (spec §5.5). */
export default function FinanceSkeleton() {
  return (
    <div className="vb-bg fin-page" aria-busy="true" aria-label="Loading finances">
      <div className="fin-wrap">
        <div className="fin-header"><WbSkeleton width={220} height={28} radius={8} /></div>
        <div className="fin-hero">
          <div className="fin-hero__body">
            <div className="fin-hero__left fin-hero__skel">
              <WbSkeleton width={120} height={12} />
              <WbSkeleton width={260} height={52} radius={10} />
              <WbSkeleton width={300} height={14} />
            </div>
            <div className="fin-hero__pace"><WbSkeleton height={110} radius={8} /></div>
          </div>
          <div className="fin-tabs" aria-hidden><WbSkeleton width={300} height={20} style={{ margin: '14px 0' }} /></div>
        </div>
        <div className="fin-card">
          {[0, 1, 2, 3].map(i => <WbSkeleton key={i} height={36} radius={8} style={{ marginBottom: 10 }} />)}
        </div>
      </div>
    </div>
  );
}
