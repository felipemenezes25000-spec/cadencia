'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  DetalheDemonstrativo, type ItemDemonstrativo,
} from '../../../../src/telas/DetalheDemonstrativo';
import { apiFetch } from '../../../../src/api';
import { useSessao } from '../../../../src/sessao';

interface ItemDaApi {
  itemId: string;
  numeroGuiaPrestador: string;
  valorApresentadoCents: number;
  valorProcessadoCents: number;
  valorLiberadoCents: number;
  valorGlosaCents: number;
  glosaCodigo: string | null;
  glosaDescricao: string | null;
}

/**
 * O detalhe do demonstrativo de pagamento da operadora.
 *
 * A lista de retornos ja empurrava para esta URL — que nao existia. O clique em
 * "abrir demonstrativo" dava 404: o componente estava pronto, testado, e nao
 * havia pagina para receber. Item glosado sem tela e glosa que ninguem recorre.
 */
export default function PaginaDetalheDemonstrativo() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { clinicId, csrfToken } = useSessao();

  const [itens, setItens] = useState<readonly ItemDemonstrativo[]>([]);
  const [titulo, setTitulo] = useState('Demonstrativo');
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    void apiFetch<{
      protocolo?: string; operadoraNome?: string; itens: ItemDaApi[];
    }>(`/v1/tiss/demonstrativos/${id}`, { clinicId, csrfToken })
      .then((r) => {
        if (!vivo) return;
        setTitulo(r.protocolo === undefined
          ? 'Demonstrativo'
          : `Protocolo ${r.protocolo}${r.operadoraNome === undefined ? '' : ` · ${r.operadoraNome}`}`);
        setItens(r.itens.map((x) => ({
          id: x.itemId,
          guiaNumero: x.numeroGuiaPrestador,
          // O demonstrativo da operadora vem por GUIA, nao por paciente nem por
          // procedimento: esses campos so existem do nosso lado, ligando pela
          // guia. Inventar aqui seria afirmar correspondencia que ninguem fez.
          pacienteNome: '—',
          codigoProcedimento: '—',
          nomeProcedimento: '—',
          apresentadoCentavos: x.valorApresentadoCents,
          processadoCentavos: x.valorProcessadoCents,
          liberadoCentavos: x.valorLiberadoCents,
          glosadoCentavos: x.valorGlosaCents,
          codigoGlosa: x.glosaCodigo,
          descricaoGlosa: x.glosaDescricao,
        })));
      })
      .catch(() => { if (vivo) setErro('Nao foi possivel abrir o demonstrativo.'); });
    return () => { vivo = false; };
  }, [id, clinicId, csrfToken]);

  if (erro !== null) {
    return <div className="cadencia-page"><p className="text-sm text-danger">{erro}</p></div>;
  }

  return (
    <DetalheDemonstrativo
      aberto
      titulo={titulo}
      itens={itens}
      aoFechar={() => router.push('/convenios/retornos')}
    />
  );
}
