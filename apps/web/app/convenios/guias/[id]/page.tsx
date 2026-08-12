'use client';

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { DetalheGuia, type GuiaDetalhe } from '../../../../src/telas/DetalheGuia';
import { apiFetch, ApiError } from '../../../../src/api';
import { useSessao } from '../../../../src/sessao';

/**
 * Detalhe da guia TISS.
 *
 * A tela existia pronta e testada desde a Fase 4 e NENHUM arquivo a importava —
 * só faltava esta rota. Na prática, a lista de guias mostrava número e valor e
 * não havia como ver por que uma delas estava incompleta.
 *
 * `DetalheGuia` é um painel lateral (`aberto`/`aoFechar`). Como página ele abre
 * sempre, e fechar volta para a lista — mesmo padrão de
 * `/convenios/recursos/[id]`. Assim o link é compartilhável: a gerente manda a
 * URL da guia glosada para o faturamento em vez de dizer "procura a 1042".
 */

/**
 * O que a ROTA devolve — nomes diferentes dos que a tela lê.
 *
 * `apiFetch<T>` é um cast, não uma validação: tipar a resposta como
 * `GuiaDetalhe` fazia o TypeScript aceitar sem reclamar e, em runtime, TODO
 * campo chegava `undefined`. O painel abria com "Guia undefined", o valor saía
 * "R$ NaN,NaN" (`Math.abs(undefined)`) e o botão de ajuste chamava
 * `/v1/tiss/guias/undefined/ajuste`. A tradução explícita é o único lugar onde
 * as duas nomenclaturas se encontram.
 */
interface GuiaDetalheDaApi {
  readonly guiaId: string;
  readonly numeroGuiaPrestador: string;
  readonly pacienteNome: string;
  readonly operadoraNome: string;
  readonly registroAns: string;
  readonly numeroCarteira: string;
  readonly atendimentoRn: boolean;
  readonly cnes: string;
  readonly conselhoProfissional: string;
  readonly numeroConselho: string;
  readonly ufConselho: string;
  readonly cbos: string;
  readonly indicacaoAcidente: string;
  readonly regimeAtendimento: string;
  readonly tipoConsulta: string;
  readonly codigoTabela: string;
  readonly codigoProcedimento: string;
  readonly nomeProcedimento: string;
  /** Numeric em REAIS no banco. A tela formata centavos. */
  readonly valorProcedimento: number;
  readonly dataAtendimento: string;
  readonly observacao: string | null;
  readonly ajustes: ReadonlyArray<{
    readonly ajusteId: string;
    readonly campoAlterado: string;
    readonly valorAnterior: string;
    readonly valorNovo: string;
    readonly motivo: string;
    readonly createdBy: string;
    readonly createdAt: string;
  }>;
}

function daApi(r: GuiaDetalheDaApi): GuiaDetalhe {
  return {
    id: r.guiaId,
    numeroGuia: r.numeroGuiaPrestador,
    pacienteNome: r.pacienteNome,
    // A rota não devolve CNS. Vazio é honesto; inventar campo seria pior.
    numeroCns: '',
    operadoraNome: r.operadoraNome,
    registroAns: r.registroAns,
    numeroCarteira: r.numeroCarteira,
    atendimentoRn: r.atendimentoRn,
    cnes: r.cnes,
    conselhoProfissional: r.conselhoProfissional,
    numeroConselho: r.numeroConselho,
    ufConselho: r.ufConselho,
    cbos: r.cbos,
    indicacaoAcidente: r.indicacaoAcidente,
    regimeAtendimento: r.regimeAtendimento,
    tipoConsulta: r.tipoConsulta,
    codigoTabela: r.codigoTabela,
    codigoProcedimento: r.codigoProcedimento,
    nomeProcedimento: r.nomeProcedimento,
    valorCentavos: Math.round(r.valorProcedimento * 100),
    dataAtendimento: r.dataAtendimento,
    observacao: r.observacao,
    ajustes: r.ajustes.map((a) => ({
      id: a.ajusteId,
      campoAlterado: a.campoAlterado,
      valorAnterior: a.valorAnterior,
      valorNovo: a.valorNovo,
      motivo: a.motivo,
      autorNome: a.createdBy,
      criadoEm: a.createdAt,
    })),
  };
}

/**
 * Valor vigente do campo que o ajuste vai alterar.
 *
 * As chaves são as do `<select>` de `DetalheGuia` (CAMPOS_AJUSTAVEIS), que usa
 * o nome da COLUNA — `codigo_procedimento`, `valor_procedimento` — enquanto o
 * objeto da tela usa camelCase. O valor volta como texto porque
 * `tiss.guia_ajuste` guarda antes/depois como texto: o ajuste registra o que
 * mudou, não um tipo.
 */
function valorAtualDoCampo(g: GuiaDetalhe, campo: string): string {
  switch (campo) {
    case 'codigo_procedimento': return g.codigoProcedimento;
    case 'codigo_tabela': return g.codigoTabela;
    // Em reais, com duas casas: é o formato que a guia leva para a operadora.
    case 'valor_procedimento': return (g.valorCentavos / 100).toFixed(2);
    case 'tipo_consulta': return g.tipoConsulta;
    case 'regime_atendimento': return g.regimeAtendimento;
    case 'cbos': return g.cbos;
    // Campo novo no select sem entrada aqui: string vazia passa no schema
    // (`max(500)`, sem mínimo) em vez de derrubar o ajuste inteiro.
    default: return '';
  }
}

export default function PaginaDetalheDaGuia(
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = use(params);
  const router = useRouter();
  const { clinicId, csrfToken } = useSessao();


  const [guia, setGuia] = useState<GuiaDetalhe | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function carregar(): Promise<void> {
    const r = await apiFetch<GuiaDetalheDaApi>(
      `/v1/tiss/guias/${id}`, { clinicId, csrfToken })
      .catch((e: unknown) => {
        setErro(e instanceof ApiError && e.status === 404
          ? 'Esta guia não existe nesta unidade.'
          : 'Não foi possível carregar a guia.');
        return null;
      });
    if (r !== null) setGuia(daApi(r));
  }

  useEffect(() => { void carregar(); }, [id, clinicId, csrfToken]);

  if (erro !== null) {
    return (
      <div className="py-2">
        <p className="text-sm text-danger">{erro}</p>
      </div>
    );
  }
  if (guia === null) {
    return (
      <div className="py-2">
        <p className="text-sm text-text-muted">Carregando…</p>
      </div>
    );
  }

  return (
    <DetalheGuia
      aberto
      guia={guia}
      aoFechar={() => router.push('/convenios')}
      aoAjustar={async (input) => {
        await apiFetch(`/v1/tiss/guias/${input.guiaId}/ajuste`, {
          method: 'POST',
          body: {
            campoAlterado: input.campoAlterado,
            // Obrigatório no schema da rota e NOT NULL em `tiss.guia_ajuste`.
            // Sem ele, todo ajuste voltava 400 e o painel não mostrava por quê.
            // O valor de antes vem da guia carregada — é o que a trilha precisa
            // para responder "o que estava escrito aqui antes do faturamento
            // mexer", que é a pergunta de uma auditoria da operadora.
            valorAnterior: valorAtualDoCampo(guia, input.campoAlterado),
            valorNovo: input.valorNovo,
            motivo: input.motivo,
          },
          clinicId, csrfToken,
        });
        // Recarrega em vez de mexer no estado local: o ajuste grava uma linha
        // em `tiss.guia_ajuste`, e a lista de ajustes da tela precisa refletir
        // o que o BANCO guardou — inclusive o carimbo de quem e quando.
        await carregar();
      }}
    />
  );
}
