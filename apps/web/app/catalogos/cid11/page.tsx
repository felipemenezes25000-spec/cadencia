'use client';
import { useCallback, useState } from 'react';
import { PageHeader } from '../../../src/ui/PageHeader';
import { BuscaDeCatalogo, type ColunaCatalogo } from '../../../src/telas/BuscaDeCatalogo';
import { apiFetch } from '../../../src/api';
import { useSessao } from '../../../src/sessao';
import { diaNaClinica } from '../../../src/lib/fuso';
import { CatalogReferenceDate } from '../../../src/components/catalogs/CatalogReferenceDate';

const INICIO_CID11_BRASIL = '2027-01-01';

interface ItemCid11 {
  codigo: string;
  descricao: string;
  capitulo: string | null;
  uri: string;
  competencia: string;
}

const COLUNAS: readonly ColunaCatalogo<ItemCid11>[] = [
  { chave: 'codigo', rotulo: 'Codigo' },
  { chave: 'descricao', rotulo: 'Descricao' },
  { chave: 'capitulo', rotulo: 'Capitulo' },
  { chave: 'competencia', rotulo: 'Competencia' },
];

export default function PaginaCid11() {
  const { clinicId, csrfToken, vinculoAtivo } = useSessao();
  const [dataReferencia, setDataReferencia] = useState(() => {
    const hoje = diaNaClinica(new Date().toISOString(), vinculoAtivo.timezone);
    return hoje < INICIO_CID11_BRASIL ? INICIO_CID11_BRASIL : hoje;
  });

  const buscar = useCallback(async (termo: string) => {
    const res = await apiFetch<{ itens: ItemCid11[] }>(
      `/v1/catalogos/cid11?termo=${encodeURIComponent(termo)}&data=${dataReferencia}`,
      { clinicId, csrfToken },
    );
    return res.itens;
  }, [clinicId, csrfToken, dataReferencia]);

  return (
    <div className="cadencia-page grid gap-8">
      <PageHeader
        titulo="CID-11"
        subtitulo="Classificacao Internacional de Doencas, 11a revisao (OMS)"
        breadcrumbs={[
          { rotulo: 'Catalogos', href: '/catalogos' },
          { rotulo: 'CID-11' },
        ]}
      />
      <CatalogReferenceDate
        value={dataReferencia}
        min={INICIO_CID11_BRASIL}
        onChange={setDataReferencia}
        ajuda="O uso integral da CID-11 no Brasil está previsto para janeiro de 2027; a consulta começa nessa vigência."
      />
      <BuscaDeCatalogo<ItemCid11>
        titulo="CID-11"
        placeholder="Buscar por codigo ou descricao..."
        colunas={COLUNAS}
        buscar={buscar}
      />
    </div>
  );
}
