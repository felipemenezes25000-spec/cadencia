'use client';

import { useEffect, useState } from 'react';
import { ChartBar } from '@phosphor-icons/react';
import { GraficoExplorar, type DadoGrafico } from '../../ui/GraficoExplorar';
import { EstadoVazio } from '../../ui/EstadoVazio';
import { Skeleton } from '../../ui/Skeleton';
import { cn } from '../../lib/cn';

/**
 * Panorama da clinica: os graficos operacionais do periodo.
 *
 * `GET /v1/painel/graficos` ja devolvia SEIS conjuntos de dados prontos —
 * atendimentos por dia, por procedimento, por convenio, duracao media por
 * procedimento, pacientes novos e distribuicao etaria — e NENHUMA tela do
 * produto o consumia. A rota existia, respondia, tinha teste de integracao, e
 * nao havia um pixel ligado nela. Desempenho mostrava tres indicadores de
 * variacao e nenhum grafico.
 *
 * DECISOES DE VISUALIZACAO, e por que:
 *
 * - Serie temporal (atendimentos por dia, pacientes novos) vira LINHA. O que se
 *   le ali e tendencia e continuidade; barra por dia num periodo de 90 dias
 *   vira uma cerca ilegivel.
 * - Comparacao entre categorias (procedimento, convenio, duracao, faixa etaria)
 *   vira BARRA. O trabalho do dado e comparar magnitude, e comprimento contra
 *   uma linha de base comum e a codificacao mais precisa que existe para isso.
 * - NAO HA PIZZA em lugar nenhum, inclusive no mix de convenio, onde ela seria a
 *   escolha convencional. A paleta de pizza de `GraficoExplorar` e
 *   `[accent, ok, warn, ai, danger, text-muted]` — ou seja, reaproveita as cores
 *   de STATUS como cores categoricas. Num produto clinico isso e pior que feio:
 *   pinta "Unimed" de vermelho-de-alerta e "Bradesco" de verde-de-sucesso, e
 *   quem bate o olho le julgamento onde so ha identidade. Barra resolve com uma
 *   cor so.
 * - Cada grafico tem UMA serie, entao nenhum precisa de legenda: o titulo do
 *   cartao ja nomeia o que esta desenhado.
 *
 * O recorte de dias e do chamador porque quem manda no periodo e a tela de
 * Desempenho inteira, nao este bloco.
 */

export interface DadosDoPanorama {
  readonly atendimentosNoPeriodo: readonly { dia: string; total: number }[];
  readonly porProcedimento: readonly { rotulo: string; total: number }[];
  readonly porConvenio: readonly { rotulo: string; total: number }[];
  readonly duracaoMedia: readonly { rotulo: string; minutos: number }[];
  readonly pacientesNovos: readonly { dia: string; total: number }[];
  readonly distribuicaoEtaria: readonly { faixa: string; total: number }[];
}

export interface PanoramaProps {
  readonly dias: number;
  readonly carregarDados: () => Promise<DadosDoPanorama>;
}

/** 'AAAA-MM-DD' -> 'DD/MM'. O ano e redundante num eixo de ate 365 dias. */
function diaCurto(iso: string): string {
  const [, mes, dia] = iso.slice(0, 10).split('-');
  return dia === undefined ? iso : `${dia}/${mes}`;
}

/**
 * Mantem os N maiores e soma o resto em "Outros".
 *
 * Um catalogo de procedimentos com 40 itens produz 40 barras, das quais 30 sao
 * indistinguiveis do zero — o grafico fica alto, ilegivel, e esconde justamente
 * o topo que importa. A cauda nao some: vira uma barra somada e honesta.
 */
export function topoComOutros(
  dados: readonly DadoGrafico[], limite: number,
): readonly DadoGrafico[] {
  if (dados.length <= limite) return dados;
  const ordenados = [...dados].sort((a, b) => b.value - a.value);
  const topo = ordenados.slice(0, limite);
  const resto = ordenados.slice(limite).reduce((soma, d) => soma + d.value, 0);
  return resto > 0 ? [...topo, { label: 'Outros', value: resto }] : topo;
}

function Cartao({ titulo, descricao, children }: {
  readonly titulo: string;
  readonly descricao: string;
  readonly children: React.ReactNode;
}) {
  return (
    <section aria-label={titulo} className="cadencia-surface overflow-hidden">
      <div className="border-b border-line px-5 py-4">
        <h3 className="text-sm font-bold tracking-[-0.02em] text-text">{titulo}</h3>
        <p className="mt-0.5 text-xs text-text-muted">{descricao}</p>
      </div>
      <div className="p-3 sm:p-4">{children}</div>
    </section>
  );
}

