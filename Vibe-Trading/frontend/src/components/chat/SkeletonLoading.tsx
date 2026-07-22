/**
 * Skeleton loading placeholders shown while session messages are being fetched.
 */
export function SkeletonLoading() {
  return (
    <div className="space-y-4 py-4">
      {[1, 2, 3].map(i => (
        <div key={i} className="flex gap-3 animate-pulse">
          <div className="h-8 w-8 rounded-full bg-muted shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="h-4 bg-muted rounded w-3/4" />
            <div className="h-3 bg-muted/60 rounded w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}
