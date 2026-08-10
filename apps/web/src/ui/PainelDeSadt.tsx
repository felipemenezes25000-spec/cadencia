// apps/web/src/ui/PainelDeSadt.tsx
'use client';

import { useState } from 'react';
import { FlaskIcon, Trash, Warning } from '@phosphor-icons/react';
import { PainelLateral } from './PainelLateral';
import { Botao } from './Botao';
import type { ItemDaGuia, NovaGuiaSadt } from '../lib/sadt-tipos';

export interface ProcedimentoTuss {
  readonly codigo: string;
  readonly termo: string;
  readonly tabela: number;
}

export type { ItemDaGuia, NovaGuiaSadt } from '../lib/sadt-tipos';

export interface GuiaSadtEmitida {
  readonly guiaId: string;
  readonly numeroGuiaPrestador: string;
  readonly tipoAtendimento: string;
  readonly criadoEm: string;
  readonly valorTotalCentavos: number;
  readonly procedimentos: readonly {
    readonly codigoProcedimento: string;
    readonly descricao: string;
    readonly quantidade: number;
  }[];
}

export interface PainelDeSadtProps {
  readonly aberto: boolean;
  /** Nome da operadora. `null` = particular, e ai nao ha guia. */
  readonly convenio: string | null;
  readonly guias: readonly GuiaSadtEmitida[];
  /**
   * `true` enquanto o atendimento e rascunho.
   *
   * A guia SP/SADT documenta o que foi EXECUTADO, e o que foi executado so esta
   * fechado quando o atendimento fecha. Alem disso ela precisa apontar para uma
   * versao SELADA do registro clinico — sem isso seria cobranca justificada por
   * um texto que ainda pode mudar. Entao aqui o painel COMPOE; quem emite e o
   * finalizar, pelo mesmo caminho que ja projeta a guia de consulta.
   */
  readonly emitirAoFinalizar?: boolean;
  readonly buscarProcedimento: (termo: string) => Promise<readonly ProcedimentoTuss[]>;
  readonly aoEmitir: (g: NovaGuiaSadt) => Promise<void>;
  readonly aoFechar: () => void;
}

/** `dm_tipoAtendimento` do XSD 4.03.00 — nao e sequencial, nao tem '05'. */
const TIPOS_ATENDIMENTO: readonly { id: string; rotulo: string }[] = [
  { id: '04', rotulo: 'Exame' },
  { id: '01', rotulo: 'Remocao' },
  { id: '02', rotulo: 'Pequena cirurgia' },
  { id: '03', rotulo: 'Terapias' },
  { id: '08', rotulo: 'Quimioterapia' },
  { id: '09', rotulo: 'Radioterapia' },
  { id: '10', rotulo: 'Terapia renal substitutiva' },
  { id: '13', rotulo: 'Consulta' },
  { id: '23', rotulo: 'Atendimento domiciliar' },
];

/**
 * Texto digitado -> centavos inteiros.
 *
 * Aceita '45,50' e '45.50' porque o teclado numerico do celular manda ponto e o
 * do computador manda virgula. Devolver float faria o servidor arredondar por
 * conta propria, e centavo perdido em guia de convenio e glosa.
 */
function paraCentavos(texto: string): number {
  const limpo = texto.replace(/[^\d,.-]/g, '');

  // Em pt-BR, virgula presente decide tudo: ela e o separador DECIMAL e todo
  // ponto e de milhar. O `.replace(',', '.')` sozinho transformava "1.200,00"
  // em "1.200.00", que `parseFloat` le como 1.2 — a guia saia com R$ 1,20 no
  // lugar de R$ 1.200,00, e o valor errado ia para a operadora.
  //
  // Sem virgula, um ponto unico continua sendo decimal (o teclado numerico do
  // celular manda ponto, como diz o comentario acima). Dois ou mais pontos so
  // podem ser milhar — numero nao tem duas virgulas decimais.
  const pontos = (limpo.match(/\./g) ?? []).length;
  const normalizado = limpo.includes(',')
    ? limpo.replace(/\./g, '').replace(',', '.')
    : pontos > 1 ? limpo.replace(/\./g, '') : limpo;

  const n = Number.parseFloat(normalizado);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function reais(centavos: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency', currency: 'BRL',
  }).format(centavos / 100);
}

/**
 * Monta a guia SP/SADT do atendimento — a guia de exame.
 *
 * A guia de consulta nasce sozinha ao finalizar; esta nao pode: nao ha como
 * derivar do atendimento quais exames o medico quis pedir, e inventar exame em
 * guia de convenio e fraude, nao conveniencia. Por isso a tela existe.
 */