/** Um cartao sem dado nenhum nao pode desenhar eixo vazio e fingir grafico. */
function SemDados() {
  return (
    <p className="grid min-h-[220px] place-items-center px-4 text-center text-sm text-text-muted">
      Sem dados no período selecionado.
    </p>
  );
}

function GraficoOuVazio({ tipo, dados, eixoY }: {
  readonly tipo: 'bar' | 'line';
  readonly dados: readonly DadoGrafico[];
  readonly eixoY: string;
}) {
  if (dados.length === 0) return <SemDados />;
  return <GraficoExplorar tipo={tipo} dados={dados} altura={240} eixoY={eixoY} />;
}

function PanoramaSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Carregando panorama da clínica"
      className="grid gap-4 lg:grid-cols-2"
    >
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <Skeleton key={i} variant="card" height="320px" />
      ))}
    </div>
  );
}

export function Panorama(p: PanoramaProps) {
  const [dados, setDados] = useState<DadosDoPanorama | null>(null);
  const [erro, setErro] = useState(false);

  useEffect(() => {
    let ativo = true;
    setDados(null);
    setErro(false);
    void p.carregarDados()
      .then((d) => { if (ativo) setDados(d); })
      .catch(() => { if (ativo) setErro(true); });
    return () => { ativo = false; };
  }, [p.carregarDados, p.dias]);

  if (erro) {
    return (
      <EstadoVazio
        icone={ChartBar}
        titulo="Não foi possível carregar o panorama"
        descricao="Os indicadores de variação acima continuam válidos."
      />
    );
  }

  if (dados === null) return <PanoramaSkeleton />;

  const atendimentos: DadoGrafico[] = dados.atendimentosNoPeriodo
    .map((d) => ({ label: diaCurto(d.dia), value: d.total }));
  const novos: DadoGrafico[] = dados.pacientesNovos
    .map((d) => ({ label: diaCurto(d.dia), value: d.total }));
  const procedimentos = topoComOutros(
    dados.porProcedimento.map((d) => ({ label: d.rotulo, value: d.total })), 8);
  const convenios = topoComOutros(
    dados.porConvenio.map((d) => ({ label: d.rotulo, value: d.total })), 8);
  const duracoes = topoComOutros(
    dados.duracaoMedia.map((d) => ({ label: d.rotulo, value: d.minutos })), 8);
  /* Faixa etaria NAO passa por `topoComOutros`: as faixas ja vem ordenadas por
     idade e sao poucas. Reordenar por volume destruiria a leitura, que aqui e a
     forma da distribuicao e nao o ranking. */
  const etarias: DadoGrafico[] = dados.distribuicaoEtaria
    .map((d) => ({ label: d.faixa, value: d.total }));

  const janela = `Últimos ${p.dias} dias`;

  return (
    <div className={cn('grid gap-4', 'lg:grid-cols-2')}>
      <Cartao titulo="Atendimentos por dia" descricao={`${janela} · atendimentos concluídos`}>
        <GraficoOuVazio tipo="line" dados={atendimentos} eixoY="Atendimentos" />
      </Cartao>

      <Cartao titulo="Pacientes novos" descricao={`${janela} · primeiro cadastro`}>
        <GraficoOuVazio tipo="line" dados={novos} eixoY="Pacientes" />
      </Cartao>

      <Cartao titulo="Procedimentos mais realizados" descricao={`${janela} · por volume`}>
        <GraficoOuVazio tipo="bar" dados={procedimentos} eixoY="Atendimentos" />
      </Cartao>

      <Cartao titulo="Mix de convênios" descricao={`${janela} · particular incluído`}>
        <GraficoOuVazio tipo="bar" dados={convenios} eixoY="Atendimentos" />
      </Cartao>

      <Cartao titulo="Duração média por procedimento" descricao={`${janela} · da chamada à conclusão`}>
        <GraficoOuVazio tipo="bar" dados={duracoes} eixoY="Minutos" />
      </Cartao>

      <Cartao titulo="Distribuição etária" descricao="Pacientes atendidos, por faixa">
        <GraficoOuVazio tipo="bar" dados={etarias} eixoY="Pacientes" />
      </Cartao>
    </div>
  );
}
