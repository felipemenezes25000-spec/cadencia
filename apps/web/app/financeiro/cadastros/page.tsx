'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  CadastrosFinanceiros, type DadosDosCadastros,
} from '../../../src/telas/CadastrosFinanceiros';
import {
  PainelDeTransferencia, type ContaParaTransferir,
} from '../../../src/ui/PainelDeTransferencia';
import { Botao } from '../../../src/ui/Botao';
import { ArrowsLeftRight } from '@phosphor-icons/react';
import { apiFetch } from '../../../src/api';
import { useSessao } from '../../../src/sessao';

const VAZIO: DadosDosCadastros = {
  fornecedores: [], contas: [], centrosDeCusto: [], recorrencias: [],
};

export default function PaginaCadastrosFinanceiros() {
  const { clinicId, csrfToken } = useSessao();
  const [dados, setDados] = useState<DadosDosCadastros>(VAZIO);
  const [erro, setErro] = useState<string | null>(null);
  const [transferindo, setTransferindo] = useState(false);

  const carregar = useCallback(async () => {
    // As quatro juntas: são listas pequenas e a tela mostra as quatro abas.
    // Buscar por aba faria a troca de aba parecer lenta sem economizar nada.
    const [f, c, cc, r] = await Promise.all([
      apiFetch<{ itens: DadosDosCadastros['fornecedores'] }>(
        '/v1/suppliers', { clinicId, csrfToken }).catch(() => ({ itens: [] })),
      apiFetch<{ itens: DadosDosCadastros['contas'] }>(
        '/v1/bank-accounts', { clinicId, csrfToken }).catch(() => ({ itens: [] })),
      apiFetch<{ itens: DadosDosCadastros['centrosDeCusto'] }>(
        '/v1/cost-centers', { clinicId, csrfToken }).catch(() => ({ itens: [] })),
      apiFetch<{ itens: DadosDosCadastros['recorrencias'] }>(
        '/v1/recurring', { clinicId, csrfToken }).catch(() => ({ itens: [] })),
    ]);
    setDados({
      fornecedores: f.itens, contas: c.itens,
      centrosDeCusto: cc.itens, recorrencias: r.itens,
    });
  }, [clinicId, csrfToken]);

  useEffect(() => {
    void carregar().catch(() => setErro('Não foi possível carregar os cadastros.'));
  }, [carregar]);

  if (erro !== null) {
    return <div className="cadencia-page"><p className="text-sm text-danger">{erro}</p></div>;
  }

  const contasParaTransferir: ContaParaTransferir[] = dados.contas
    // Conta inativa não recebe nem envia: ela existe só para os lançamentos
    // antigos continuarem apontando para algum lugar.
    .filter((c) => c.active)
    .map((c) => ({ bankAccountId: c.bankAccountId, name: c.name }));

  return (
    <>
    <div className="cadencia-page pb-0">
      <Botao variante="secundario" iconeEsquerda={ArrowsLeftRight}
        onClick={() => setTransferindo(true)}>
        Transferir entre contas
      </Botao>
    </div>

    <PainelDeTransferencia
      aberto={transferindo}
      contas={contasParaTransferir}
      aoTransferir={async (t) => {
        await apiFetch('/v1/transfers', {
          method: 'POST', body: t, clinicId, csrfToken });
        // Recarrega: a transferência gera dois lançamentos e muda o saldo das
        // duas contas na lista.
        await carregar();
      }}
      aoFechar={() => setTransferindo(false)}
    />

    <CadastrosFinanceiros
      dados={dados}
      aoCriarFornecedor={async (f) => {
        await apiFetch('/v1/suppliers', {
          method: 'POST', body: f, clinicId, csrfToken });
        await carregar();
      }}
      aoCriarConta={async (c) => {
        await apiFetch('/v1/bank-accounts', {
          method: 'POST', body: c, clinicId, csrfToken });
        await carregar();
      }}
      aoCriarCentroDeCusto={async (c) => {
        await apiFetch('/v1/cost-centers', {
          method: 'POST', body: c, clinicId, csrfToken });
        await carregar();
      }}
      aoRemoverRecorrencia={async (recurringId) => {
        await apiFetch(`/v1/recurring/${recurringId}`, {
          method: 'DELETE', clinicId, csrfToken });
        await carregar();
      }}
    />
    </>
  );
}
