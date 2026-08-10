// apps/web/src/telas/ConveniosAFaturar.tsx
"use client";

import { useEffect, useState } from "react";
import { Package } from "@phosphor-icons/react";
import { cn } from "../lib/cn";
import { Botao } from "../ui/Botao";
import { Campo } from "../ui/Campo";
import { ChipDeStatusTiss, type StatusTiss } from "../ui/ChipDeStatusTiss";
import { Skeleton } from "../ui/Skeleton";

// ── Tipos ──────────────────────────────────────────────────────────────────

export interface GuiaPendente {
  readonly id: string;
  readonly numeroGuia: string;
  readonly pacienteNome: string;
  /** O lote pertence a UMA operadora: sem o id nao da para cria-lo. */
  readonly operadoraId: string;
  readonly operadoraNome: string;
  readonly registroAns: string;
  readonly codigoProcedimento: string;
  readonly nomeProcedimento: string;
  readonly valorCentavos: number;
  readonly dataAtendimento: string;
  readonly status: "completa" | "incompleta";
}

export interface OperadoraResumo {
  readonly id: string;
  readonly nome: string;
  readonly registroAns: string;
}

export interface AFaturarDados {
  readonly guias: readonly GuiaPendente[];
  readonly operadoras: readonly OperadoraResumo[];
}

export interface FiltrosAFaturar {
  readonly operadoraId?: string | undefined;
  readonly status?: string | undefined;
  readonly dataInicio?: string | undefined;
  readonly dataFim?: string | undefined;
}

