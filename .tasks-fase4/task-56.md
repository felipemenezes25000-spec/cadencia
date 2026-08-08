### Task 56: Tela A faturar — fila de guias pendentes de inclusao em lote

**Arquivos**

- Criar `apps/web/src/telas/ConveniosAFaturar.tsx`
- Criar `apps/web/src/telas/ConveniosAFaturar.test.tsx`

**Por que**: A fila "A faturar" (`/financeiro/convenios`) lista guias pendentes de inclusao em lote, com filtros por operadora, periodo e status (completa/incompleta), selecao multipla para criar lote em batch, e badge com contagem de guias incompletas (dados faltando). Cada guia na lista e clicavel para abrir o detalhe no painel lateral.

- [ ] Criar o teste `apps/web/src/telas/ConveniosAFaturar.test.tsx`:

```tsx
// apps/web/src/telas/ConveniosAFaturar.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import {
  ConveniosAFaturar,
  type GuiaPendente,
  type AFaturarDados,
  type FiltrosAFaturar,
} from './ConveniosAFaturar';

const GUIAS: readonly GuiaPendente[] = [
  {
    id: 'g1', numeroGuia: '000001', pacienteNome: 'Maria Souza',
    operadoraNome: 'Unimed', registroAns: '123456',
    codigoProcedimento: '10101012', nomeProcedimento: 'Consulta',
    valorCentavos: 15000, dataAtendimento: '2026-08-01',
    status: 'completa',
  },
  {
    id: 'g2', numeroGuia: '000002', pacienteNome: 'Joao Silva',
    operadoraNome: 'Bradesco Saude', registroAns: '654321',
    codigoProcedimento: '10101012', nomeProcedimento: 'Consulta',
    valorCentavos: 18000, dataAtendimento: '2026-08-02',
    status: 'incompleta',
  },
  {
    id: 'g3', numeroGuia: '000003', pacienteNome: 'Ana Costa',
    operadoraNome: 'Unimed', registroAns: '123456',
    codigoProcedimento: '20201015', nomeProcedimento: 'Retorno',
    valorCentavos: 0, dataAtendimento: '2026-08-03',
    status: 'completa',
  },
];

const DADOS: AFaturarDados = {
  guias: GUIAS,
  operadoras: [
    { id: 'op1', nome: 'Unimed', registroAns: '123456' },
    { id: 'op2', nome: 'Bradesco Saude', registroAns: '654321' },
  ],
};

function montar() {
  const props = {
    carregarDados: vi.fn(async (_f: FiltrosAFaturar) => DADOS),
    aoCriarLote: vi.fn(async (_ids: readonly string[]) => {}),
    aoAbrirGuia: vi.fn((_id: string) => {}),
  };
  render(<ConveniosAFaturar {...props} />);
  return props;
}

describe('ConveniosAFaturar', () => {
  it('lista as guias pendentes com paciente, operadora e valor', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('Maria Souza')).toBeVisible());
    expect(screen.getByText('Joao Silva')).toBeVisible();
    expect(screen.getByText('Ana Costa')).toBeVisible();
    expect(screen.getByText('Unimed')).toBeVisible();
  });

  it('exibe o numero da guia em fonte mono', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('000001')).toBeVisible());
    expect(screen.getByText('000001').className).toContain('num');
  });

  it('guias incompletas tem badge de alerta', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('Joao Silva')).toBeVisible());
    const linha = screen.getByText('Joao Silva').closest('li');
    expect(linha).toBeTruthy();
    expect(within(linha!).getByText(/Incompleta/i)).toBeVisible();
  });

  it('guias completas nao tem badge de incompleta', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('Maria Souza')).toBeVisible());
    const linha = screen.getByText('Maria Souza').closest('li');
    expect(linha).toBeTruthy();
    expect(within(linha!).queryByText(/Incompleta/i)).not.toBeInTheDocument();
  });

  it('cada guia tem um checkbox para selecao', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('Maria Souza')).toBeVisible());
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes.length).toBe(3);
  });

  it('ao selecionar guias e clicar "Criar lote" chama aoCriarLote com os ids', async () => {
    const props = montar();
    await waitFor(() => expect(screen.getByText('Maria Souza')).toBeVisible());
    const checkboxes = screen.getAllByRole('checkbox');
    await userEvent.click(checkboxes[0]!);
    await userEvent.click(checkboxes[2]!);
    const botao = screen.getByRole('button', { name: /Criar lote/i });
    await userEvent.click(botao);
    expect(props.aoCriarLote).toHaveBeenCalledWith(['g1', 'g3']);
  });

  it('botao "Criar lote" so aparece quando ha selecao', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('Maria Souza')).toBeVisible());
    expect(screen.queryByRole('button', { name: /Criar lote/i })).not.toBeInTheDocument();
    const checkboxes = screen.getAllByRole('checkbox');
    await userEvent.click(checkboxes[0]!);
    expect(screen.getByRole('button', { name: /Criar lote/i })).toBeVisible();
  });

  it('ao clicar na linha da guia chama aoAbrirGuia com o id', async () => {
    const props = montar();
    await waitFor(() => expect(screen.getByText('Maria Souza')).toBeVisible());
    await userEvent.click(screen.getByText('Maria Souza'));
    expect(props.aoAbrirGuia).toHaveBeenCalledWith('g1');
  });

  it('tem filtro por operadora', async () => {
    montar();
    await waitFor(() => expect(screen.getByLabelText(/Operadora/i)).toBeVisible());
  });

  it('tem filtro por periodo', async () => {
    montar();
    await waitFor(() => expect(screen.getByLabelText(/Periodo inicio/i)).toBeVisible());
    expect(screen.getByLabelText(/Periodo fim/i)).toBeVisible();
  });

  it('tem filtro por status (completa/incompleta)', async () => {
    montar();
    await waitFor(() => expect(screen.getByLabelText(/Status/i)).toBeVisible());
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <ConveniosAFaturar
        carregarDados={async () => DADOS}
        aoCriarLote={async () => {}}
        aoAbrirGuia={() => {}}
      />,
    );
    await waitFor(() => expect(screen.getByText('Maria Souza')).toBeVisible());
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Rodar o teste e confirmar que falha porque o modulo nao existe:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run apps/web/src/telas/ConveniosAFaturar.test.tsx 2>&1 | head -20
# Esperado: FAIL — Cannot find module './ConveniosAFaturar'
```

