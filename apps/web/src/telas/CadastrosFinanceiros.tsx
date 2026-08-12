// apps/web/src/telas/CadastrosFinanceiros.tsx
'use client';

import { useState } from 'react';
import { Plus, Trash } from '@phosphor-icons/react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/Tabs';
import { PageHeader } from '../ui/PageHeader';
import { Botao } from '../ui/Botao';

export interface Fornecedor {
  readonly supplierId: string;
  readonly name: string;
  readonly cnpj: string | null;
  readonly phone: string | null;
  readonly active: boolean;
}

export interface ContaBancaria {
  readonly bankAccountId: string;
  readonly name: string;
  readonly bankCode: string | null;
  readonly agency: string | null;
  readonly accountNumber: string | null;
  readonly initialBalanceCents: number;
  readonly active: boolean;
}

export interface CentroDeCusto {
  readonly costCenterId: string;
  readonly name: string;
  readonly code: string;
  readonly active: boolean;
}

export interface Recorrencia {
  readonly recurringId: string;
  readonly description: string;
  readonly amountCents: number;
  readonly kind: 'receita' | 'despesa';
  readonly frequency: 'monthly' | 'weekly' | 'biweekly';
  readonly dayOfMonth: number | null;
  readonly active: boolean;
}

export interface DadosDosCadastros {
  readonly fornecedores: readonly Fornecedor[];
  readonly contas: readonly ContaBancaria[];
  readonly centrosDeCusto: readonly CentroDeCusto[];
  readonly recorrencias: readonly Recorrencia[];
}

export interface CadastrosFinanceirosProps {
  readonly dados: DadosDosCadastros;
  readonly aoCriarFornecedor: (f: { name: string; cnpj?: string; phone?: string }) => Promise<void>;
  readonly aoCriarConta: (c: {
    name: string; bankCode: string; agency: string;
    accountNumber: string; initialBalanceCents: number }) => Promise<void>;
  readonly aoCriarCentroDeCusto: (c: { name: string; code: string }) => Promise<void>;
  readonly aoRemoverRecorrencia: (recurringId: string) => Promise<void>;
}

const FREQUENCIA: Record<string, string> = {
  monthly: 'todo mês', weekly: 'toda semana', biweekly: 'a cada 15 dias',
};

function reais(centavos: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency', currency: 'BRL',
  }).format(centavos / 100);
}

/** '1.250,50' -> 125050. Aceita ponto e vírgula: teclado de celular manda ponto. */
function paraCentavos(texto: string): number {
  const limpo = texto.replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '');
  const n = Number.parseFloat(limpo);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function Selo({ ativo }: { ativo: boolean }) {
  if (ativo) return null;
  // Inativo aparece MARCADO, não sumido: ele continua ligado a lançamentos
  // antigos, e some-lo faria a despesa parecer apontar para o nada.
  return (
    <span className="rounded-full bg-surface-hover px-2 py-0.5 text-xs text-text-muted">
      inativo
    </span>
  );
}

/**
 * Cadastros de apoio do financeiro.
 *
 * As quatro rotas existiam no backend e NENHUMA tinha tela: a clínica lançava
 * uma despesa e não conseguia cadastrar o fornecedor dela, nem a conta de onde
 * o dinheiro sai. O financeiro operava pela metade — e a metade que faltava é
 * justamente a que se preenche uma vez e se usa todo dia.
 */
