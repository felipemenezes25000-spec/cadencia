'use client';
import { useCallback, useState } from 'react';
import { PageHeader } from '../../../src/ui/PageHeader';
import { Select } from '../../../src/ui/Select';
import { BuscaDeCatalogo, type ColunaCatalogo } from '../../../src/telas/BuscaDeCatalogo';
import { apiFetch } from '../../../src/api';
import { useSessao } from '../../../src/sessao';
import { diaNaClinica } from '../../../src/lib/fuso';
import { CatalogReferenceDate } from '../../../src/components/catalogs/CatalogReferenceDate';

interface ItemTuss {
  tabela: number;
  codigo: string;
  termo: string;
}

const COLUNAS: readonly ColunaCatalogo<ItemTuss>[] = [
  { chave: 'tabela', rotulo: 'Tabela' },
  { chave: 'codigo', rotulo: 'Código' },
  { chave: 'termo', rotulo: 'Termo' },
];

const TABELAS = [
  { value: '18', label: '18 — Diárias e taxas' },
  { value: '19', label: '19 — Materiais e OPME' },
  { value: '20', label: '20 — Medicamentos' },
  { value: '22', label: '22 — Procedimentos e eventos' },
  { value: '98', label: '98 — Outras despesas' },
];

export default function PaginaTuss() {
  const { clinicId, csrfToken, vinculoAtivo } = useSessao();
  const [tabela, setTabela] = useState('22');
  const [dataReferencia, setDataReferencia] = useState(() =>
    diaNaClinica(new Date().toISOString(), vinculoAtivo.timezone));

  const buscar = useCallback(async (termo: string) => {
    const res = await apiFetch<{ itens: ItemTuss[] }>(
      `/v1/catalogos/tuss?tabela=${tabela}&termo=${encodeURIComponent(termo)}&data=${dataReferencia}`,
      { clinicId, csrfToken },
    );
    return res.itens;
  }, [clinicId, csrfToken, tabela, dataReferencia]);

  return (
    <div className="cadencia-page grid gap-8">
      <PageHeader
        titulo="TUSS"
        subtitulo="Terminologia Unificada da Saúde Suplementar (ANS)"
        breadcrumbs={[
          { rotulo: 'Catálogos', href: '/catalogos' },
          { rotulo: 'TUSS' },
        ]}
      />
      <div className="grid gap-4 md:grid-cols-2">
        <Select
          rotulo="Tabela TUSS"
          opcoes={TABELAS}
          value={tabela}
          onChange={setTabela}
        />
        <CatalogReferenceDate
          value={dataReferencia}
          onChange={setDataReferencia}
          ajuda="A busca mostra os termos TUSS vigentes na data informada."
        />
      </div>
      <BuscaDeCatalogo<ItemTuss>
        titulo="TUSS"
        placeholder="Buscar por código ou termo…"
        colunas={COLUNAS}
        buscar={buscar}
      />
    </div>
  );
}