export interface ConveniosAFaturarProps {
  readonly carregarDados: (filtros: FiltrosAFaturar) => Promise<AFaturarDados>;
  readonly aoCriarLote: (
    guiaIds: readonly string[], operadoraId: string) => Promise<void>;
  readonly aoAbrirGuia: (guiaId: string) => void;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function centavosParaReais(centavos: number): string {
  const abs = Math.abs(centavos);
  const inteiro = Math.floor(abs / 100);
  const decimais = String(abs % 100).padStart(2, "0");
  const formatado = inteiro.toLocaleString("pt-BR");
  return `R$ ${centavos < 0 ? "-" : ""}${formatado},${decimais}`;
}

// ── Skeleton de carregamento ───────────────────────────────────────────────

function TabelaSkeleton() {
  return (
    <div
      role="status"
      aria-label="Carregando guias..."
      className="overflow-hidden rounded-xl border border-line bg-surface shadow-elev-1"
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line bg-surface-raised">
              <th className="px-4 py-2.5 w-10">
                <Skeleton variant="text" width="16px" height="16px" />
              </th>
              <th className="px-4 py-2.5 text-left"><Skeleton variant="text" width="60px" /></th>
              <th className="px-4 py-2.5 text-left"><Skeleton variant="text" width="100px" /></th>
              <th className="px-4 py-2.5 text-left"><Skeleton variant="text" width="90px" /></th>
              <th className="px-4 py-2.5 text-left"><Skeleton variant="text" width="110px" /></th>
              <th className="px-4 py-2.5 text-right"><Skeleton variant="text" width="70px" /></th>
              <th className="px-4 py-2.5 text-left"><Skeleton variant="text" width="80px" /></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {Array.from({ length: 5 }, (_, i) => (
              <tr key={i}>
                <td className="px-4 py-3"><Skeleton variant="text" width="16px" height="16px" /></td>
                <td className="px-4 py-3"><Skeleton variant="text" width="60px" /></td>
                <td className="px-4 py-3"><Skeleton variant="text" width="120px" /></td>
                <td className="px-4 py-3"><Skeleton variant="text" width="90px" /></td>
                <td className="px-4 py-3"><Skeleton variant="text" width="100px" /></td>
                <td className="px-4 py-3"><Skeleton variant="text" width="70px" /></td>
                <td className="px-4 py-3"><Skeleton variant="text" width="80px" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Estado vazio ───────────────────────────────────────────────────────────

function EstadoVazio() {
  return (
    <div className="rounded-xl border border-line bg-surface shadow-elev-1 p-8 text-center">
      <Package size={40} className="mx-auto mb-3 text-text-muted" aria-hidden />
      <p className="text-sm font-medium text-text">Nenhuma guia pendente</p>
      <p className="mt-1 text-xs text-text-muted">
        Todas as guias foram faturadas ou nao ha registros para os filtros selecionados.
      </p>
    </div>
  );
}

// ── Componente ─────────────────────────────────────────────────────────────

export function ConveniosAFaturar(p: ConveniosAFaturarProps) {
  const [dados, setDados] = useState<AFaturarDados | null>(null);
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set());
  const [operadoraId, setOperadoraId] = useState("");
  const [status, setStatus] = useState("");
  const [dataInicio, setDataInicio] = useState("");
  const [dataFim, setDataFim] = useState("");
  const [criandoLote, setCriandoLote] = useState(false);
  const [erroLote, setErroLote] = useState<string | null>(null);

  useEffect(() => {
    void p.carregarDados({}).then(setDados);
  }, [p]);

  /**
   * A operadora do lote sai das guias selecionadas.
   *
   * `null` quando a selecao mistura operadoras — e ai o botao fica desabilitado
   * em vez de montar um lote que a operadora recusaria inteiro. Antes disto a
   * tela mandava `operadoraId: null` para uma rota que exige uuid: a API
   * respondia 400, a promessa era descartada com `void` sem catch, e o usuario
   * via o botao "funcionar" sem que nada acontecesse.
   */
  const operadoraDaSelecao = ((): string | null => {
    const ids = new Set(
      (dados?.guias ?? [])
        .filter((g) => selecionadas.has(g.id))
        .map((g) => g.operadoraId),
    );
    return ids.size === 1 ? [...ids][0]! : null;
  })();

  async function criarLote(): Promise<void> {
    if (operadoraDaSelecao === null) return;
    setErroLote(null);
    setCriandoLote(true);
    try {
      await p.aoCriarLote(Array.from(selecionadas), operadoraDaSelecao);
    } catch {
      setErroLote('Nao foi possivel criar o lote. Nenhuma guia foi alterada.');
    } finally {
      setCriandoLote(false);
    }
  }

  function filtrar(): void {
    void p
      .carregarDados({
        operadoraId: operadoraId === "" ? undefined : operadoraId,
        status: status === "" ? undefined : status,
        dataInicio: dataInicio === "" ? undefined : dataInicio,
        dataFim: dataFim === "" ? undefined : dataFim,
      })
      .then(setDados);
  }

  function toggleSelecao(id: string): void {
    setSelecionadas((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleTodos(): void {
    if (!dados) return;
    if (selecionadas.size === dados.guias.length) {
      setSelecionadas(new Set());
    } else {
      setSelecionadas(new Set(dados.guias.map((g) => g.id)));
    }
  }

  // Estado de carregamento
  if (dados === null) {
    return (
      <div className="space-y-4">
        <TabelaSkeleton />
      </div>
    );
  }

  const guias = dados.guias;

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="flex flex-wrap items-end gap-[var(--s-4)]">
        <div className="grid gap-[var(--s-2)]">
          <label
            htmlFor="filtro-operadora-af"
            className="text-sm font-medium text-text-muted"
          >
            Operadora
          </label>
          <select
            id="filtro-operadora-af"
            value={operadoraId}
            onChange={(e) => setOperadoraId(e.target.value)}
            aria-label="Operadora"
            className={cn(
              "h-8 px-[var(--s-4)]",
              "rounded-lg border border-line",
              "bg-surface text-text text-sm",
              "outline-none focus:border-accent focus:ring-1 focus:ring-accent",
            )}
          >
            <option value="">Todas</option>
            {dados.operadoras.map((op) => (
              <option key={op.id} value={op.id}>
                {op.nome}
              </option>
            ))}
          </select>
        </div>

        <div className="grid gap-[var(--s-2)]">
          <label
            htmlFor="filtro-status-af"
            className="text-sm font-medium text-text-muted"
          >
            Status
          </label>
          <select
            id="filtro-status-af"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            aria-label="Status"
            className={cn(
              "h-8 px-[var(--s-4)]",
              "rounded-lg border border-line",
              "bg-surface text-text text-sm",
              "outline-none focus:border-accent focus:ring-1 focus:ring-accent",
            )}
          >
            <option value="">Todos</option>
            <option value="completa">Completa</option>
            <option value="incompleta">Incompleta</option>
          </select>
        </div>

        <Campo
          rotulo="Periodo inicio"
          type="date"
          denso
          value={dataInicio}
          onChange={(e) => setDataInicio(e.target.value)}
          aria-label="Periodo inicio"
        />
        <Campo
          rotulo="Periodo fim"
          type="date"
          denso
          value={dataFim}
          onChange={(e) => setDataFim(e.target.value)}
          aria-label="Periodo fim"
        />
        <Botao variante="secundario" tamanho="md" onClick={filtrar}>
          Filtrar
        </Botao>
      </div>

      {/* Barra de acao batch */}
      {selecionadas.size > 0 && (
        <div
          className={cn(
            "flex items-center justify-between",
            "rounded-xl border border-accent/20 bg-accent-soft p-3",
          )}
        >
          <span className="text-sm text-text">
            {selecionadas.size}{" "}
            {selecionadas.size === 1
              ? "guia selecionada"
              : "guias selecionadas"}
          </span>
          <Botao
            variante="primario"
            tamanho="sm"
            iconeEsquerda={Package}
            disabled={criandoLote || operadoraDaSelecao === null}
            onClick={() => { void criarLote(); }}
          >
            {criandoLote ? 'Criando lote...' : 'Criar lote'}
          </Botao>
        </div>
      )}

      {/* Um lote e de UMA operadora: o XML vai para o webservice dela. */}
      {selecionadas.size > 0 && operadoraDaSelecao === null && (
        <p role="alert" className="text-sm text-danger">
          As guias selecionadas sao de operadoras diferentes. Um lote pertence a
          uma operadora so — selecione guias de uma de cada vez.
        </p>
      )}

      {erroLote !== null && (
        <p role="alert" className="text-sm text-danger">{erroLote}</p>
      )}

      {/* Estado vazio */}
      {guias.length === 0 ? (
        <EstadoVazio />
      ) : (
        /* Tabela de guias */
        <section aria-label="Guias a faturar">
          <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-elev-1">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line bg-surface-raised">
                    <th className="px-4 py-2.5 w-10">
                      <input
                        type="checkbox"
                        checked={
                          selecionadas.size === guias.length && guias.length > 0
                        }
                        onChange={toggleTodos}
                        className="accent-accent cursor-pointer"
                        aria-label="Selecionar todas"
                      />
                    </th>
                    <th className="px-4 py-2.5 text-left font-medium text-text-muted">
                      Guia
                    </th>
                    <th className="px-4 py-2.5 text-left font-medium text-text-muted">
                      Paciente
                    </th>
                    <th className="px-4 py-2.5 text-left font-medium text-text-muted">
                      Operadora
                    </th>
                    <th className="px-4 py-2.5 text-left font-medium text-text-muted max-sm:hidden">
                      Procedimento
                    </th>
                    <th className="px-4 py-2.5 text-right font-medium text-text-muted">
                      Valor
                    </th>
                    <th className="px-4 py-2.5 text-left font-medium text-text-muted">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {guias.map((g) => (
                    <tr
                      key={g.id}
                      className={cn(
                        "hover:bg-surface-raised transition-colors-fast cursor-pointer",
                        selecionadas.has(g.id) && "bg-accent-soft",
                      )}
                    >
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selecionadas.has(g.id)}
                          onChange={() => toggleSelecao(g.id)}
                          className="accent-accent cursor-pointer"
                          aria-label={`Selecionar guia ${g.numeroGuia}`}
                        />
                      </td>
                      <td className="px-4 py-3 font-mono text-xs tabular-nums text-text-muted">
                        {g.numeroGuia}
                      </td>
                      <td className="px-4 py-3 text-text">
                        <button
                          type="button"
                          onClick={() => p.aoAbrirGuia(g.id)}
                          className="text-left hover:text-accent transition-colors-fast focus:outline-none focus-visible:underline"
                        >
                          {g.pacienteNome}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-text-muted">
                        {g.operadoraNome}
                      </td>
                      <td className="px-4 py-3 text-text-muted max-sm:hidden">
                        {g.nomeProcedimento}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums font-medium">
                        {centavosParaReais(g.valorCentavos)}
                      </td>
                      <td className="px-4 py-3">
                        <ChipDeStatusTiss status={g.status as StatusTiss} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
