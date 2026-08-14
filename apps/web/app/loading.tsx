import { SkeletonDePagina } from '../src/ui/SkeletonDePagina';

/** Fallback das rotas que não declaram um formato próprio. */
export default function Loading() {
  return <SkeletonDePagina forma="painel" />;
}
