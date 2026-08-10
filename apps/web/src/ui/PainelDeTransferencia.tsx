// apps/web/src/ui/PainelDeTransferencia.tsx
'use client';

import { useState } from 'react';
import { ArrowsLeftRight } from '@phosphor-icons/react';
import { PainelLateral } from './PainelLateral';
import { Botao } from './Botao';

export interface ContaParaTransferir {
  readonly bankAccountId: string;
  readonly name: string;
}

export interface PainelDeTransferenciaProps {
  readonly aberto: boolean;
  readonly contas: readonly ContaParaTransferir[];
  readonly aoTransferir: (t: {
    fromBankAccountId: string; toBankAccountId: string;
    amountCents: number; description: string }) => Promise<void>;
  readonly aoFechar: () => void;
}

/** '1.250,50' -> 125050. Aceita ponto e virgula: teclado de celular manda ponto. */
function paraCentavos(texto: string): number {
  const limpo = texto.replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '');
  const n = Number.parseFloat(limpo);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/**
 * Transferencia entre contas — a peca que fecha a conciliacao de caixa.
 *
 * A rota existia e nao tinha tela, mas nao havia como usa-la de qualquer forma:
 * ate agora nem conta bancaria era cadastravel. Com o cadastro no ar, esta e a
 * operacao que explica por que o saldo de uma conta caiu sem despesa nenhuma.
 */
export function PainelDeTransferencia(p: PainelDeTransferenciaProps) {
  const [de, setDe] = useState('');
  const [para, setPara] = useState('');
  const [valor, setValor] = useState('');
  const [descricao, setDescricao] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const centavos = paraCentavos(valor);
  const mesmaConta = de !== '' && de === para;
  const incompleto = de === '' || para === '' || mesmaConta
    || centavos <= 0 || descricao.trim() === '';

  async function transferir(): Promise<void> {
    setErro(null);
    setEnviando(true);
    try {
      await p.aoTransferir({
        fromBankAccountId: de, toBankAccountId: para,
        amountCents: centavos, description: descricao.trim(),
      });
      setValor(''); setDescricao('');
    } catch {
      // Nao limpa o formulario: refazer origem, destino e valor por causa de um
      // erro de rede e onde nasce a transferencia digitada errado.
      setErro('Nao foi possivel transferir. Nada foi lancado.');
    } finally {
      setEnviando(false);
    }
  }

  if (p.contas.length < 2) {
    return (
      <PainelLateral aberto={p.aberto} titulo="Transferir entre contas" aoFechar={p.aoFechar}>
        {/* Formulario com um select de uma opcao so e um beco sem saida
            silencioso: o usuario preenche tudo e descobre que nao da. */}
        <p className="text-sm text-text-muted">
          Cadastre pelo menos duas contas bancarias para poder transferir entre
          elas.
        </p>
      </PainelLateral>
    );
  }

  return (
    <PainelLateral aberto={p.aberto} titulo="Transferir entre contas" aoFechar={p.aoFechar}>
      <div className="grid gap-4">
        <p className="rounded-[var(--r-sm)] border border-line bg-surface p-3 text-sm text-text-muted">
          A transferencia gera <strong className="text-text">dois lancamentos</strong>:
          uma saida na conta de origem e uma entrada na de destino. Os dois
          aparecem no extrato — o dinheiro nao some, ele muda de lugar.
        </p>

        <div className="grid grid-cols-2 gap-3">
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium text-text">De</span>
            <select value={de} onChange={(e) => setDe(e.target.value)}
              className="rounded-[var(--r-sm)] border border-line bg-surface px-3 py-2 text-sm text-text">
              <option value="">Escolha</option>
              {p.contas.map((c) => (
                <option key={c.bankAccountId} value={c.bankAccountId}>{c.name}</option>
              ))}
            </select>
          </label>
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium text-text">Para</span>
            <select value={para} onChange={(e) => setPara(e.target.value)}
              className="rounded-[var(--r-sm)] border border-line bg-surface px-3 py-2 text-sm text-text">
              <option value="">Escolha</option>
              {p.contas.map((c) => (
                <option key={c.bankAccountId} value={c.bankAccountId}>{c.name}</option>
              ))}
            </select>
          </label>
        </div>

        <label className="grid gap-1.5 text-sm">
          <span className="font-medium text-text">Valor</span>
          <input type="text" inputMode="decimal" value={valor} placeholder="0,00"
            onChange={(e) => setValor(e.target.value)}
            className="rounded-[var(--r-sm)] border border-line bg-surface px-3 py-2 text-sm text-text" />
        </label>

        <label className="grid gap-1.5 text-sm">
          <span className="font-medium text-text">Descricao</span>
          <input type="text" value={descricao} maxLength={200}
            placeholder="Reforco de caixa da recepcao"
            onChange={(e) => setDescricao(e.target.value)}
            className="rounded-[var(--r-sm)] border border-line bg-surface px-3 py-2 text-sm text-text" />
          <span className="text-xs text-text-muted">
            Daqui a tres meses, "transferencia" sem motivo obriga alguem a caçar
            o extrato do banco para lembrar o que foi.
          </span>
        </label>

        {mesmaConta && (
          <p role="alert" className="text-sm text-danger">
            Origem e destino sao a mesma conta. Isso geraria dois lancamentos que
            se anulam e sujam o extrato sem mover dinheiro.
          </p>
        )}
        {erro !== null && <p role="alert" className="text-sm text-danger">{erro}</p>}

        <Botao iconeEsquerda={ArrowsLeftRight} disabled={incompleto}
          carregando={enviando} onClick={() => { void transferir(); }}>
          Transferir
        </Botao>
      </div>
    </PainelLateral>
  );
}
