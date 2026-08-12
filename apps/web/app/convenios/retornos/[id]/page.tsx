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
 * A lista de retornos já empurrava para esta URL — que não existia. O clique em
 * "abrir demonstrativo" dava 404: o componente estava pronto, testado, e não
 * havia página para receber. Item glosado sem tela é glosa que ninguém recorre.
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
          // O demonstrativo da operadora vem por GUIA, não por paciente nem por
          // procedimento: esses campos só existem do nosso lado, ligando pela
          // guia. Inventar aqui seria afirmar correspondência que ninguém fez.
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
      .catch(() => { if (vivo) setErro('Não foi possível abrir o demonstrativo.'); });
    return () => { vivo = false; };
  }, [id, clinicId, csrfToken]);

  if (erro !== null) {
    return <div className="py-2"><p className="text-sm text-danger">{erro}</p></div>;
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
