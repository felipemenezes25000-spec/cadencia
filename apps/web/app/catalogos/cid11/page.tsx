'use client';
import { useCallback } from 'react';
import { PageHeader } from '../../../src/ui/PageHeader';
import { BuscaDeCatalogo, type ColunaCatalogo } from '../../../src/telas/BuscaDeCatalogo';
import { apiFetch } from '../../../src/api';
import { useSessao } from '../../../src/sessao';
import { diaNaClinica } from '../../../src/lib/fuso';

interface ItemCid11 {
  codigo: string;
  descricao: string;
  capitulo: string | null;
  uri: string;
  competencia: string;
}

const COLUNAS: readonly ColunaCatalogo<ItemCid11>[] = [
  { chave: 'codigo', rotulo: 'Código' },
  { chave: 'descricao', rotulo: 'Descrição' },
  { chave: 'capitulo', rotulo: 'Capítulo' },
  { chave: 'competencia', rotulo: 'Competência' },
];

export default function PaginaCid11() {
  const { clinicId, csrfToken, vinculoAtivo } = useSessao();

  const buscar = useCallback(async (termo: string) => {
    const hoje = diaNaClinica(new Date().toISOString(), vinculoAtivo.timezone);
    const res = await apiFetch<{ itens: ItemCid11[] }>(
      `/v1/catalogos/cid11?termo=${encodeURIComponent(termo)}&data=${hoje}`,
      { clinicId, csrfToken },
    );
    return res.itens;
  }, [clinicId, csrfToken, vinculoAtivo.timezone]);

  return (
    <div className="cadencia-page grid gap-8">
      <PageHeader
        titulo="CID-11"
        subtitulo="Classificação Internacional de Doenças, 11a revisão (OMS)"
        breadcrumbs={[
          { rotulo: 'Catálogos', href: '/catalogos' },
          { rotulo: 'CID-11' },
        ]}
      />
      <BuscaDeCatalogo<ItemCid11>
        titulo="CID-11"
        placeholder="Buscar por código ou descrição..."
        colunas={COLUNAS}
        buscar={buscar}
      />
    </div>
  );
}