- [ ] Criar o componente `apps/web/src/telas/ConveniosAFaturar.tsx`:

```tsx
// apps/web/src/telas/ConveniosAFaturar.tsx
'use client';

import { useEffect, useState } from 'react';
import { Botao } from '../ui/Botao';
import { Campo } from '../ui/Campo';

// ── Tipos ──────────────────────────────────────────────────────────────────

export interface GuiaPendente {
  readonly id: string;
  readonly numeroGuia: string;
  readonly pacienteNome: string;
  readonly operadoraNome: string;
  readonly registroAns: string;
  readonly codigoProcedimento: string;
  readonly nomeProcedimento: string;
  readonly valorCentavos: number;
  readonly dataAtendimento: string;
  readonly status: 'completa' | 'incompleta';
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
  readonly operadoraId?: string;
  readonly status?: string;
  readonly dataInicio?: string;
  readonly dataFim?: string;
}

export interface ConveniosAFaturarProps {
  readonly carregarDados: (filtros: FiltrosAFaturar) => Promise<AFaturarDados>;
  readonly aoCriarLote: (guiaIds: readonly string[]) => Promise<void>;
  readonly aoAbrirGuia: (guiaId: string) => void;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function centavosParaReais(centavos: number): string {
  const abs = Math.abs(centavos);
  const inteiro = Math.floor(abs / 100);
  const decimais = String(abs % 100).padStart(2, '0');
  const formatado = inteiro.toLocaleString('pt-BR');
  return `R$ ${centavos < 0 ? '-' : ''}${formatado},${decimais}`;
}

// ── Componente ─────────────────────────────────────────────────────────────

export function ConveniosAFaturar(p: ConveniosAFaturarProps) {
  const [dados, setDados] = useState<AFaturarDados | null>(null);
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set());
  const [operadoraId, setOperadoraId] = useState('');
  const [status, setStatus] = useState('');
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');

  useEffect(() => {
    void p.carregarDados({}).then(setDados);
  }, [p]);

  function filtrar(): void {
    void p.carregarDados({
      operadoraId: operadoraId === '' ? undefined : operadoraId,
      status: status === '' ? undefined : status,
      dataInicio: dataInicio === '' ? undefined : dataInicio,
      dataFim: dataFim === '' ? undefined : dataFim,
    }).then(setDados);
  }

  function alternarSelecao(id: string): void {
    setSelecionadas((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  if (dados === null) return null;

  return (
    <div style={{ display: 'grid', gap: 'var(--s-6)' }}>
      {/* Filtros */}
      <div style={{ display: 'flex', gap: 'var(--s-4)', flexWrap: 'wrap', alignItems: 'end' }}>
        <div style={{ display: 'grid', gap: 'var(--s-2)' }}>
          <label htmlFor="filtro-operadora-af" style={{
            fontSize: 'var(--fs-12)', fontWeight: 'var(--fw-medium)',
            lineHeight: 1.3, color: 'var(--text-muted)',
          }}>
            Operadora
          </label>
          <select
            id="filtro-operadora-af"
            value={operadoraId}
            onChange={(e) => setOperadoraId(e.target.value)}
            aria-label="Operadora"
            style={{
              height: 32, padding: '0 var(--s-4)',
              border: 'var(--border)', borderRadius: 'var(--r-md)',
              background: 'var(--surface)', color: 'var(--text)',
              fontSize: 'var(--fs-14)',
            }}
          >
            <option value="">Todas</option>
            {dados.operadoras.map((op) => (
              <option key={op.id} value={op.id}>{op.nome}</option>
            ))}
          </select>
        </div>

        <div style={{ display: 'grid', gap: 'var(--s-2)' }}>
          <label htmlFor="filtro-status-af" style={{
            fontSize: 'var(--fs-12)', fontWeight: 'var(--fw-medium)',
            lineHeight: 1.3, color: 'var(--text-muted)',
          }}>
            Status
          </label>
          <select
            id="filtro-status-af"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            aria-label="Status"
            style={{
              height: 32, padding: '0 var(--s-4)',
              border: 'var(--border)', borderRadius: 'var(--r-md)',
              background: 'var(--surface)', color: 'var(--text)',
              fontSize: 'var(--fs-14)',
            }}
          >
            <option value="">Todos</option>
            <option value="completa">Completa</option>
            <option value="incompleta">Incompleta</option>
          </select>
        </div>

        <Campo rotulo="Periodo inicio" type="date" denso
          value={dataInicio} onChange={(e) => setDataInicio(e.target.value)}
          aria-label="Periodo inicio" />
        <Campo rotulo="Periodo fim" type="date" denso
          value={dataFim} onChange={(e) => setDataFim(e.target.value)}
          aria-label="Periodo fim" />
        <Botao variante="secundario" altura={32} onClick={filtrar}>
          Filtrar
        </Botao>
      </div>

      {/* Barra de acao batch */}
      {selecionadas.size > 0 ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-4)',
                      padding: 'var(--s-3) var(--s-5)',
                      background: 'var(--accent-soft)', borderRadius: 'var(--r-md)' }}>
          <span style={{ fontSize: 'var(--fs-13)', color: 'var(--text)' }}>
            {selecionadas.size} guia(s) selecionada(s)
          </span>
          <Botao variante="primario" altura={32}
            onClick={() => { void p.aoCriarLote(Array.from(selecionadas)); }}>
            Criar lote
          </Botao>
        </div>
      ) : null}

      {/* Lista de guias */}
      <section aria-label="Guias a faturar">
        <ul style={{ listStyle: 'none', margin: 0, padding: 0,
                     border: 'var(--border)', borderRadius: 'var(--r-md)',
                     overflow: 'hidden', background: 'var(--surface)' }}>
          {dados.guias.map((g) => (
            <li key={g.id} style={{
              display: 'grid',
              gridTemplateColumns: 'auto 1fr auto',
              alignItems: 'center', gap: 'var(--s-4)',
              padding: 'var(--s-4) var(--s-5)',
              borderBottom: 'var(--border)', minHeight: 56,
            }}>
              {/* Checkbox de selecao */}
              <input
                type="checkbox"
                checked={selecionadas.has(g.id)}
                onChange={() => alternarSelecao(g.id)}
                aria-label={`Selecionar guia ${g.numeroGuia}`}
                style={{ width: 16, height: 16, cursor: 'pointer' }}
              />

              {/* Dados da guia */}
              <div
                role="button" tabIndex={0}
                onClick={() => p.aoAbrirGuia(g.id)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); p.aoAbrirGuia(g.id); } }}
                style={{ cursor: 'pointer' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-3)' }}>
                  <span className="num" style={{
                    fontSize: 'var(--fs-13)', fontVariantNumeric: 'tabular-nums',
                    color: 'var(--text-muted)', fontFamily: 'var(--font-mono)',
                  }}>
                    {g.numeroGuia}
                  </span>
                  <span style={{ fontWeight: 'var(--fw-medium)', fontSize: 'var(--fs-14)' }}>
                    {g.pacienteNome}
                  </span>
                  {g.status === 'incompleta' ? (
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: 'var(--s-2)',
                      fontSize: 'var(--fs-11)', textTransform: 'uppercase', letterSpacing: '.04em',
                      fontWeight: 'var(--fw-medium)', padding: 'var(--s-1) var(--s-4)',
                      borderRadius: 'var(--r-full)',
                      color: 'var(--warn)', background: 'var(--warn-soft)',
                    }}>
                      <span aria-hidden="true">!</span>Incompleta
                    </span>
                  ) : null}
                </div>
                <span style={{ display: 'block', fontSize: 'var(--fs-12)',
                               color: 'var(--text-muted)' }}>
                  {g.operadoraNome} — {g.nomeProcedimento} — {g.dataAtendimento}
                </span>
              </div>

              {/* Valor */}
              <span className="num" style={{
                fontSize: 'var(--fs-14)', fontWeight: 'var(--fw-medium)',
                fontVariantNumeric: 'tabular-nums',
              }}>
                {centavosParaReais(g.valorCentavos)}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
```

- [ ] Rodar o teste e confirmar que passa:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run apps/web/src/telas/ConveniosAFaturar.test.tsx 2>&1 | tail -5
# Esperado: Tests  12 passed
```

- [ ] Commitar:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
git add apps/web/src/telas/ConveniosAFaturar.tsx apps/web/src/telas/ConveniosAFaturar.test.tsx
git commit -m "feat(web): add ConveniosAFaturar billing queue screen"
```

---