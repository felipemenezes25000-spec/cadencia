'use client';
import Link from 'next/link';
import { Heartbeat, Barcode, Pill } from '@phosphor-icons/react';
import { PageHeader } from '../../src/ui/PageHeader';

const CATALOGOS = [
  { href: '/catalogos/cid10', icone: Heartbeat, titulo: 'CID-10', descricao: 'Classificacao Internacional de Doencas, 10a revisao' },
  { href: '/catalogos/cid11', icone: Heartbeat, titulo: 'CID-11', descricao: 'Classificacao Internacional de Doencas, 11a revisao (OMS)' },
  { href: '/catalogos/tuss', icone: Barcode, titulo: 'TUSS', descricao: 'Terminologia Unificada da Saude Suplementar (ANS)' },
  { href: '#', icone: Pill, titulo: 'Bulas', descricao: 'Em breve — catalogo de bulas ANVISA' },
] as const;

export default function PaginaCatalogos() {
  return (
    <div className="cadencia-page grid gap-8">
      <PageHeader titulo="Catalogos" subtitulo="Tabelas de referencia do sistema de saude brasileiro." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {CATALOGOS.map((cat) => {
          const Icone = cat.icone;
          const desabilitado = cat.href === '#';
          const Wrapper = desabilitado ? 'div' : Link;
          return (
            <Wrapper key={cat.titulo} {...(desabilitado ? {} : { href: cat.href })}
              className={`rounded-xl border border-line bg-surface p-5 transition ${desabilitado ? 'opacity-50' : 'hover:border-accent hover:shadow-elev-1'}`}>
              <div className="mb-3 grid h-10 w-10 place-items-center rounded-lg bg-accent-soft text-accent">
                <Icone size={22} weight="duotone" />
              </div>
              <h2 className="font-semibold text-text">{cat.titulo}</h2>
              <p className="mt-1 text-sm text-text-muted">{cat.descricao}</p>
            </Wrapper>
          );
        })}
      </div>
    </div>
  );
}
