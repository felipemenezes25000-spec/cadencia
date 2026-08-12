'use client';
import { useCallback } from 'react';
import { PageHeader } from '../../../src/ui/PageHeader';
import { BuscaDeCatalogo, type ColunaCatalogo } from '../../../src/telas/BuscaDeCatalogo';
import { apiFetch } from '../../../src/api';
import { useSessao } from '../../../src/sessao';
import { diaNaClinica } from '../../../src/lib/fuso';

interface ItemCid10 {
  codigo: string;
  descricao: string;
  capitulo: number | null;
  competencia: string;
}

const COLUNAS: readonly ColunaCatalogo<ItemCid10>[] = [
  { chave: 'codigo', rotulo: 'Código' },
  { chave: 'descricao', rotulo: 'Descrição' },
  { chave: 'capitulo', rotulo: 'Capítulo' },
  { chave: 'competencia', rotulo: 'Competência' },
];

export default function PaginaCid10() {
  const { clinicId, csrfToken, vinculoAtivo } = useSessao();

  const buscar = useCallback(async (termo: string) => {
    const hoje = diaNaClinica(new Date().toISOString(), vinculoAtivo.timezone);
    const res = await apiFetch<{ itens: ItemCid10[] }>(
      `/v1/catalogos/cid?termo=${encodeURIComponent(termo)}&data=${hoje}`,
      { clinicId, csrfToken },
    );
    return res.itens;
  }, [clinicId, csrfToken, vinculoAtivo.timezone]);

  return (
    <div className="cadencia-page grid gap-8">
      <PageHeader
        titulo="CID-10"
        subtitulo="Classificação Internacional de Doenças, 10a revisão"
        breadcrumbs={[
          { rotulo: 'Catálogos', href: '/catalogos' },
          { rotulo: 'CID-10' },
        ]}
      />
      <BuscaDeCatalogo<ItemCid10>
        titulo="CID-10"
        placeholder="Buscar por código ou descrição..."
        colunas={COLUNAS}
        buscar={buscar}
      />
    </div>
  );
}
