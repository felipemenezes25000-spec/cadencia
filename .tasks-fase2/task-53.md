### Task 53: ~~Habilitar navegacao~~ Tela de recibos `/financeiro/recibos`

> **COLISAO RESOLVIDA**: a alteracao de `nav.ts` (FASE_ATUAL=2, Financeiro
> disponivelNaFase=2) e a reescrita de `BarraDeNavegacao.test.tsx` foram
> REMOVIDAS deste bloco. O Bloco 10 (Task 55) e o unico responsavel por
> habilitar Conversas e Financeiro no nav e trocar FASE_ATUAL.
>
> Este bloco MANTEM apenas a tela de Recibos.

**Arquivos**

- Criar `apps/web/src/telas/Recibos.tsx`
- Criar `apps/web/src/telas/Recibos.test.tsx`

**Por que**: A tela de recibos (`/financeiro/recibos`) lista recibos emitidos com filtro por data e paciente.

- [ ] Escrever os testes que falham:

```ts
// apps/web/src/ui/BarraDeNavegacao.test.tsx — atualizar o teste existente
  it('marca o que ainda nao existe, com o motivo — nunca cadeado de upsell', () => {
    const futuros = ITENS_NAV.filter((i) => i.disponivelNaFase > 2);
    expect(futuros.map((i) => i.rotulo)).toEqual(['Desempenho']);
    for (const f of futuros) expect(f.motivo).toMatch(/Fase \d/);
  });
```

```tsx
// apps/web/src/telas/Recibos.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { Recibos } from './Recibos';

const LISTA = [
  { receiptNumber: 42, patientName: 'Maria Souza Lima', description: 'Consulta',
    amountCents: 25000, method: 'dinheiro' as const, paidAt: '2026-08-03T13:30:00.000Z',
    receiptId: 'r1' },
  { receiptNumber: 43, patientName: 'Joana Prado', description: 'Retorno',
    amountCents: 15000, method: 'pix' as const, paidAt: '2026-08-03T14:00:00.000Z',
    receiptId: 'r2' },
];

function montar() {
  const props = {
    carregarRecibos: vi.fn(async (_filtros: { dataInicio?: string; dataFim?: string; paciente?: string }) => LISTA),
    aoImprimirRecibo: vi.fn(async () => {}),
  };
  render(<Recibos {...props} />);
  return props;
}

describe('tela Recibos', () => {
  it('exibe o titulo "Recibos"', async () => {
    montar();
    await waitFor(() => expect(
      screen.getByRole('heading', { level: 1, name: /Recibos/ })).toBeVisible());
  });

  it('lista os recibos com numero sequencial, paciente e valor', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('#42')).toBeVisible());
    expect(screen.getByText('Maria Souza Lima')).toBeVisible();
    expect(screen.getByText('R$ 250,00')).toBeVisible();
  });

  it('cada recibo tem botao "Imprimir"', async () => {
    const { aoImprimirRecibo } = montar();
    await waitFor(() => expect(
      screen.getAllByRole('button', { name: /Imprimir/ }).length).toBe(2));
    await userEvent.click(screen.getAllByRole('button', { name: /Imprimir/ })[0]!);
    expect(aoImprimirRecibo).toHaveBeenCalledWith('r1');
  });

  it('tem campos de filtro por data e paciente', async () => {
    montar();
    await waitFor(() => expect(screen.getByLabelText(/Data início/i)).toBeVisible());
    expect(screen.getByLabelText(/Data fim/i)).toBeVisible();
    expect(screen.getByLabelText(/Paciente/i)).toBeVisible();
  });

  it('ao preencher filtro de paciente e disparar busca, recarrega a lista', async () => {
    const { carregarRecibos } = montar();
    await waitFor(() => expect(screen.getByText('#42')).toBeVisible());
    const campoPaciente = screen.getByLabelText(/Paciente/i);
    await userEvent.type(campoPaciente, 'Maria');
    await userEvent.click(screen.getByRole('button', { name: /Filtrar/ }));
    expect(carregarRecibos).toHaveBeenCalledTimes(2);
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <Recibos
        carregarRecibos={async () => LISTA}
        aoImprimirRecibo={async () => {}}
      />);
    await waitFor(() => expect(screen.getByText('#42')).toBeVisible());
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Rodar e confirmar a falha:

```bash
cd apps/web && pnpm vitest run src/telas/Recibos.test.tsx src/ui/BarraDeNavegacao.test.tsx
# Esperado: FAIL — modulo Recibos nao encontrado; assertion de futuros falhando
```

- [ ] Atualizar o nav para Fase 2:

```ts
// apps/web/src/ui/nav.ts
export interface ItemNav {
  readonly rotulo: string;
  readonly href: string;
  readonly atalho: string;
  readonly disponivelNaFase: 1 | 2 | 3;
  readonly motivo?: string;
}