export function PainelDeSadt(p: PainelDeSadtProps) {
  const [tipoAtendimento, setTipoAtendimento] = useState(TIPOS_ATENDIMENTO[0]!.id);
  const [carater, setCarater] = useState<'1' | '2'>('1');
  const [indicacao, setIndicacao] = useState('');
  const [termo, setTermo] = useState('');
  const [achados, setAchados] = useState<readonly ProcedimentoTuss[]>([]);
  const [itens, setItens] = useState<readonly ItemDaGuia[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [emitindo, setEmitindo] = useState(false);
  const [guardada, setGuardada] = useState(false);

  const particular = p.convenio === null;
  const total = itens.reduce((s, i) => s + i.valorCentavos * i.quantidade, 0);

  async function buscar(t: string): Promise<void> {
    setTermo(t);
    setErro(null);
    if (t.trim().length < 2) { setAchados([]); return; }
    setAchados(await p.buscarProcedimento(t).catch(() => []));
  }

  function adicionar(x: ProcedimentoTuss): void {
    if (itens.some((i) => i.codigoProcedimento === x.codigo)) {
      // Duas linhas do mesmo codigo na mesma guia sao glosadas como
      // duplicidade. Quantidade e o campo certo para "fez duas vezes".
      setErro(`${x.codigo} ja esta na guia. Ajuste a quantidade.`);
      return;
    }
    setErro(null);
    setItens((atual) => [...atual, {
      codigoTabela: String(x.tabela).padStart(2, '0'),
      codigoProcedimento: x.codigo,
      descricao: x.termo,
      quantidade: 1,
      valorCentavos: 0,
    }]);
  }

  function alterar(codigo: string, campo: 'quantidade' | 'valorCentavos', valor: number): void {
    setItens((atual) => atual.map(
      (i) => (i.codigoProcedimento === codigo ? { ...i, [campo]: valor } : i)));
  }

  async function emitir(): Promise<void> {
    setErro(null);
    setEmitindo(true);
    try {
      await p.aoEmitir({
        caraterAtendimento: carater,
        tipoAtendimento,
        indicacaoClinica: indicacao.trim() === '' ? null : indicacao.trim(),
        procedimentos: itens,
      });
      if (p.emitirAoFinalizar === true) {
        // Nada some da tela: o medico precisa continuar vendo o que pediu ate
        // o atendimento fechar, e ainda pode acrescentar um exame.
        setGuardada(true);
        return;
      }
      // So limpa DEPOIS de o servidor confirmar. Limpar antes perderia a guia
      // montada num erro de rede, e na segunda montagem alguem digita errado.
      setItens([]);
      setIndicacao('');
      setTermo('');
      setAchados([]);
    } catch {
      setErro('Nao foi possivel emitir a guia. O que voce montou continua aqui.');
    } finally {
      setEmitindo(false);
    }
  }

  return (
    <PainelLateral aberto={p.aberto} titulo="Guia de exames (SP/SADT)"
      largura="lg" aoFechar={p.aoFechar}>
      <div className="grid gap-5">
        {particular ? (
          <p className="flex items-start gap-2 rounded-[var(--r-sm)] border border-warn/40 bg-warn/5 p-3 text-sm text-text">
            <Warning size={18} weight="fill" aria-hidden="true" className="mt-0.5 shrink-0 text-warn" />
            <span>
              Atendimento <strong>particular</strong>: guia SP/SADT so existe
              contra operadora. Emitir aqui criaria uma guia que nunca sera
              enviada e ficaria pendente para sempre no faturamento.
            </span>
          </p>
        ) : (
          <p className="text-sm text-text-muted">
            Guia para <strong className="text-text">{p.convenio}</strong>.
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium text-text">Tipo de atendimento</span>
            <select
              value={tipoAtendimento}
              onChange={(e) => setTipoAtendimento(e.target.value)}
              className="rounded-[var(--r-sm)] border border-line bg-surface px-3 py-2 text-sm text-text"
            >
              {TIPOS_ATENDIMENTO.map((t) => (
                <option key={t.id} value={t.id}>{t.rotulo}</option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium text-text">Carater</span>
            <select
              value={carater}
              onChange={(e) => setCarater(e.target.value as '1' | '2')}
              className="rounded-[var(--r-sm)] border border-line bg-surface px-3 py-2 text-sm text-text"
            >
              <option value="1">Eletivo</option>
              <option value="2">Urgencia / emergencia</option>
            </select>
          </label>
        </div>

        <label className="grid gap-1.5 text-sm">
          <span className="font-medium text-text">Indicacao clinica</span>
          <textarea
            rows={2}
            maxLength={500}
            value={indicacao}
            onChange={(e) => setIndicacao(e.target.value)}
            placeholder="Por que este exame foi pedido"
            className="rounded-[var(--r-sm)] border border-line bg-surface px-3 py-2 text-sm text-text"
          />
          <span className="text-xs text-text-muted">
            E o que a operadora le para decidir se cobre. Exame sem indicacao e
            o motivo de glosa mais comum em SP/SADT.
          </span>
        </label>

        <section className="grid gap-2">
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium text-text">Procedimento</span>
            <input
              type="text"
              value={termo}
              onChange={(e) => { void buscar(e.target.value); }}
              placeholder="Busque por nome ou codigo TUSS"
              className="rounded-[var(--r-sm)] border border-line bg-surface px-3 py-2 text-sm text-text"
            />
          </label>

          {achados.length > 0 && (
            <ul className="grid max-h-48 gap-1 overflow-y-auto rounded-[var(--r-sm)] border border-line p-1">
              {achados.map((x) => (
                <li key={x.codigo} className="flex items-center gap-2 px-2 py-1.5 text-sm">
                  <span className="min-w-0 flex-1">
                    <span className="font-mono text-xs text-text-muted">{x.codigo}</span>
                    {' '}<span className="text-text">{x.termo}</span>
                  </span>
                  <Botao tamanho="sm" variante="secundario"
                    onClick={() => adicionar(x)}>
                    Adicionar
                  </Botao>
                </li>
              ))}
            </ul>
          )}
        </section>

        {itens.length > 0 && (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-text-muted">
                <th className="pb-1">Codigo</th>
                <th className="pb-1">Qtd</th>
                <th className="pb-1">Valor unit.</th>
                <th className="pb-1 text-right">Total</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {itens.map((i) => (
                <tr key={i.codigoProcedimento} className="border-t border-line">
                  <td className="py-2">
                    <span className="block font-mono text-xs">{i.codigoProcedimento}</span>
                    <span className="block text-xs text-text-muted">{i.descricao}</span>
                  </td>
                  <td className="py-2">
                    <label className="sr-only" htmlFor={`q-${i.codigoProcedimento}`}>
                      Quantidade de {i.descricao}
                    </label>
                    <input
                      id={`q-${i.codigoProcedimento}`}
                      type="number" min={1} max={999} value={i.quantidade}
                      onChange={(e) => alterar(i.codigoProcedimento, 'quantidade',
                        Math.max(1, Number(e.target.value)))}
                      className="w-16 rounded-[var(--r-sm)] border border-line bg-surface px-2 py-1 text-sm"
                    />
                  </td>
                  <td className="py-2">
                    <label className="sr-only" htmlFor={`v-${i.codigoProcedimento}`}>
                      Valor unitario de {i.descricao}
                    </label>
                    <input
                      id={`v-${i.codigoProcedimento}`}
                      type="text" inputMode="decimal"
                      defaultValue=""
                      placeholder="0,00"
                      onChange={(e) => alterar(i.codigoProcedimento, 'valorCentavos',
                        paraCentavos(e.target.value))}
                      className="w-24 rounded-[var(--r-sm)] border border-line bg-surface px-2 py-1 text-sm"
                    />
                  </td>
                  <td className="py-2 text-right tabular-nums text-text">
                    {reais(i.valorCentavos * i.quantidade)}
                  </td>
                  <td className="py-2 text-right">
                    <button
                      type="button"
                      aria-label={`Remover item ${i.descricao}`}
                      onClick={() => setItens((a) => a.filter(
                        (x) => x.codigoProcedimento !== i.codigoProcedimento))}
                      className="rounded p-1 text-text-muted hover:bg-surface-hover hover:text-danger"
                    >
                      <Trash size={16} aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-line font-semibold">
                <td colSpan={3} className="pt-2">Total da guia</td>
                <td className="pt-2 text-right tabular-nums text-text">{reais(total)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        )}

        {erro !== null && <p role="alert" className="text-sm text-danger">{erro}</p>}

        <Botao
          iconeEsquerda={FlaskIcon}
          disabled={particular || itens.length === 0}
          carregando={emitindo}
          onClick={() => { void emitir(); }}
        >
          {p.emitirAoFinalizar === true ? 'Incluir na finalizacao' : 'Emitir guia'}
        </Botao>

        {guardada && (
          <p className="rounded-[var(--r-sm)] border border-ok/40 bg-ok/5 p-3 text-sm text-text">
            Guia montada. Sera emitida ao finalizar o atendimento — e so entao
            que ela pode apontar para a versao assinada do registro.
          </p>
        )}

        <section className="grid gap-1.5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">
            Guias deste atendimento
          </h3>
          {p.guias.length === 0 ? (
            <p className="text-sm text-text-muted">Nenhuma guia de exame emitida.</p>
          ) : (
            /* Nome acessivel: sem ele um leitor de tela anuncia so "lista",
               e ha outra lista na tela — os resultados da busca. */
            <ul aria-label="Guias deste atendimento" className="grid gap-1.5">
              {p.guias.map((g) => (
                <li key={g.guiaId}
                  className="rounded-[var(--r-sm)] border border-line bg-surface p-3 text-sm">
                  <p className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-semibold text-text">Guia {g.numeroGuiaPrestador}</span>
                    <span className="tabular-nums text-text">{reais(g.valorTotalCentavos)}</span>
                  </p>
                  <ul className="mt-1 grid gap-0.5 text-xs text-text-muted">
                    {g.procedimentos.map((x) => (
                      <li key={x.codigoProcedimento}>
                        {x.quantidade}× {x.descricao}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </PainelLateral>
  );
}
