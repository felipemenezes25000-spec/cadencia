// apps/web/src/ui/PainelDeCobranca.tsx
'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import {
  QrCode,
  Money,
  CreditCard,
  Barcode,
  Copy,
  Link,
} from '@phosphor-icons/react';
import type { Icon as PhosphorIcon } from '@phosphor-icons/react';
import { PainelLateral } from './PainelLateral';
import { Botao } from './Botao';
import { Campo } from './Campo';
import { Icone } from './Icone';
import { useToast } from './ToastProvider';
import { cn } from '../lib/cn';
import { useSubmitUnico } from '../lib/acao-unica';

export type MetodoPagamento = 'pix' | 'dinheiro' | 'credito' | 'debito' | 'boleto';

export interface PainelDeCobrancaProps {
  readonly aberto: boolean;
  readonly pacienteNome: string;
  readonly procedimentoNome: string;
  readonly valorSugeridoCentavos: number;
  readonly aoRegistrar: (dados: {
    amountCents: number;
    method: MetodoPagamento;
  }) => Promise<{ entryId: string; receiptNumber: number }>;
  readonly aoCriarLink: (dados: {
    amountCents: number;
  }) => Promise<{ linkUrl: string; linkId: string }>;
  readonly aoFechar: () => void;
}

interface MetodoPagamentoOpcao {
  readonly id: MetodoPagamento;
  readonly rotulo: string;
  readonly icone: PhosphorIcon;
}

const METODOS_PAGAMENTO: readonly MetodoPagamentoOpcao[] = [
  { id: 'pix', rotulo: 'PIX', icone: QrCode },
  { id: 'dinheiro', rotulo: 'Dinheiro', icone: Money },
  { id: 'credito', rotulo: 'Cartão de crédito', icone: CreditCard },
  { id: 'debito', rotulo: 'Cartão de débito', icone: CreditCard },
  { id: 'boleto', rotulo: 'Boleto', icone: Barcode },
];

function formatarValorInput(value: string): string {
  const digits = value.replace(/\D/g, '');
  const centavos = parseInt(digits, 10) || 0;
  return (centavos / 100).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function parseValor(texto: string): number {
  const digits = texto.replace(/\D/g, '');
  return parseInt(digits, 10) || 0;
}

interface FormDados {
  valor: string;
}

export function PainelDeCobranca({
  aberto,
  pacienteNome,
  procedimentoNome,
  valorSugeridoCentavos,
  aoRegistrar,
  aoCriarLink,
  aoFechar,
}: PainelDeCobrancaProps) {
  const [metodoSelecionado, setMetodoSelecionado] =
    useState<MetodoPagamento>('pix');
  const [linkPagamento, setLinkPagamento] = useState<string | null>(null);
  const [gerandoLink, setGerandoLink] = useState(false);
  const { toast } = useToast();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    getValues,
  } = useForm<FormDados>({
    defaultValues: {
      valor: formatarValorInput(String(valorSugeridoCentavos)),
    },
  });

  const valorRegistro = register('valor', {
    validate: (v) => {
      if (!v || parseValor(v) <= 0) return 'Informe o valor';
      return true;
    },
  });

  async function onSubmit(dados: FormDados) {
    const centavos = parseValor(dados.valor);
    if (centavos <= 0) return;
    await aoRegistrar({
      amountCents: centavos,
      method: metodoSelecionado,
    });
    toast({ tipo: 'sucesso', mensagem: 'Pagamento registrado!' });
    aoFechar();
  }

  async function gerarLink() {
    const valorAtual = getValues('valor');
    const centavos = parseValor(valorAtual);
    if (centavos <= 0) return;
    setGerandoLink(true);
    try {
      const resultado = await aoCriarLink({ amountCents: centavos });
      setLinkPagamento(resultado.linkUrl);
    } finally {
      setGerandoLink(false);
    }
  }

  async function copiarLink(link: string) {
    await navigator.clipboard.writeText(link);
    toast({ tipo: 'sucesso', mensagem: 'Link copiado!' });
  }

  const enviarUmaVez = useSubmitUnico(handleSubmit(onSubmit));

  return (
    <PainelLateral
      aberto={aberto}
      titulo="Cobrança"
      aoFechar={aoFechar}
      largura="sm"
    >
      <form
        onSubmit={enviarUmaVez}
        className="flex flex-col gap-[var(--s-6)]"
      >
        {/* Informações do paciente */}
        <div className="rounded-xl border border-line bg-surface-raised p-3.5">
          <p className="text-sm font-medium text-text">{pacienteNome}</p>
          <p className="text-xs text-text-muted">{procedimentoNome}</p>
        </div>

        {/* Campo de valor */}
        <Campo
          rotulo="Valor"
          prefixo={<span className="text-sm text-text-muted">R$</span>}
          placeholder="0,00"
          inputMode="decimal"
          ref={valorRegistro.ref}
          name={valorRegistro.name}
          onBlur={valorRegistro.onBlur}
          onChange={(e) => {
            const formatado = formatarValorInput(e.target.value);
            e.target.value = formatado;
            void valorRegistro.onChange(e);
          }}
          erro={errors.valor?.message}
        />

        {/* Forma de pagamento */}
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium text-text">
            Forma de pagamento
          </legend>
          {METODOS_PAGAMENTO.map((m) => (
            <label
              key={m.id}
              className={cn(
                'flex cursor-pointer items-center gap-3 rounded-xl border p-3.5',
                'transition-colors duration-[var(--dur-2)]',
                metodoSelecionado === m.id
                  ? 'border-accent/40 bg-accent-soft ring-1 ring-accent/10'
                  : 'border-line bg-surface hover:border-line-strong hover:bg-surface-raised',
              )}
            >
              <input
                type="radio"
                name="metodo"
                value={m.id}
                checked={metodoSelecionado === m.id}
                onChange={() => setMetodoSelecionado(m.id)}
                className="accent-accent"
              />
              <Icone icon={m.icone} size="md" className="text-text-muted" />
              <span className="text-sm text-text">{m.rotulo}</span>
            </label>
          ))}
        </fieldset>

        {/* Ações */}
        <div className="flex flex-col gap-2 pt-2">
          <Botao
            variante="primario"
            fullWidth
            type="submit"
            carregando={isSubmitting}
          >
            Registrar pagamento
          </Botao>
          <Botao
            variante="secundario"
            fullWidth
            type="button"
            iconeEsquerda={Link}
            onClick={() => {
              void gerarLink();
            }}
            carregando={gerandoLink}
          >
            Gerar link de pagamento
          </Botao>
        </div>

        {/* Link de pagamento gerado */}
        {linkPagamento && (
          <div className="rounded-xl border border-line bg-surface-raised p-3.5">
            <p className="mb-2 text-xs text-text-muted">Link de pagamento</p>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={linkPagamento}
                readOnly
                className="flex-1 truncate bg-transparent text-xs text-text outline-none font-mono"
                aria-label="Link de pagamento"
              />
              <Botao
                variante="fantasma"
                tamanho="sm"
                iconeEsquerda={Copy}
                onClick={() => {
                  void copiarLink(linkPagamento);
                }}
              >
                Copiar
              </Botao>
            </div>
          </div>
        )}
      </form>
    </PainelLateral>
  );
}