export const ITENS_NAV: readonly ItemNav[] = [
  { rotulo: 'Hoje',       href: '/hoje',       atalho: 'g h', disponivelNaFase: 1 },
  { rotulo: 'Agenda',     href: '/agenda',     atalho: 'g a', disponivelNaFase: 1 },
  { rotulo: 'Conversas',  href: '/conversas',  atalho: 'g c', disponivelNaFase: 2,
    motivo: 'WhatsApp bidirecional chega na Fase 2' },
  { rotulo: 'Pacientes',  href: '/pacientes',  atalho: 'g p', disponivelNaFase: 1 },
  { rotulo: 'Financeiro', href: '/financeiro', atalho: 'g f', disponivelNaFase: 2,
    motivo: 'Financeiro básico chega na Fase 2' },
  { rotulo: 'Desempenho', href: '/desempenho', atalho: 'g d', disponivelNaFase: 3,
    motivo: 'Desempenho e atribuição de variação chegam na Fase 3' },
];

export const FASE_ATUAL = 2 as const;
```

- [ ] Atualizar os testes da BarraDeNavegacao para a nova realidade da Fase 2:

```tsx
// apps/web/src/ui/BarraDeNavegacao.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { BarraDeNavegacao } from './BarraDeNavegacao';
import { ITENS_NAV } from './nav';

vi.mock('next/navigation', () => ({
  usePathname: () => '/hoje',
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode;
    [k: string]: unknown }) => <a href={href} {...rest}>{children}</a>,
}));

describe('barra de navegacao', () => {
  it('segue a ordem CRONOLOGICA do dia, nao o organograma do software', () => {
    expect(ITENS_NAV.map((i) => i.rotulo)).toEqual([
      'Hoje', 'Agenda', 'Conversas', 'Pacientes', 'Financeiro', 'Desempenho']);
  });

  it('marca o que ainda nao existe, com o motivo — nunca cadeado de upsell', () => {
    const futuros = ITENS_NAV.filter((i) => i.disponivelNaFase > 2);
    expect(futuros.map((i) => i.rotulo)).toEqual(['Desempenho']);
    for (const f of futuros) expect(f.motivo).toMatch(/Fase \d/);
  });

  it('renderiza os itens da Fase 1 e 2 como link e os futuros como desabilitados', () => {
    render(<BarraDeNavegacao />);
    expect(screen.getByRole('link', { name: 'Hoje' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Financeiro' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Conversas' })).toBeInTheDocument();
    const desempenho = screen.getByRole('button', { name: /Desempenho/ });
    expect(desempenho).toBeDisabled();
    expect(desempenho).toHaveAttribute('aria-disabled', 'true');
    expect(desempenho).toHaveAccessibleDescription(/Fase 3/);
  });

  it('a navegacao e um <nav> com rotulo e nao tem violacao de acessibilidade', async () => {
    const { container } = render(<BarraDeNavegacao />);
    expect(screen.getByRole('navigation', { name: 'Navegação principal' })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('Auditoria e Ajustes NAO estao na barra — moram no menu do usuario', () => {
    render(<BarraDeNavegacao />);
    expect(screen.queryByText('Auditoria')).not.toBeInTheDocument();
    expect(screen.queryByText('Ajustes')).not.toBeInTheDocument();
  });
});
```

- [ ] Implementar a tela de Recibos:

```tsx
// apps/web/src/telas/Recibos.tsx
'use client';

import { useEffect, useState } from 'react';
import { Botao } from '../ui/Botao';
import { Campo } from '../ui/Campo';

export type MetodoRecibo = 'dinheiro' | 'cartao' | 'pix' | 'link';

export interface LinhaDeRecibo {
  readonly receiptId: string;
  readonly receiptNumber: number;
  readonly patientName: string;
  readonly description: string;
  readonly amountCents: number;
  readonly method: MetodoRecibo;
  readonly paidAt: string;
}

export interface RecibosProps {
  readonly carregarRecibos: (filtros: {
    dataInicio?: string; dataFim?: string; paciente?: string;
  }) => Promise<LinhaDeRecibo[]>;
  readonly aoImprimirRecibo: (receiptId: string) => Promise<void>;
}

const ROTULO_METODO: Record<MetodoRecibo, string> = {
  dinheiro: 'Dinheiro', cartao: 'Cartão', pix: 'Pix', link: 'Link',
};

function centavosParaReais(centavos: number): string {
  const abs = Math.abs(centavos);
  const inteiro = Math.floor(abs / 100);
  const decimais = String(abs % 100).padStart(2, '0');
  const formatado = inteiro.toLocaleString('pt-BR');
  return `R$ ${centavos < 0 ? '-' : ''}${formatado},${decimais}`;
}

function formatarDataHora(iso: string): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
  }).format(d);
}

