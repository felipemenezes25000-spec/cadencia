import { Skeleton } from '../src/ui/Skeleton';

export default function Loading() {
  return (
    <div className="cadencia-page space-y-6" role="status" aria-label="Carregando conteúdo">
      <div className="space-y-2"><Skeleton variant="text" width="220px" /><Skeleton variant="text" width="360px" /></div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} variant="card" height="78px" />)}</div>
      <Skeleton variant="card" height="440px" />
    </div>
  );
}
