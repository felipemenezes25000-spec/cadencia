// apps/web/src/ui/PainelDeCobranca.tsx
'use client';

import { useState } from 'react';
import { PainelLateral } from './PainelLateral';
import { Botao } from './Botao';
import { Campo } from './Campo';

export type MetodoPagamento = 'dinheiro' | 'cartao' | 'pix' | 'link';

export interface PainelDeCobrancaProps {
  readonly aberto: boolean;
  readonly pacienteNome: string;
  readonly procedimentoNome: string;
  readonly valorSugeridoCentavos: number;
  readonly aoRegistrar: (dados: { amountCents: number; method: Exclude<MetodoPagamento, 'link'> }) =>
    Promise<{ entryId: string; receiptNumber: number }>;
  readonly aoCriarLink: (dados: { amountCents: number }) =>
    Promise<{ linkUrl: string; linkId: string }>;
  readonly aoFechar: () => void;
}

const METODOS: ReadonlyArray<{ valor: MetodoPagamento; rotulo: string }> = [
  { valor: 'dinheiro', rotulo: 'Dinheiro' },
  { valor: 'cartao', rotulo: 'Cartão' },
  { valor: 'pix', rotulo: 'Pix' },
  { valor: 'link', rotulo: 'Link' },
];

function centavosParaTexto(centavos: number): string {
  const inteiro = Math.floor(centavos / 100);
  const decimais = String(centavos % 100).padStart(2, '0');
  return `${inteiro},${decimais}`;
}

function textoParaCentavos(texto: string): number | null {
  const limpo = texto.replace(/\s/g, '').replace('.', ',');
  const partes = limpo.split(',');
  if (partes.length > 2) return null;
  const inteiro = parseInt(partes[0] ?? '0', 10);
  if (Number.isNaN(inteiro)) return null;
  let decimais = 0;
  if (partes.length === 2) {
    const decStr = (partes[1] ?? '').padEnd(2, '0').slice(0, 2);
    decimais = parseInt(decStr, 10);
    if (Number.isNaN(decimais)) return null;
  }
  return inteiro * 100 + decimais;
}

export function PainelDeCobranca(p: PainelDeCobrancaProps) {
  const [metodo, setMetodo] = useState<MetodoPagamento>('dinheiro');
  const [valorTexto, setValorTexto] = useState(() => centavosParaTexto(p.valorSugeridoCentavos));
  const [carregando, setCarregando] = useState(false);
  const [linkCriado, setLinkCriado] = useState<string | null>(null);

  async function registrar(): Promise<void> {
    const centavos = textoParaCentavos(valorTexto);
    if (centavos === null || centavos <= 0) return;
    setCarregando(true);
    try {
      if (metodo === 'link') {
        const resultado = await p.aoCriarLink({ amountCents: centavos });
        setLinkCriado(resultado.linkUrl);
      } else {
        await p.aoRegistrar({ amountCents: centavos, method: metodo });
      }
    } finally {
      setCarregando(false);
    }
  }

  const rotuloConfirmar = metodo === 'link' ? 'Enviar link' : 'Registrar';

  return (
    <PainelLateral aberto={p.aberto} titulo="Cobrar" aoFechar={p.aoFechar}>
      <div style={{ display: 'grid', gap: 'var(--s-6)' }}>
        <div style={{ display: 'grid', gap: 'var(--s-2)' }}>
          <span style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-medium)' }}>
            {p.pacienteNome}
          </span>
          <span style={{ fontSize: 'var(--fs-13)', color: 'var(--text-muted)' }}>
            {p.procedimentoNome}
          </span>
        </div>

        <Campo
          rotulo="Valor (R$)"
          value={valorTexto}
          onChange={(e) => setValorTexto(e.target.value)}
          inputMode="decimal"
          aria-label="Valor"
        />

        <fieldset style={{ border: 0, margin: 0, padding: 0, display: 'grid', gap: 'var(--s-3)' }}>
          <legend style={{ fontSize: 'var(--fs-12)', fontWeight: 'var(--fw-medium)',
                           color: 'var(--text-muted)', marginBottom: 'var(--s-2)' }}>
            Forma de pagamento
          </legend>
          {METODOS.map((m) => (
            <label key={m.valor} style={{ display: 'flex', alignItems: 'center',
                                          gap: 'var(--s-3)', cursor: 'pointer',
                                          fontSize: 'var(--fs-14)' }}>
              <input
                type="radio" name="metodo" value={m.valor}
                checked={metodo === m.valor}
                onChange={() => setMetodo(m.valor)}
                aria-label={m.rotulo}
              />
              {m.rotulo}
            </label>
          ))}
        </fieldset>

        {linkCriado !== null ? (
          <div role="status" style={{ padding: 'var(--s-4)', background: 'var(--success-soft)',
                                      borderRadius: 'var(--r-md)', fontSize: 'var(--fs-13)' }}>
            Link criado e copiado para a area de transferencia.
          </div>
        ) : (
          <Botao variante="primario" altura={40} carregando={carregando}
            onClick={() => { void registrar(); }}>
            {rotuloConfirmar}
          </Botao>
        )}
      </div>
    </PainelLateral>
  );
}
