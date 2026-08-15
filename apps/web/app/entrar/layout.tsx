import type { ReactNode } from 'react';
import './login.css';
import './brand.css';

export default function EntrarLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <>{children}</>;
}
