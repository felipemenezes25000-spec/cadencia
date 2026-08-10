'use client';

import type { ReactNode } from 'react';
import { ConveniosLayout } from '../../src/telas/ConveniosLayout';

export default function LayoutConvenios({ children }: { children: ReactNode }) {
  return <ConveniosLayout>{children}</ConveniosLayout>;
}
