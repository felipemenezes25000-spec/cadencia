'use client';

import Link from 'next/link';

const links = [
  { href: '/hoje', label: 'Hoje' },
  { href: '/agenda', label: 'Agenda' },
  { href: '/pacientes', label: 'Pacientes' },
] as const;

export function BarraDeNavegacao() {
  return (
    <nav aria-label="Menu principal" className="flex gap-4 border-b px-4 py-2">
      <Link href="/" className="font-semibold mr-4">Cadencia</Link>
      {links.map((l) => (
        <Link key={l.href} href={l.href}>{l.label}</Link>
      ))}
    </nav>
  );
}
