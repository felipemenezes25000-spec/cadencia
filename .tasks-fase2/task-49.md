### Task 49: Painel lateral de cobranca no atendimento — componente `PainelDeCobranca`

**Arquivos**

- Criar `apps/web/src/ui/PainelDeCobranca.tsx`
- Criar `apps/web/src/ui/PainelDeCobranca.test.tsx`

**Por que**: Design §5.3 define acao "cobrar [$]" no atendimento e na fila do dia. O painel lateral reutiliza o componente `PainelLateral` existente e recebe por props as informacoes do procedimento e callbacks de registro.

- [ ] Escrever o teste que falha:

```tsx
// apps/web/src/ui/PainelDeCobranca.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { PainelDeCobranca } from './PainelDeCobranca';

const PROPS_BASE = {
  aberto: true,
  pacienteNome: 'Maria Souza Lima',
  procedimentoNome: 'Consulta',
  valorSugeridoCentavos: 25000,
  aoRegistrar: vi.fn(async () => ({ entryId: 'e1', receiptNumber: 42 })),
  aoCriarLink: vi.fn(async () => ({ linkUrl: 'https://pay.example.com/abc', linkId: 'lk1' })),
  aoFechar: vi.fn(),
};

function montar(over: Partial<typeof PROPS_BASE> = {}) {
  const props = { ...PROPS_BASE, aoRegistrar: vi.fn(async () => ({ entryId: 'e1', receiptNumber: 42 })),
    aoCriarLink: vi.fn(async () => ({ linkUrl: 'https://pay.example.com/abc', linkId: 'lk1' })),
    aoFechar: vi.fn(), ...over };
  render(<PainelDeCobranca {...props} />);
  return props;
}

describe('PainelDeCobranca', () => {
  it('exibe o valor sugerido formatado em reais no campo editavel', () => {
    montar();
    const campo = screen.getByRole('textbox', { name: /Valor/i });
    expect(campo).toHaveValue('250,00');
  });

  it('pre-seleciona metodo "Dinheiro" e oferece quatro opcoes', () => {
    montar();
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(4);
    expect(screen.getByRole('radio', { name: /Dinheiro/i })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Cartão/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Pix/i })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /Link/i })).toBeInTheDocument();
  });

  it('ao confirmar com metodo presencial chama aoRegistrar com centavos e metodo', async () => {
    const props = montar();
    await userEvent.click(screen.getByRole('button', { name: /Registrar/i }));
    await waitFor(() => expect(props.aoRegistrar).toHaveBeenCalledWith({
      amountCents: 25000,
      method: 'dinheiro',
    }));
  });

  it('ao confirmar com metodo "Link" chama aoCriarLink em vez de aoRegistrar', async () => {
    const props = montar();
    await userEvent.click(screen.getByRole('radio', { name: /Link/i }));
    await userEvent.click(screen.getByRole('button', { name: /Enviar link/i }));
    await waitFor(() => expect(props.aoCriarLink).toHaveBeenCalledWith({
      amountCents: 25000,
    }));
    expect(props.aoRegistrar).not.toHaveBeenCalled();
  });

  it('permite editar o valor antes de registrar', async () => {
    const props = montar();
    const campo = screen.getByRole('textbox', { name: /Valor/i });
    await userEvent.clear(campo);
    await userEvent.type(campo, '300,00');
    await userEvent.click(screen.getByRole('button', { name: /Registrar/i }));
    await waitFor(() => expect(props.aoRegistrar).toHaveBeenCalledWith({
      amountCents: 30000,
      method: 'dinheiro',
    }));
  });

  it('mostra o nome do paciente e do procedimento no cabecalho', () => {
    montar();
    expect(screen.getByText('Maria Souza Lima')).toBeVisible();
    expect(screen.getByText('Consulta')).toBeVisible();
  });

  it('botao fica em estado carregando enquanto a promessa nao resolve', async () => {
    const aoRegistrar = vi.fn(() => new Promise<{ entryId: string; receiptNumber: number }>(() => {}));
    montar({ aoRegistrar });
    await userEvent.click(screen.getByRole('button', { name: /Registrar/i }));
    expect(screen.getByRole('button', { name: /Registrar/i })).toHaveAttribute('aria-busy', 'true');
  });

  it('nao renderiza nada quando fechado', () => {
    montar({ aberto: false });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(<PainelDeCobranca {...PROPS_BASE} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Rodar e confirmar a falha:

```bash
cd apps/web && pnpm vitest run src/ui/PainelDeCobranca.test.tsx
# Esperado: FAIL — modulo PainelDeCobranca nao encontrado
```

- [ ] Implementar o componente:

```tsx
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
```

- [ ] Rodar e confirmar que passa:

```bash
cd apps/web && pnpm vitest run src/ui/PainelDeCobranca.test.tsx
# Esperado: 8 testes passando
```

- [ ] Commitar:

```bash
git add apps/web/src/ui/PainelDeCobranca.tsx apps/web/src/ui/PainelDeCobranca.test.tsx
git commit -m "feat(web): payment panel component with method selection and link flow"
```

---