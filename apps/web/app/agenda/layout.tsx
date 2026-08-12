import type { ReactNode } from 'react';

/** Cada superficie da agenda possui um unico cabecalho; o layout nao o duplica. */
export default function LayoutAgenda({ children }: { readonly children: ReactNode }) {
  return children;
}