export function Recibos(p: RecibosProps) {
  const [recibos, setRecibos] = useState<LinhaDeRecibo[]>([]);
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');
  const [paciente, setPaciente] = useState('');

  useEffect(() => {
    void p.carregarRecibos({}).then(setRecibos);
  }, [p]);

  function filtrar(): void {
    void p.carregarRecibos({
      dataInicio: dataInicio === '' ? undefined : dataInicio,
      dataFim: dataFim === '' ? undefined : dataFim,
      paciente: paciente === '' ? undefined : paciente,
    }).then(setRecibos);
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--s-8)', padding: 'var(--s-8)',
                  maxWidth: 960, margin: '0 auto' }}>
      <h1 style={{ fontSize: 'var(--fs-22)', fontWeight: 'var(--fw-semibold)',
                   lineHeight: 'var(--lh-tight)', margin: 0 }}>
        Recibos
      </h1>

      <div style={{ display: 'flex', gap: 'var(--s-4)', flexWrap: 'wrap', alignItems: 'end' }}>
        <Campo rotulo="Data início" type="date" denso
          value={dataInicio} onChange={(e) => setDataInicio(e.target.value)}
          aria-label="Data início" />
        <Campo rotulo="Data fim" type="date" denso
          value={dataFim} onChange={(e) => setDataFim(e.target.value)}
          aria-label="Data fim" />
        <Campo rotulo="Paciente" denso
          value={paciente} onChange={(e) => setPaciente(e.target.value)}
          aria-label="Paciente" placeholder="Nome do paciente" />
        <Botao variante="secundario" altura={32} onClick={filtrar}>
          Filtrar
        </Botao>
      </div>

      <section aria-label="Lista de recibos">
        <ul style={{ listStyle: 'none', margin: 0, padding: 0,
                     border: 'var(--border)', borderRadius: 'var(--r-md)',
                     overflow: 'hidden', background: 'var(--surface)' }}>
          {recibos.map((r) => (
            <li key={r.receiptId}
              style={{ display: 'grid',
                       gridTemplateColumns: 'auto 1fr auto auto',
                       alignItems: 'center', gap: 'var(--s-5)',
                       borderBottom: 'var(--border)',
                       padding: 'var(--s-4) var(--s-5)', minHeight: 44 }}>
              <span className="num" style={{ fontSize: 'var(--fs-13)',
                                             color: 'var(--text-muted)',
                                             fontVariantNumeric: 'tabular-nums' }}>
                #{r.receiptNumber}
              </span>
              <div>
                <span style={{ fontWeight: 'var(--fw-medium)', fontSize: 'var(--fs-14)' }}>
                  {r.patientName}
                </span>
                <span style={{ display: 'block', fontSize: 'var(--fs-12)',
                               color: 'var(--text-muted)' }}>
                  {r.description} — {ROTULO_METODO[r.method]} — {formatarDataHora(r.paidAt)}
                </span>
              </div>
              <span className="num" style={{ fontSize: 'var(--fs-14)',
                                             fontVariantNumeric: 'tabular-nums' }}>
                {centavosParaReais(r.amountCents)}
              </span>
              <Botao variante="fantasma" altura={28}
                aria-label={`Imprimir recibo ${r.receiptNumber}`}
                onClick={() => { void p.aoImprimirRecibo(r.receiptId); }}>
                Imprimir
              </Botao>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
```

- [ ] Rodar e confirmar que passa:

```bash
cd apps/web && pnpm vitest run src/telas/Recibos.test.tsx src/ui/BarraDeNavegacao.test.tsx
# Esperado: todos os testes passando
```

- [ ] Commitar:

```bash
git add apps/web/src/ui/nav.ts apps/web/src/ui/BarraDeNavegacao.test.tsx \
  apps/web/src/telas/Recibos.tsx apps/web/src/telas/Recibos.test.tsx
git commit -m "feat(web): enable Financeiro nav in phase 2 and add receipts screen"
```

---