export function CadastrosFinanceiros(p: CadastrosFinanceirosProps) {
  const [aba, setAba] = useState('fornecedores');
  const [salvando, setSalvando] = useState(false);
  const [confirmando, setConfirmando] = useState<string | null>(null);

  const [fNome, setFNome] = useState('');
  const [fCnpj, setFCnpj] = useState('');

  const [cNome, setCNome] = useState('');
  const [cBanco, setCBanco] = useState('');
  const [cAgencia, setCAgencia] = useState('');
  const [cNumero, setCNumero] = useState('');
  const [cSaldo, setCSaldo] = useState('');

  const [ccNome, setCcNome] = useState('');
  const [ccCodigo, setCcCodigo] = useState('');

  async function comSalvando(fn: () => Promise<void>): Promise<void> {
    setSalvando(true);
    try { await fn(); } finally { setSalvando(false); }
  }

  return (
    <div className="cadencia-page grid gap-5">
      <PageHeader
        titulo="Cadastros do financeiro"
        subtitulo="Fornecedor, conta, centro de custo e lançamentos que se repetem. Preenchidos uma vez, usados todo dia."
        semBreadcrumb
      />

      <Tabs value={aba} onValueChange={setAba}>
        <TabsList>
          {/* Fornecedores primeiro: é o cadastro em que o contas a pagar
              esbarra antes de qualquer outro. */}
          <TabsTrigger value="fornecedores">Fornecedores</TabsTrigger>
          <TabsTrigger value="contas">Contas bancárias</TabsTrigger>
          <TabsTrigger value="centros">Centros de custo</TabsTrigger>
          <TabsTrigger value="recorrencias">Recorrências</TabsTrigger>
        </TabsList>

        <TabsContent value="fornecedores">
          <div className="grid gap-4 pt-4">
            <div className="grid gap-3 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium text-text">Nome</span>
                <input type="text" value={fNome}
                  onChange={(e) => setFNome(e.target.value)}
                  className="rounded-[var(--r-sm)] border border-line bg-surface px-3 py-2 text-sm text-text" />
              </label>
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium text-text">CNPJ (opcional)</span>
                <input type="text" value={fCnpj} maxLength={14}
                  onChange={(e) => setFCnpj(e.target.value.replace(/\D/g, ''))}
                  className="rounded-[var(--r-sm)] border border-line bg-surface px-3 py-2 text-sm text-text" />
              </label>
              <Botao iconeEsquerda={Plus} disabled={fNome.trim() === ''}
                carregando={salvando}
                onClick={() => { void comSalvando(async () => {
                  // Só o nome é obrigatório: exigir CNPJ com a nota na mão faz
                  // quem está com pressa inventar número.
                  await p.aoCriarFornecedor(fCnpj === ''
                    ? { name: fNome.trim() }
                    : { name: fNome.trim(), cnpj: fCnpj });
                  setFNome(''); setFCnpj('');
                }); }}>
                Adicionar fornecedor
              </Botao>
            </div>

            <ul className="grid gap-1">
              {p.dados.fornecedores.map((f) => (
                <li key={f.supplierId}
                  className="flex items-center gap-2 rounded-[var(--r-sm)] border border-line bg-surface px-3 py-2 text-sm">
                  <span className="flex-1 text-text">{f.name}</span>
                  {f.cnpj !== null && (
                    <span className="font-mono text-xs text-text-muted">{f.cnpj}</span>
                  )}
                  <Selo ativo={f.active} />
                </li>
              ))}
            </ul>
          </div>
        </TabsContent>

        <TabsContent value="contas">
          <div className="grid gap-4 pt-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium text-text">Nome</span>
                <input type="text" value={cNome}
                  onChange={(e) => setCNome(e.target.value)}
                  className="rounded-[var(--r-sm)] border border-line bg-surface px-3 py-2 text-sm text-text" />
              </label>
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium text-text">Banco</span>
                <input type="text" value={cBanco} maxLength={10}
                  onChange={(e) => setCBanco(e.target.value)}
                  className="rounded-[var(--r-sm)] border border-line bg-surface px-3 py-2 text-sm text-text" />
              </label>
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium text-text">Agência</span>
                <input type="text" value={cAgencia} maxLength={20}
                  onChange={(e) => setCAgencia(e.target.value)}
                  className="rounded-[var(--r-sm)] border border-line bg-surface px-3 py-2 text-sm text-text" />
              </label>
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium text-text">Número da conta</span>
                <input type="text" value={cNumero} maxLength={30}
                  onChange={(e) => setCNumero(e.target.value)}
                  className="rounded-[var(--r-sm)] border border-line bg-surface px-3 py-2 text-sm text-text" />
              </label>
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium text-text">Saldo inicial</span>
                <input type="text" inputMode="decimal" value={cSaldo} placeholder="0,00"
                  onChange={(e) => setCSaldo(e.target.value)}
                  className="rounded-[var(--r-sm)] border border-line bg-surface px-3 py-2 text-sm text-text" />
              </label>
              <div className="flex items-end">
                <Botao iconeEsquerda={Plus} carregando={salvando}
                  // Conta sem agência não serve para conciliar extrato — que é a
                  // única razão de ela existir aqui.
                  disabled={cNome.trim() === '' || cBanco.trim() === ''
                    || cAgencia.trim() === '' || cNumero.trim() === ''}
                  onClick={() => { void comSalvando(async () => {
                    await p.aoCriarConta({
                      name: cNome.trim(), bankCode: cBanco.trim(),
                      agency: cAgencia.trim(), accountNumber: cNumero.trim(),
                      initialBalanceCents: paraCentavos(cSaldo),
                    });
                    setCNome(''); setCBanco(''); setCAgencia('');
                    setCNumero(''); setCSaldo('');
                  }); }}>
                  Adicionar conta
                </Botao>
              </div>
            </div>

            <ul className="grid gap-1">
              {p.dados.contas.map((c) => (
                <li key={c.bankAccountId}
                  className="flex items-center gap-2 rounded-[var(--r-sm)] border border-line bg-surface px-3 py-2 text-sm">
                  <span className="flex-1 text-text">{c.name}</span>
                  <span className="text-xs text-text-muted">
                    {c.bankCode} · ag {c.agency} · {c.accountNumber}
                  </span>
                  <span className="tabular-nums text-text">{reais(c.initialBalanceCents)}</span>
                  <Selo ativo={c.active} />
                </li>
              ))}
            </ul>
          </div>
        </TabsContent>

        <TabsContent value="centros">
          <div className="grid gap-4 pt-4">
            <div className="grid gap-3 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium text-text">Nome</span>
                <input type="text" value={ccNome}
                  onChange={(e) => setCcNome(e.target.value)}
                  className="rounded-[var(--r-sm)] border border-line bg-surface px-3 py-2 text-sm text-text" />
              </label>
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium text-text">Código</span>
                <input type="text" value={ccCodigo} maxLength={20}
                  // Maiúscula na entrada: o código aparece no relatório
                  // contábil, e 'mkt' ao lado de 'MKT' viraria dois centros que
                  // a contabilidade lê como o mesmo.
                  onChange={(e) => setCcCodigo(e.target.value.toUpperCase())}
                  className="rounded-[var(--r-sm)] border border-line bg-surface px-3 py-2 text-sm text-text" />
              </label>
              <Botao iconeEsquerda={Plus} carregando={salvando}
                disabled={ccNome.trim() === '' || ccCodigo.trim() === ''}
                onClick={() => { void comSalvando(async () => {
                  await p.aoCriarCentroDeCusto({
                    name: ccNome.trim(), code: ccCodigo.trim() });
                  setCcNome(''); setCcCodigo('');
                }); }}>
                Adicionar centro
              </Botao>
            </div>

            <ul className="grid gap-1">
              {p.dados.centrosDeCusto.map((c) => (
                <li key={c.costCenterId}
                  className="flex items-center gap-2 rounded-[var(--r-sm)] border border-line bg-surface px-3 py-2 text-sm">
                  <span className="font-mono text-xs text-text-muted">{c.code}</span>
                  <span className="flex-1 text-text">{c.name}</span>
                  <Selo ativo={c.active} />
                </li>
              ))}
            </ul>
          </div>
        </TabsContent>

        <TabsContent value="recorrencias">
          <div className="grid gap-4 pt-4">
            <p className="text-sm text-text-muted">
              Lançamentos que se repetem sozinhos — aluguel, salário, assinatura.
              Criados pelo lançamento no contas a pagar ou a receber.
            </p>
            <ul className="grid gap-1.5">
              {p.dados.recorrencias.map((r) => (
                <li key={r.recurringId}
                  className="rounded-[var(--r-sm)] border border-line bg-surface p-3 text-sm">
                  <p className="flex flex-wrap items-baseline gap-x-2">
                    <span className="flex-1 font-medium text-text">{r.description}</span>
                    <span className={`tabular-nums ${r.kind === 'despesa' ? 'text-danger' : 'text-ok'}`}>
                      {r.kind === 'despesa' ? '-' : '+'}{reais(r.amountCents)}
                    </span>
                    <Selo ativo={r.active} />
                  </p>
                  <p className="text-xs text-text-muted">
                    {FREQUENCIA[r.frequency] ?? r.frequency}
                    {r.dayOfMonth !== null && `, dia ${r.dayOfMonth}`}
                  </p>
                  {confirmando === r.recurringId ? (
                    <div className="mt-2 flex gap-2">
                      <Botao variante="perigo" tamanho="sm"
                        onClick={() => { void p.aoRemoverRecorrencia(r.recurringId)
                          .then(() => setConfirmando(null)); }}>
                        Confirmar
                      </Botao>
                      <Botao variante="fantasma" tamanho="sm"
                        onClick={() => setConfirmando(null)}>
                        Manter
                      </Botao>
                    </div>
                  ) : (
                    <Botao className="mt-2" variante="secundario" tamanho="sm"
                      iconeEsquerda={Trash}
                      // Apagar a recorrência do aluguel sem querer faria a
                      // despesa sumir do fluxo de caixa, e ninguém notaria até
                      // o mês fechar errado.
                      onClick={() => setConfirmando(r.recurringId)}>
                      Remover
                    </Botao>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
