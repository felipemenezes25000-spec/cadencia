### Task 37: Componente ConveniosRetornos — lista de demonstrativos importados

**Arquivos**

- Criar `apps/web/src/telas/ConveniosRetornos.tsx`
- Criar `apps/web/src/telas/ConveniosRetornos.test.tsx`

**Por que**: Design §5.3 define "retornos e glosas" como destino dentro de Convenios. A lista de demonstrativos importados e a tela primaria: mostra cada demonstrativo com operadora, periodo, tipo (analise/pagamento), totalizadores (apresentado, processado, liberado, glosado), e acao de importar XML. O componente segue o padrao de ConveniosAFaturar — recebe callbacks para carregar dados e executar acoes, sem dependencia direta da API.

- [ ] Criar o arquivo de teste `apps/web/src/telas/ConveniosRetornos.test.tsx`:

```tsx
// apps/web/src/telas/ConveniosRetornos.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import {
  ConveniosRetornos,
  type RetornosDados,
  type FiltrosRetornos,
} from './ConveniosRetornos';

const DADOS: RetornosDados = {
  demonstrativos: [
    {
      id: 'd1',
      operadoraNome: 'Unimed',
      operadoraId: 'op1',
      registroAns: '123456',
      protocolo: 'PROT-001',
      tipo: 'analise',
      dataImportacao: '2026-08-01',
      periodoInicio: '2026-07-01',
      periodoFim: '2026-07-31',
      totalApresentadoCentavos: 500000,
      totalProcessadoCentavos: 480000,
      totalLiberadoCentavos: 450000,
      totalGlosadoCentavos: 30000,
      totalItens: 15,
      itensGlosados: 3,
    },
    {
      id: 'd2',
      operadoraNome: 'Bradesco Saude',
      operadoraId: 'op2',
      registroAns: '654321',
      protocolo: 'PROT-002',
      tipo: 'pagamento',
      dataImportacao: '2026-08-02',
      periodoInicio: '2026-07-01',
      periodoFim: '2026-07-31',
      totalApresentadoCentavos: 300000,
      totalProcessadoCentavos: 300000,
      totalLiberadoCentavos: 300000,
      totalGlosadoCentavos: 0,
      totalItens: 10,
      itensGlosados: 0,
    },
  ],
  operadoras: [
    { id: 'op1', nome: 'Unimed', registroAns: '123456' },
    { id: 'op2', nome: 'Bradesco Saude', registroAns: '654321' },
  ],
  totais: {
    apresentadoCentavos: 800000,
    processadoCentavos: 780000,
    liberadoCentavos: 750000,
    glosadoCentavos: 30000,
  },
};

function montar(overrides: Partial<{
  carregarDados: (f: FiltrosRetornos) => Promise<RetornosDados>;
  aoImportarXml: (arquivo: File) => Promise<void>;
  aoAbrirDemonstrativo: (id: string) => void;
}> = {}) {
  const carregarDados = vi.fn<(f: FiltrosRetornos) => Promise<RetornosDados>>()
    .mockResolvedValue(DADOS);
  const aoImportarXml = vi.fn<(arquivo: File) => Promise<void>>()
    .mockResolvedValue(undefined);
  const aoAbrirDemonstrativo = vi.fn();

  render(
    <ConveniosRetornos
      carregarDados={overrides.carregarDados ?? carregarDados}
      aoImportarXml={overrides.aoImportarXml ?? aoImportarXml}
      aoAbrirDemonstrativo={overrides.aoAbrirDemonstrativo ?? aoAbrirDemonstrativo}
    />,
  );
  return { carregarDados, aoImportarXml, aoAbrirDemonstrativo };
}

describe('ConveniosRetornos', () => {
  it('renderiza totalizadores: apresentado, processado, liberado, glosado', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByText(/Apresentado/i)).toBeVisible();
    });
    const grupo = screen.getByRole('group', { name: /Totalizadores de retornos/i });
    expect(grupo).toBeVisible();
    expect(screen.getByText('R$ 8.000,00')).toBeVisible();
    expect(screen.getByText('R$ 7.800,00')).toBeVisible();
    expect(screen.getByText('R$ 7.500,00')).toBeVisible();
    expect(screen.getByText('R$ 300,00')).toBeVisible();
  });

  it('renderiza lista de demonstrativos com protocolo, operadora e tipo', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByText('PROT-001')).toBeVisible();
    });
    expect(screen.getByText('PROT-002')).toBeVisible();
    expect(screen.getByText('Unimed')).toBeVisible();
    expect(screen.getByText('Bradesco Saude')).toBeVisible();
    expect(screen.getByText(/Analise/i)).toBeVisible();
    expect(screen.getByText(/Pagamento/i)).toBeVisible();
  });

  it('exibe badge de itens glosados quando ha glosas', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByText('PROT-001')).toBeVisible();
    });
    expect(screen.getByText(/3 glosa/i)).toBeVisible();
  });

  it('ao clicar em um demonstrativo chama aoAbrirDemonstrativo', async () => {
    const { aoAbrirDemonstrativo } = montar();
    await waitFor(() => {
      expect(screen.getByText('PROT-001')).toBeVisible();
    });
    await userEvent.click(screen.getByText('PROT-001'));
    expect(aoAbrirDemonstrativo).toHaveBeenCalledWith('d1');
  });

  it('renderiza filtros de operadora, periodo e tipo', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByLabelText(/Operadora/i)).toBeVisible();
    });
    expect(screen.getByLabelText(/Periodo inicio/i)).toBeVisible();
    expect(screen.getByLabelText(/Periodo fim/i)).toBeVisible();
    expect(screen.getByLabelText(/Tipo/i)).toBeVisible();
  });

  it('botao Importar esta visivel', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Importar/i })).toBeVisible();
    });
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <ConveniosRetornos
        carregarDados={async () => DADOS}
        aoImportarXml={async () => {}}
        aoAbrirDemonstrativo={() => {}}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText('PROT-001')).toBeVisible();
    });
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Executar o teste e confirmar que falha (componente ainda nao existe):

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run apps/web/src/telas/ConveniosRetornos.test.tsx 2>&1 | tail -5
# Esperado: FAIL — Cannot find module './ConveniosRetornos'
```

- [ ] Criar o componente `apps/web/src/telas/ConveniosRetornos.tsx`:

```tsx
// apps/web/src/telas/ConveniosRetornos.tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { Botao } from '../ui/Botao';
import { Campo } from '../ui/Campo';

// ── Tipos ──────────────────────────────────────────────────────────────────

export interface Demonstrativo {
  readonly id: string;
  readonly operadoraNome: string;
  readonly operadoraId: string;
  readonly registroAns: string;
  readonly protocolo: string;
  readonly tipo: 'analise' | 'pagamento';
  readonly dataImportacao: string;
  readonly periodoInicio: string;
  readonly periodoFim: string;
  readonly totalApresentadoCentavos: number;
  readonly totalProcessadoCentavos: number;
  readonly totalLiberadoCentavos: number;
  readonly totalGlosadoCentavos: number;
  readonly totalItens: number;
  readonly itensGlosados: number;
}

export interface OperadoraResumo {
  readonly id: string;
  readonly nome: string;
  readonly registroAns: string;
}

export interface TotaisRetornos {
  readonly apresentadoCentavos: number;
  readonly processadoCentavos: number;
  readonly liberadoCentavos: number;
  readonly glosadoCentavos: number;
}

export interface RetornosDados {
  readonly demonstrativos: readonly Demonstrativo[];
  readonly operadoras: readonly OperadoraResumo[];
  readonly totais: TotaisRetornos;
}

export interface FiltrosRetornos {
  readonly operadoraId?: string;
  readonly tipo?: 'analise' | 'pagamento';
  readonly dataInicio?: string;
  readonly dataFim?: string;
}

export interface ConveniosRetornosProps {
  readonly carregarDados: (filtros: FiltrosRetornos) => Promise<RetornosDados>;
  readonly aoImportarXml: (arquivo: File) => Promise<void>;
  readonly aoAbrirDemonstrativo: (id: string) => void;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function centavosParaReais(centavos: number): string {
  const abs = Math.abs(centavos);
  const inteiro = Math.floor(abs / 100);
  const decimais = String(abs % 100).padStart(2, '0');
  const formatado = inteiro.toLocaleString('pt-BR');
  return `R$ ${centavos < 0 ? '-' : ''}${formatado},${decimais}`;
}

const ROTULOS_TOTAIS: { chave: keyof TotaisRetornos; rotulo: string }[] = [
  { chave: 'apresentadoCentavos', rotulo: 'Apresentado' },
  { chave: 'processadoCentavos', rotulo: 'Processado' },
  { chave: 'liberadoCentavos', rotulo: 'Liberado' },
  { chave: 'glosadoCentavos', rotulo: 'Glosado' },
];

const TIPO_CHIP: Record<'analise' | 'pagamento', { rotulo: string; cor: string; bg: string }> = {
  analise:    { rotulo: 'Analise',    cor: 'var(--accent)',  bg: 'var(--accent-soft)' },
  pagamento:  { rotulo: 'Pagamento',  cor: 'var(--ok)',      bg: 'var(--ok-soft)' },
};

// ── Componente ─────────────────────────────────────────────────────────────

export function ConveniosRetornos(p: ConveniosRetornosProps) {
  const [dados, setDados] = useState<RetornosDados | null>(null);
  const [operadoraId, setOperadoraId] = useState('');
  const [tipo, setTipo] = useState('');
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');
  const [importando, setImportando] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void p.carregarDados({}).then(setDados);
  }, [p]);

  function filtrar(): void {
    void p.carregarDados({
      operadoraId: operadoraId === '' ? undefined : operadoraId,
      tipo: tipo === '' ? undefined : tipo as 'analise' | 'pagamento',
      dataInicio: dataInicio === '' ? undefined : dataInicio,
      dataFim: dataFim === '' ? undefined : dataFim,
    }).then(setDados);
  }

  function abrirDialogImportar(): void {
    fileRef.current?.click();
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>): void {
    const arquivo = e.target.files?.[0];
    if (arquivo === undefined) return;
    setImportando(true);
    void p.aoImportarXml(arquivo).finally(() => {
      setImportando(false);
      if (fileRef.current) fileRef.current.value = '';
      void p.carregarDados({}).then(setDados);
    });
  }

  if (dados === null) return null;

  return (
    <div style={{ display: 'grid', gap: 'var(--s-6)' }}>
      {/* Cabecalho */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)', margin: 0 }}>
          Retornos
        </h3>
        <div>
          <input
            ref={fileRef}
            type="file"
            accept=".xml"
            onChange={handleFileChange}
            style={{ display: 'none' }}
            aria-label="Selecionar arquivo XML"
          />
          <Botao variante="primario" altura={32}
            onClick={abrirDialogImportar} carregando={importando}>
            Importar
          </Botao>
        </div>
      </div>

      {/* Totalizadores */}
      <div
        role="group" aria-label="Totalizadores de retornos" aria-live="polite"
        style={{ display: 'flex', border: 'var(--border)', borderRadius: 'var(--r-md)',
                 background: 'var(--surface)', overflow: 'hidden' }}
      >
        {ROTULOS_TOTAIS.map((t, i) => (
          <div
            key={t.chave}
            style={{
              flex: 1,
              borderInlineStart: i === 0 ? 'none' : '1px solid var(--line)',
              padding: `var(--s-5) var(--s-4)`,
              display: 'grid', gap: 'var(--s-1)', justifyItems: 'start',
            }}
          >
            <span className="num" style={{ fontSize: '28px', fontWeight: 600, lineHeight: 1.1,
                                           color: t.chave === 'glosadoCentavos' && dados.totais[t.chave] > 0
                                             ? 'var(--danger)' : 'var(--text)' }}>
              {centavosParaReais(dados.totais[t.chave])}
            </span>
            <span style={{ fontSize: 'var(--fs-11)', textTransform: 'uppercase',
                           letterSpacing: '.04em', color: 'var(--text-muted)' }}>
              {t.rotulo}
            </span>
          </div>
        ))}
      </div>

      {/* Filtros */}
      <div style={{ display: 'flex', gap: 'var(--s-4)', flexWrap: 'wrap', alignItems: 'end' }}>
        <div style={{ display: 'grid', gap: 'var(--s-2)' }}>
          <label htmlFor="filtro-operadora-ret" style={{
            fontSize: 'var(--fs-12)', fontWeight: 'var(--fw-medium)',
            lineHeight: 1.3, color: 'var(--text-muted)',
          }}>
            Operadora
          </label>
          <select
            id="filtro-operadora-ret"
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
          <label htmlFor="filtro-tipo-ret" style={{
            fontSize: 'var(--fs-12)', fontWeight: 'var(--fw-medium)',
            lineHeight: 1.3, color: 'var(--text-muted)',
          }}>
            Tipo
          </label>
          <select
            id="filtro-tipo-ret"
            value={tipo}
            onChange={(e) => setTipo(e.target.value)}
            aria-label="Tipo"
            style={{
              height: 32, padding: '0 var(--s-4)',
              border: 'var(--border)', borderRadius: 'var(--r-md)',
              background: 'var(--surface)', color: 'var(--text)',
              fontSize: 'var(--fs-14)',
            }}
          >
            <option value="">Todos</option>
            <option value="analise">Analise</option>
            <option value="pagamento">Pagamento</option>
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

      {/* Lista de demonstrativos */}
      <section aria-label="Demonstrativos importados">
        <ul style={{ listStyle: 'none', margin: 0, padding: 0,
                     border: 'var(--border)', borderRadius: 'var(--r-md)',
                     overflow: 'hidden', background: 'var(--surface)' }}>
          {dados.demonstrativos.map((d) => {
            const chip = TIPO_CHIP[d.tipo];
            return (
              <li key={d.id} style={{
                display: 'grid',
                gridTemplateColumns: '1fr auto',
                alignItems: 'center', gap: 'var(--s-4)',
                padding: 'var(--s-4) var(--s-5)',
                borderBottom: 'var(--border)', minHeight: 56,
              }}>
                <div
                  role="button" tabIndex={0}
                  onClick={() => p.aoAbrirDemonstrativo(d.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      p.aoAbrirDemonstrativo(d.id);
                    }
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-3)' }}>
                    <span className="num" style={{
                      fontSize: 'var(--fs-13)', fontVariantNumeric: 'tabular-nums',
                      color: 'var(--text-muted)', fontFamily: 'var(--font-mono)',
                    }}>
                      {d.protocolo}
                    </span>
                    <span style={{ fontWeight: 'var(--fw-medium)', fontSize: 'var(--fs-14)' }}>
                      {d.operadoraNome}
                    </span>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center',
                      fontSize: 'var(--fs-11)', textTransform: 'uppercase', letterSpacing: '.04em',
                      fontWeight: 'var(--fw-medium)', padding: 'var(--s-1) var(--s-4)',
                      borderRadius: 'var(--r-full)',
                      color: chip.cor, background: chip.bg,
                    }}>
                      {chip.rotulo}
                    </span>
                    {d.itensGlosados > 0 ? (
                      <span style={{
                        display: 'inline-flex', alignItems: 'center',
                        fontSize: 'var(--fs-11)', fontWeight: 'var(--fw-medium)',
                        padding: 'var(--s-1) var(--s-4)',
                        borderRadius: 'var(--r-full)',
                        color: 'var(--danger)', background: 'var(--danger-soft)',
                      }}>
                        {d.itensGlosados} glosa(s)
                      </span>
                    ) : null}
                  </div>
                  <span style={{ display: 'block', fontSize: 'var(--fs-12)',
                                 color: 'var(--text-muted)' }}>
                    {d.periodoInicio} a {d.periodoFim} — {d.totalItens} iten(s) — Importado em {d.dataImportacao}
                  </span>
                </div>

                <div style={{ display: 'flex', gap: 'var(--s-6)', alignItems: 'baseline' }}>
                  <div style={{ textAlign: 'right' }}>
                    <span className="num" style={{
                      fontSize: 'var(--fs-14)', fontWeight: 'var(--fw-medium)',
                      fontVariantNumeric: 'tabular-nums',
                    }}>
                      {centavosParaReais(d.totalLiberadoCentavos)}
                    </span>
                    <span style={{ display: 'block', fontSize: 'var(--fs-11)',
                                   color: 'var(--text-muted)' }}>
                      liberado
                    </span>
                  </div>
                  {d.totalGlosadoCentavos > 0 ? (
                    <div style={{ textAlign: 'right' }}>
                      <span className="num" style={{
                        fontSize: 'var(--fs-14)', fontWeight: 'var(--fw-medium)',
                        fontVariantNumeric: 'tabular-nums', color: 'var(--danger)',
                      }}>
                        {centavosParaReais(d.totalGlosadoCentavos)}
                      </span>
                      <span style={{ display: 'block', fontSize: 'var(--fs-11)',
                                     color: 'var(--text-muted)' }}>
                        glosado
                      </span>
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
```

- [ ] Executar o teste e confirmar que passa:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run apps/web/src/telas/ConveniosRetornos.test.tsx 2>&1 | tail -3
# Esperado: Tests  7 passed
```

- [ ] Commitar:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
git add apps/web/src/telas/ConveniosRetornos.tsx apps/web/src/telas/ConveniosRetornos.test.tsx
git commit -m "feat(web): add ConveniosRetornos component with demonstrativo list and filters

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 38: Componente ConveniosGlosas — lista de glosas agrupadas por guia

**Arquivos**

- Criar `apps/web/src/telas/ConveniosGlosas.tsx`
- Criar `apps/web/src/telas/ConveniosGlosas.test.tsx`

**Por que**: Design §5.3 define sub-aba de glosas com lista agrupada por guia, filtros (status, operadora, periodo, valor), selecao multipla para "Criar recurso", e badge de valor total glosado pendente. A tela permite a gestora identificar rapidamente quais glosas merecem recurso.

- [ ] Criar o arquivo de teste `apps/web/src/telas/ConveniosGlosas.test.tsx`:

```tsx
// apps/web/src/telas/ConveniosGlosas.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import {
  ConveniosGlosas,
  type GlosasDados,
  type FiltrosGlosas,
} from './ConveniosGlosas';

const DADOS: GlosasDados = {
  glosas: [
    {
      id: 'gl1',
      demonstrativoId: 'd1',
      guiaNumero: '000001',
      pacienteNome: 'Carlos Melo',
      operadoraNome: 'Unimed',
      operadoraId: 'op1',
      codigoProcedimento: '10101012',
      nomeProcedimento: 'Consulta',
      codigoGlosa: '1005',
      descricaoGlosa: 'Procedimento nao autorizado',
      valorApresentadoCentavos: 15000,
      valorGlosadoCentavos: 15000,
      dataAtendimento: '2026-07-15',
      status: 'pendente',
    },
    {
      id: 'gl2',
      demonstrativoId: 'd1',
      guiaNumero: '000002',
      pacienteNome: 'Ana Silva',
      operadoraNome: 'Unimed',
      operadoraId: 'op1',
      codigoProcedimento: '10101012',
      nomeProcedimento: 'Consulta',
      codigoGlosa: '1015',
      descricaoGlosa: 'Fora do prazo',
      valorApresentadoCentavos: 15000,
      valorGlosadoCentavos: 8000,
      dataAtendimento: '2026-07-16',
      status: 'pendente',
    },
    {
      id: 'gl3',
      demonstrativoId: 'd1',
      guiaNumero: '000003',
      pacienteNome: 'Jose Santos',
      operadoraNome: 'Unimed',
      operadoraId: 'op1',
      codigoProcedimento: '10101012',
      nomeProcedimento: 'Consulta',
      codigoGlosa: '1005',
      descricaoGlosa: 'Procedimento nao autorizado',
      valorApresentadoCentavos: 15000,
      valorGlosadoCentavos: 15000,
      dataAtendimento: '2026-07-17',
      status: 'recurso_enviado',
    },
  ],
  operadoras: [
    { id: 'op1', nome: 'Unimed', registroAns: '123456' },
  ],
  totalGlosadoPendenteCentavos: 23000,
};

function montar(overrides: Partial<{
  carregarDados: (f: FiltrosGlosas) => Promise<GlosasDados>;
  aoCriarRecurso: (glosaIds: readonly string[]) => void;
}> = {}) {
  const carregarDados = vi.fn<(f: FiltrosGlosas) => Promise<GlosasDados>>()
    .mockResolvedValue(DADOS);
  const aoCriarRecurso = vi.fn();

  render(
    <ConveniosGlosas
      carregarDados={overrides.carregarDados ?? carregarDados}
      aoCriarRecurso={overrides.aoCriarRecurso ?? aoCriarRecurso}
    />,
  );
  return { carregarDados, aoCriarRecurso };
}

describe('ConveniosGlosas', () => {
  it('renderiza badge de valor total glosado pendente', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByText(/R\$ 230,00/)).toBeVisible();
    });
    expect(screen.getByText(/pendente/i)).toBeVisible();
  });

  it('renderiza lista de glosas com guia, paciente e codigo da glosa', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByText('000001')).toBeVisible();
    });
    expect(screen.getByText('Carlos Melo')).toBeVisible();
    expect(screen.getByText('1005')).toBeVisible();
    expect(screen.getByText(/Procedimento nao autorizado/)).toBeVisible();
  });

  it('renderiza chip de status para glosa com recurso enviado', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByText('000003')).toBeVisible();
    });
    expect(screen.getByText(/Recurso enviado/i)).toBeVisible();
  });

  it('permite selecionar glosas pendentes com checkbox', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByText('000001')).toBeVisible();
    });
    const checkboxes = screen.getAllByRole('checkbox', { name: /Selecionar glosa/i });
    // So glosas pendentes tem checkbox (2 de 3)
    expect(checkboxes).toHaveLength(2);
  });

  it('ao selecionar glosas e clicar "Criar recurso" chama callback com ids', async () => {
    const { aoCriarRecurso } = montar();
    await waitFor(() => {
      expect(screen.getByText('000001')).toBeVisible();
    });
    const checkboxes = screen.getAllByRole('checkbox', { name: /Selecionar glosa/i });
    await userEvent.click(checkboxes[0]!);
    await userEvent.click(checkboxes[1]!);
    const botao = screen.getByRole('button', { name: /Criar recurso/i });
    expect(botao).toBeVisible();
    await userEvent.click(botao);
    expect(aoCriarRecurso).toHaveBeenCalledWith(['gl1', 'gl2']);
  });

  it('renderiza filtros de status, operadora e periodo', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByLabelText(/Status/i)).toBeVisible();
    });
    expect(screen.getByLabelText(/Operadora/i)).toBeVisible();
    expect(screen.getByLabelText(/Periodo inicio/i)).toBeVisible();
    expect(screen.getByLabelText(/Periodo fim/i)).toBeVisible();
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <ConveniosGlosas
        carregarDados={async () => DADOS}
        aoCriarRecurso={() => {}}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText('000001')).toBeVisible();
    });
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Executar o teste e confirmar que falha:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run apps/web/src/telas/ConveniosGlosas.test.tsx 2>&1 | tail -5
# Esperado: FAIL — Cannot find module './ConveniosGlosas'
```

- [ ] Criar o componente `apps/web/src/telas/ConveniosGlosas.tsx`:

```tsx
// apps/web/src/telas/ConveniosGlosas.tsx
'use client';

import { useEffect, useState } from 'react';
import { Botao } from '../ui/Botao';
import { Campo } from '../ui/Campo';

// ── Tipos ──────────────────────────────────────────────────────────────────

export type StatusGlosa = 'pendente' | 'recurso_enviado' | 'recurso_aceito' | 'recurso_negado';

export interface Glosa {
  readonly id: string;
  readonly demonstrativoId: string;
  readonly guiaNumero: string;
  readonly pacienteNome: string;
  readonly operadoraNome: string;
  readonly operadoraId: string;
  readonly codigoProcedimento: string;
  readonly nomeProcedimento: string;
  readonly codigoGlosa: string;
  readonly descricaoGlosa: string;
  readonly valorApresentadoCentavos: number;
  readonly valorGlosadoCentavos: number;
  readonly dataAtendimento: string;
  readonly status: StatusGlosa;
}

export interface OperadoraResumo {
  readonly id: string;
  readonly nome: string;
  readonly registroAns: string;
}

export interface GlosasDados {
  readonly glosas: readonly Glosa[];
  readonly operadoras: readonly OperadoraResumo[];
  readonly totalGlosadoPendenteCentavos: number;
}

export interface FiltrosGlosas {
  readonly status?: StatusGlosa;
  readonly operadoraId?: string;
  readonly dataInicio?: string;
  readonly dataFim?: string;
}

export interface ConveniosGlosasProps {
  readonly carregarDados: (filtros: FiltrosGlosas) => Promise<GlosasDados>;
  readonly aoCriarRecurso: (glosaIds: readonly string[]) => void;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function centavosParaReais(centavos: number): string {
  const abs = Math.abs(centavos);
  const inteiro = Math.floor(abs / 100);
  const decimais = String(abs % 100).padStart(2, '0');
  const formatado = inteiro.toLocaleString('pt-BR');
  return `R$ ${centavos < 0 ? '-' : ''}${formatado},${decimais}`;
}

const STATUS_CHIP: Record<StatusGlosa, { rotulo: string; cor: string; bg: string }> = {
  pendente:        { rotulo: 'Pendente',        cor: 'var(--warn)',     bg: 'var(--warn-soft)' },
  recurso_enviado: { rotulo: 'Recurso enviado', cor: 'var(--accent)',   bg: 'var(--accent-soft)' },
  recurso_aceito:  { rotulo: 'Recurso aceito',  cor: 'var(--ok)',       bg: 'var(--ok-soft)' },
  recurso_negado:  { rotulo: 'Recurso negado',  cor: 'var(--danger)',   bg: 'var(--danger-soft)' },
};

// ── Componente ─────────────────────────────────────────────────────────────

export function ConveniosGlosas(p: ConveniosGlosasProps) {
  const [dados, setDados] = useState<GlosasDados | null>(null);
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set());
  const [statusFiltro, setStatusFiltro] = useState('');
  const [operadoraId, setOperadoraId] = useState('');
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');

  useEffect(() => {
    void p.carregarDados({}).then(setDados);
  }, [p]);

  function filtrar(): void {
    void p.carregarDados({
      status: statusFiltro === '' ? undefined : statusFiltro as StatusGlosa,
      operadoraId: operadoraId === '' ? undefined : operadoraId,
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
      {/* Cabecalho com badge de pendente */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-4)' }}>
          <h3 style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)', margin: 0 }}>
            Glosas
          </h3>
          {dados.totalGlosadoPendenteCentavos > 0 ? (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 'var(--s-2)',
              fontSize: 'var(--fs-12)', fontWeight: 'var(--fw-medium)',
              padding: 'var(--s-1) var(--s-4)',
              borderRadius: 'var(--r-full)',
              color: 'var(--danger)', background: 'var(--danger-soft)',
            }}>
              {centavosParaReais(dados.totalGlosadoPendenteCentavos)} pendente
            </span>
          ) : null}
        </div>
      </div>

      {/* Filtros */}
      <div style={{ display: 'flex', gap: 'var(--s-4)', flexWrap: 'wrap', alignItems: 'end' }}>
        <div style={{ display: 'grid', gap: 'var(--s-2)' }}>
          <label htmlFor="filtro-status-gl" style={{
            fontSize: 'var(--fs-12)', fontWeight: 'var(--fw-medium)',
            lineHeight: 1.3, color: 'var(--text-muted)',
          }}>
            Status
          </label>
          <select
            id="filtro-status-gl"
            value={statusFiltro}
            onChange={(e) => setStatusFiltro(e.target.value)}
            aria-label="Status"
            style={{
              height: 32, padding: '0 var(--s-4)',
              border: 'var(--border)', borderRadius: 'var(--r-md)',
              background: 'var(--surface)', color: 'var(--text)',
              fontSize: 'var(--fs-14)',
            }}
          >
            <option value="">Todos</option>
            <option value="pendente">Pendente</option>
            <option value="recurso_enviado">Recurso enviado</option>
            <option value="recurso_aceito">Recurso aceito</option>
            <option value="recurso_negado">Recurso negado</option>
          </select>
        </div>

        <div style={{ display: 'grid', gap: 'var(--s-2)' }}>
          <label htmlFor="filtro-operadora-gl" style={{
            fontSize: 'var(--fs-12)', fontWeight: 'var(--fw-medium)',
            lineHeight: 1.3, color: 'var(--text-muted)',
          }}>
            Operadora
          </label>
          <select
            id="filtro-operadora-gl"
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
            {selecionadas.size} glosa(s) selecionada(s)
          </span>
          <Botao variante="primario" altura={32}
            onClick={() => { p.aoCriarRecurso(Array.from(selecionadas)); }}>
            Criar recurso
          </Botao>
        </div>
      ) : null}

      {/* Lista de glosas */}
      <section aria-label="Lista de glosas">
        <ul style={{ listStyle: 'none', margin: 0, padding: 0,
                     border: 'var(--border)', borderRadius: 'var(--r-md)',
                     overflow: 'hidden', background: 'var(--surface)' }}>
          {dados.glosas.map((g) => {
            const chip = STATUS_CHIP[g.status];
            const selecionavel = g.status === 'pendente';

            return (
              <li key={g.id} style={{
                display: 'grid',
                gridTemplateColumns: selecionavel ? 'auto 1fr auto' : '1fr auto',
                alignItems: 'center', gap: 'var(--s-4)',
                padding: 'var(--s-4) var(--s-5)',
                borderBottom: 'var(--border)', minHeight: 56,
              }}>
                {selecionavel ? (
                  <input
                    type="checkbox"
                    checked={selecionadas.has(g.id)}
                    onChange={() => alternarSelecao(g.id)}
                    aria-label={`Selecionar glosa ${g.guiaNumero}`}
                    style={{ width: 16, height: 16, cursor: 'pointer' }}
                  />
                ) : null}

                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-3)' }}>
                    <span className="num" style={{
                      fontSize: 'var(--fs-13)', fontVariantNumeric: 'tabular-nums',
                      color: 'var(--text-muted)', fontFamily: 'var(--font-mono)',
                    }}>
                      {g.guiaNumero}
                    </span>
                    <span style={{ fontWeight: 'var(--fw-medium)', fontSize: 'var(--fs-14)' }}>
                      {g.pacienteNome}
                    </span>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center',
                      fontSize: 'var(--fs-11)', textTransform: 'uppercase', letterSpacing: '.04em',
                      fontWeight: 'var(--fw-medium)', padding: 'var(--s-1) var(--s-4)',
                      borderRadius: 'var(--r-full)',
                      color: chip.cor, background: chip.bg,
                    }}>
                      {chip.rotulo}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-3)',
                                fontSize: 'var(--fs-12)', color: 'var(--text-muted)' }}>
                    <span className="num" style={{ fontFamily: 'var(--font-mono)' }}>{g.codigoGlosa}</span>
                    <span>{g.descricaoGlosa}</span>
                    <span>—</span>
                    <span>{g.operadoraNome}</span>
                    <span>—</span>
                    <span>{g.dataAtendimento}</span>
                  </div>
                </div>

                <div style={{ textAlign: 'right' }}>
                  <span className="num" style={{
                    fontSize: 'var(--fs-14)', fontWeight: 'var(--fw-medium)',
                    fontVariantNumeric: 'tabular-nums', color: 'var(--danger)',
                  }}>
                    {centavosParaReais(g.valorGlosadoCentavos)}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
```

- [ ] Executar o teste e confirmar que passa:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run apps/web/src/telas/ConveniosGlosas.test.tsx 2>&1 | tail -3
# Esperado: Tests  7 passed
```

- [ ] Commitar:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
git add apps/web/src/telas/ConveniosGlosas.tsx apps/web/src/telas/ConveniosGlosas.test.tsx
git commit -m "feat(web): add ConveniosGlosas component with selection for recurso creation

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 39: Componente ConveniosRecursos — lista de recursos de glosa

**Arquivos**

- Criar `apps/web/src/telas/ConveniosRecursos.tsx`
- Criar `apps/web/src/telas/ConveniosRecursos.test.tsx`

**Por que**: Design §5.3 define sub-aba de recursos com status visual (chip), acoes (editar, enviar, ver resultado), e expansao com itens do recurso e justificativa. A gestora acompanha o ciclo de vida de cada recurso de glosa enviado.

- [ ] Criar o arquivo de teste `apps/web/src/telas/ConveniosRecursos.test.tsx`:

```tsx
// apps/web/src/telas/ConveniosRecursos.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import {
  ConveniosRecursos,
  type RecursosDados,
} from './ConveniosRecursos';

const DADOS: RecursosDados = {
  recursos: [
    {
      id: 'r1',
      operadoraNome: 'Unimed',
      operadoraId: 'op1',
      status: 'rascunho',
      justificativaGeral: 'Procedimentos realizados conforme protocolo clinico.',
      criadoEm: '2026-08-05',
      enviadoEm: null,
      totalGlosasCentavos: 23000,
      itens: [
        {
          id: 'ri1',
          glosaId: 'gl1',
          guiaNumero: '000001',
          pacienteNome: 'Carlos Melo',
          codigoGlosa: '1005',
          valorGlosadoCentavos: 15000,
          justificativa: 'Procedimento estava autorizado pela guia SADT 12345.',
        },
        {
          id: 'ri2',
          glosaId: 'gl2',
          guiaNumero: '000002',
          pacienteNome: 'Ana Silva',
          codigoGlosa: '1015',
          valorGlosadoCentavos: 8000,
          justificativa: 'Guia enviada dentro do prazo de 10 dias uteis.',
        },
      ],
    },
    {
      id: 'r2',
      operadoraNome: 'Bradesco Saude',
      operadoraId: 'op2',
      status: 'enviado',
      justificativaGeral: 'Recurso fundamentado.',
      criadoEm: '2026-08-01',
      enviadoEm: '2026-08-03',
      totalGlosasCentavos: 50000,
      itens: [
        {
          id: 'ri3',
          glosaId: 'gl4',
          guiaNumero: '000010',
          pacienteNome: 'Maria Costa',
          codigoGlosa: '1020',
          valorGlosadoCentavos: 50000,
          justificativa: 'Codigo correto conforme tabela TUSS vigente.',
        },
      ],
    },
  ],
};

function montar() {
  const carregarDados = vi.fn<() => Promise<RecursosDados>>()
    .mockResolvedValue(DADOS);
  const aoEditar = vi.fn();
  const aoEnviar = vi.fn<(id: string) => Promise<void>>()
    .mockResolvedValue(undefined);
  const aoVerResultado = vi.fn();

  render(
    <ConveniosRecursos
      carregarDados={carregarDados}
      aoEditar={aoEditar}
      aoEnviar={aoEnviar}
      aoVerResultado={aoVerResultado}
    />,
  );
  return { carregarDados, aoEditar, aoEnviar, aoVerResultado };
}

describe('ConveniosRecursos', () => {
  it('renderiza lista de recursos com operadora e status', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByText('Unimed')).toBeVisible();
    });
    expect(screen.getByText('Bradesco Saude')).toBeVisible();
    expect(screen.getByText(/Rascunho/i)).toBeVisible();
    expect(screen.getByText(/Enviado/i)).toBeVisible();
  });

  it('renderiza valor total de glosas em cada recurso', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByText('R$ 230,00')).toBeVisible();
    });
    expect(screen.getByText('R$ 500,00')).toBeVisible();
  });

  it('botao Editar aparece para recurso em rascunho', async () => {
    const { aoEditar } = montar();
    await waitFor(() => {
      expect(screen.getByText('Unimed')).toBeVisible();
    });
    const botoes = screen.getAllByRole('button', { name: /Editar/i });
    expect(botoes).toHaveLength(1);
    await userEvent.click(botoes[0]!);
    expect(aoEditar).toHaveBeenCalledWith('r1');
  });

  it('botao Enviar aparece para recurso em rascunho', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByText('Unimed')).toBeVisible();
    });
    expect(screen.getByRole('button', { name: /Enviar/i })).toBeVisible();
  });

  it('botao Ver resultado aparece para recurso enviado', async () => {
    const { aoVerResultado } = montar();
    await waitFor(() => {
      expect(screen.getByText('Bradesco Saude')).toBeVisible();
    });
    const botao = screen.getByRole('button', { name: /Ver resultado/i });
    await userEvent.click(botao);
    expect(aoVerResultado).toHaveBeenCalledWith('r2');
  });

  it('expandir recurso mostra itens com justificativa individual', async () => {
    montar();
    await waitFor(() => {
      expect(screen.getByText('Unimed')).toBeVisible();
    });
    const expandir = screen.getAllByRole('button', { name: /Expandir/i });
    await userEvent.click(expandir[0]!);
    expect(screen.getByText('Carlos Melo')).toBeVisible();
    expect(screen.getByText(/Procedimento estava autorizado/)).toBeVisible();
    expect(screen.getByText('Ana Silva')).toBeVisible();
    expect(screen.getByText(/Guia enviada dentro do prazo/)).toBeVisible();
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <ConveniosRecursos
        carregarDados={async () => DADOS}
        aoEditar={() => {}}
        aoEnviar={async () => {}}
        aoVerResultado={() => {}}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText('Unimed')).toBeVisible();
    });
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Executar o teste e confirmar que falha:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run apps/web/src/telas/ConveniosRecursos.test.tsx 2>&1 | tail -5
# Esperado: FAIL — Cannot find module './ConveniosRecursos'
```

- [ ] Criar o componente `apps/web/src/telas/ConveniosRecursos.tsx`:

```tsx
// apps/web/src/telas/ConveniosRecursos.tsx
'use client';

import { useEffect, useState } from 'react';
import { Botao } from '../ui/Botao';

// ── Tipos ──────────────────────────────────────────────────────────────────

export type StatusRecurso = 'rascunho' | 'enviado' | 'aceito' | 'negado' | 'parcial';

export interface ItemRecurso {
  readonly id: string;
  readonly glosaId: string;
  readonly guiaNumero: string;
  readonly pacienteNome: string;
  readonly codigoGlosa: string;
  readonly valorGlosadoCentavos: number;
  readonly justificativa: string;
}

export interface Recurso {
  readonly id: string;
  readonly operadoraNome: string;
  readonly operadoraId: string;
  readonly status: StatusRecurso;
  readonly justificativaGeral: string;
  readonly criadoEm: string;
  readonly enviadoEm: string | null;
  readonly totalGlosasCentavos: number;
  readonly itens: readonly ItemRecurso[];
}

export interface RecursosDados {
  readonly recursos: readonly Recurso[];
}

export interface ConveniosRecursosProps {
  readonly carregarDados: () => Promise<RecursosDados>;
  readonly aoEditar: (recursoId: string) => void;
  readonly aoEnviar: (recursoId: string) => Promise<void>;
  readonly aoVerResultado: (recursoId: string) => void;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function centavosParaReais(centavos: number): string {
  const abs = Math.abs(centavos);
  const inteiro = Math.floor(abs / 100);
  const decimais = String(abs % 100).padStart(2, '0');
  const formatado = inteiro.toLocaleString('pt-BR');
  return `R$ ${centavos < 0 ? '-' : ''}${formatado},${decimais}`;
}

const STATUS_CHIP: Record<StatusRecurso, { rotulo: string; glifo: string; cor: string; bg: string }> = {
  rascunho: { rotulo: 'Rascunho', glifo: '●', cor: 'var(--text-muted)', bg: 'var(--surface-sunken)' },
  enviado:  { rotulo: 'Enviado',  glifo: '↑', cor: 'var(--accent)',      bg: 'var(--accent-soft)' },
  aceito:   { rotulo: 'Aceito',   glifo: '✓', cor: 'var(--ok)',          bg: 'var(--ok-soft)' },
  negado:   { rotulo: 'Negado',   glifo: '✕', cor: 'var(--danger)',      bg: 'var(--danger-soft)' },
  parcial:  { rotulo: 'Parcial',  glifo: '◐', cor: 'var(--warn)',        bg: 'var(--warn-soft)' },
};

// ── Componente ─────────────────────────────────────────────────────────────

export function ConveniosRecursos(p: ConveniosRecursosProps) {
  const [dados, setDados] = useState<RecursosDados | null>(null);
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());

  useEffect(() => {
    void p.carregarDados().then(setDados);
  }, [p]);

  function alternarExpandir(id: string): void {
    setExpandidos((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  if (dados === null) return null;

  return (
    <div style={{ display: 'grid', gap: 'var(--s-6)' }}>
      <h3 style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)', margin: 0 }}>
        Recursos
      </h3>

      <section aria-label="Lista de recursos de glosa">
        <ul style={{ listStyle: 'none', margin: 0, padding: 0,
                     border: 'var(--border)', borderRadius: 'var(--r-md)',
                     overflow: 'hidden', background: 'var(--surface)' }}>
          {dados.recursos.map((rec) => {
            const chip = STATUS_CHIP[rec.status];
            const expandido = expandidos.has(rec.id);

            return (
              <li key={rec.id} style={{ borderBottom: 'var(--border)' }}>
                {/* Cabecalho do recurso */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'auto 1fr auto auto',
                  alignItems: 'center', gap: 'var(--s-4)',
                  padding: 'var(--s-5) var(--s-5)', minHeight: 56,
                }}>
                  {/* Expandir */}
                  <button
                    type="button"
                    onClick={() => alternarExpandir(rec.id)}
                    aria-expanded={expandido}
                    aria-label="Expandir"
                    style={{
                      border: 0, background: 'transparent', cursor: 'pointer',
                      fontSize: 'var(--fs-14)', color: 'var(--text-muted)',
                      width: 24, height: 24, display: 'flex', alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {expandido ? '▾' : '▸'}
                  </button>

                  {/* Info do recurso */}
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-3)' }}>
                      <span style={{ fontWeight: 'var(--fw-medium)', fontSize: 'var(--fs-14)' }}>
                        {rec.operadoraNome}
                      </span>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 'var(--s-2)',
                        fontSize: 'var(--fs-11)', textTransform: 'uppercase', letterSpacing: '.04em',
                        fontWeight: 'var(--fw-medium)', padding: 'var(--s-1) var(--s-4)',
                        borderRadius: 'var(--r-full)',
                        color: chip.cor, background: chip.bg,
                      }}>
                        <span aria-hidden="true">{chip.glifo}</span>{chip.rotulo}
                      </span>
                    </div>
                    <span style={{ display: 'block', fontSize: 'var(--fs-12)',
                                   color: 'var(--text-muted)' }}>
                      {rec.itens.length} glosa(s) — Criado em {rec.criadoEm}
                      {rec.enviadoEm !== null ? ` — Enviado em ${rec.enviadoEm}` : ''}
                    </span>
                  </div>

                  {/* Valor total */}
                  <span className="num" style={{
                    fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)',
                    fontVariantNumeric: 'tabular-nums', color: 'var(--danger)',
                  }}>
                    {centavosParaReais(rec.totalGlosasCentavos)}
                  </span>

                  {/* Acoes */}
                  <div style={{ display: 'flex', gap: 'var(--s-2)' }}>
                    {rec.status === 'rascunho' ? (
                      <>
                        <Botao variante="secundario" altura={28}
                          onClick={() => { p.aoEditar(rec.id); }}>
                          Editar
                        </Botao>
                        <Botao variante="primario" altura={28}
                          onClick={() => { void p.aoEnviar(rec.id); }}>
                          Enviar
                        </Botao>
                      </>
                    ) : null}
                    {rec.status === 'enviado' || rec.status === 'aceito'
                      || rec.status === 'negado' || rec.status === 'parcial' ? (
                      <Botao variante="secundario" altura={28}
                        onClick={() => { p.aoVerResultado(rec.id); }}>
                        Ver resultado
                      </Botao>
                    ) : null}
                  </div>
                </div>

                {/* Itens expandidos */}
                {expandido && rec.itens.length > 0 ? (
                  <div style={{ padding: '0 var(--s-5) var(--s-5)',
                                paddingInlineStart: 'calc(var(--s-5) + 24px + var(--s-4))' }}>
                    <ul style={{ listStyle: 'none', margin: 0, padding: 0,
                                 border: 'var(--border)', borderRadius: 'var(--r-sm)',
                                 overflow: 'hidden', background: 'var(--surface-sunken)' }}>
                      {rec.itens.map((item) => (
                        <li key={item.id} style={{
                          padding: 'var(--s-4) var(--s-4)',
                          borderBottom: 'var(--border)',
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-3)',
                                        marginBottom: 'var(--s-2)' }}>
                            <span className="num" style={{
                              fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums',
                              color: 'var(--text-muted)', fontSize: 'var(--fs-13)',
                            }}>
                              {item.guiaNumero}
                            </span>
                            <span style={{ fontSize: 'var(--fs-13)', fontWeight: 'var(--fw-medium)' }}>
                              {item.pacienteNome}
                            </span>
                            <span className="num" style={{
                              fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-12)',
                              color: 'var(--text-muted)',
                            }}>
                              {item.codigoGlosa}
                            </span>
                            <span className="num" style={{
                              fontSize: 'var(--fs-13)', fontWeight: 'var(--fw-medium)',
                              fontVariantNumeric: 'tabular-nums', color: 'var(--danger)',
                              marginInlineStart: 'auto',
                            }}>
                              {centavosParaReais(item.valorGlosadoCentavos)}
                            </span>
                          </div>
                          <p style={{ fontSize: 'var(--fs-12)', color: 'var(--text-muted)',
                                      margin: 0, lineHeight: 1.5 }}>
                            {item.justificativa}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
```

- [ ] Executar o teste e confirmar que passa:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run apps/web/src/telas/ConveniosRecursos.test.tsx 2>&1 | tail -3
# Esperado: Tests  7 passed
```

- [ ] Commitar:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
git add apps/web/src/telas/ConveniosRecursos.tsx apps/web/src/telas/ConveniosRecursos.test.tsx
git commit -m "feat(web): add ConveniosRecursos component with expandable recurso items

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 40: Componente DetalheDemonstrativo — painel lateral com itens e valores lado a lado

**Arquivos**

- Criar `apps/web/src/telas/DetalheDemonstrativo.tsx`
- Criar `apps/web/src/telas/DetalheDemonstrativo.test.tsx`

**Por que**: Design §5.3 define painel lateral com itens do demonstrativo, valores lado a lado (apresentado vs processado vs liberado vs glosado) e destaque para itens com glosa. E o detalhe que permite a gestora entender item a item o que a operadora processou.

- [ ] Criar o arquivo de teste `apps/web/src/telas/DetalheDemonstrativo.test.tsx`:

```tsx
// apps/web/src/telas/DetalheDemonstrativo.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import {
  DetalheDemonstrativo,
  type ItemDemonstrativo,
} from './DetalheDemonstrativo';

const ITENS: readonly ItemDemonstrativo[] = [
  {
    id: 'it1',
    guiaNumero: '000001',
    pacienteNome: 'Carlos Melo',
    codigoProcedimento: '10101012',
    nomeProcedimento: 'Consulta em consultorio',
    apresentadoCentavos: 15000,
    processadoCentavos: 15000,
    liberadoCentavos: 15000,
    glosadoCentavos: 0,
    codigoGlosa: null,
    descricaoGlosa: null,
  },
  {
    id: 'it2',
    guiaNumero: '000002',
    pacienteNome: 'Ana Silva',
    codigoProcedimento: '10101012',
    nomeProcedimento: 'Consulta em consultorio',
    apresentadoCentavos: 15000,
    processadoCentavos: 15000,
    liberadoCentavos: 7000,
    glosadoCentavos: 8000,
    codigoGlosa: '1015',
    descricaoGlosa: 'Fora do prazo',
  },
  {
    id: 'it3',
    guiaNumero: '000003',
    pacienteNome: 'Jose Santos',
    codigoProcedimento: '10101012',
    nomeProcedimento: 'Consulta em consultorio',
    apresentadoCentavos: 15000,
    processadoCentavos: 0,
    liberadoCentavos: 0,
    glosadoCentavos: 15000,
    codigoGlosa: '1005',
    descricaoGlosa: 'Procedimento nao autorizado',
  },
];

function montar() {
  const aoFechar = vi.fn();

  render(
    <DetalheDemonstrativo
      aberto
      titulo="Demonstrativo PROT-001"
      itens={ITENS}
      aoFechar={aoFechar}
    />,
  );
  return { aoFechar };
}

describe('DetalheDemonstrativo', () => {
  it('renderiza titulo do demonstrativo no painel lateral', () => {
    montar();
    expect(screen.getByText('Demonstrativo PROT-001')).toBeVisible();
  });

  it('renderiza todos os itens com guia e paciente', () => {
    montar();
    expect(screen.getByText('000001')).toBeVisible();
    expect(screen.getByText('Carlos Melo')).toBeVisible();
    expect(screen.getByText('000002')).toBeVisible();
    expect(screen.getByText('Ana Silva')).toBeVisible();
    expect(screen.getByText('000003')).toBeVisible();
    expect(screen.getByText('Jose Santos')).toBeVisible();
  });

  it('exibe valores lado a lado: apresentado, processado, liberado, glosado', () => {
    montar();
    // Cabecalho da tabela
    expect(screen.getByText(/Apresentado/i)).toBeVisible();
    expect(screen.getByText(/Processado/i)).toBeVisible();
    expect(screen.getByText(/Liberado/i)).toBeVisible();
    expect(screen.getByText(/Glosado/i)).toBeVisible();
  });

  it('destaca item com glosa mostrando codigo e descricao', () => {
    montar();
    expect(screen.getByText('1015')).toBeVisible();
    expect(screen.getByText(/Fora do prazo/)).toBeVisible();
    expect(screen.getByText('1005')).toBeVisible();
    expect(screen.getByText(/Procedimento nao autorizado/)).toBeVisible();
  });

  it('nao renderiza nada quando fechado', () => {
    render(
      <DetalheDemonstrativo
        aberto={false}
        titulo="Test"
        itens={ITENS}
        aoFechar={() => {}}
      />,
    );
    expect(screen.queryByText('000001')).toBeNull();
  });

  it('ao clicar no fundo escurecido chama aoFechar', async () => {
    const { aoFechar } = montar();
    await userEvent.click(screen.getByTestId('fundo-escurecido'));
    expect(aoFechar).toHaveBeenCalled();
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <DetalheDemonstrativo
        aberto
        titulo="Demonstrativo PROT-001"
        itens={ITENS}
        aoFechar={() => {}}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Executar o teste e confirmar que falha:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run apps/web/src/telas/DetalheDemonstrativo.test.tsx 2>&1 | tail -5
# Esperado: FAIL — Cannot find module './DetalheDemonstrativo'
```

- [ ] Criar o componente `apps/web/src/telas/DetalheDemonstrativo.tsx`:

```tsx
// apps/web/src/telas/DetalheDemonstrativo.tsx
'use client';

import { PainelLateral } from '../ui/PainelLateral';

// ── Tipos ──────────────────────────────────────────────────────────────────

export interface ItemDemonstrativo {
  readonly id: string;
  readonly guiaNumero: string;
  readonly pacienteNome: string;
  readonly codigoProcedimento: string;
  readonly nomeProcedimento: string;
  readonly apresentadoCentavos: number;
  readonly processadoCentavos: number;
  readonly liberadoCentavos: number;
  readonly glosadoCentavos: number;
  readonly codigoGlosa: string | null;
  readonly descricaoGlosa: string | null;
}

export interface DetalheDemonstrativoProps {
  readonly aberto: boolean;
  readonly titulo: string;
  readonly itens: readonly ItemDemonstrativo[];
  readonly aoFechar: () => void;
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

export function DetalheDemonstrativo({ aberto, titulo, itens, aoFechar }: DetalheDemonstrativoProps) {
  return (
    <PainelLateral aberto={aberto} titulo={titulo} aoFechar={aoFechar}>
      <div style={{ marginTop: 'var(--s-4)', overflowX: 'auto' }}>
        <table style={{
          width: '100%', borderCollapse: 'collapse',
          fontSize: 'var(--fs-12)',
        }}>
          <thead>
            <tr style={{ borderBottom: 'var(--border)' }}>
              <th style={{ textAlign: 'left', padding: 'var(--s-2) var(--s-3)',
                           fontWeight: 'var(--fw-medium)', color: 'var(--text-muted)' }}>
                Guia
              </th>
              <th style={{ textAlign: 'right', padding: 'var(--s-2) var(--s-3)',
                           fontWeight: 'var(--fw-medium)', color: 'var(--text-muted)' }}>
                Apresentado
              </th>
              <th style={{ textAlign: 'right', padding: 'var(--s-2) var(--s-3)',
                           fontWeight: 'var(--fw-medium)', color: 'var(--text-muted)' }}>
                Processado
              </th>
              <th style={{ textAlign: 'right', padding: 'var(--s-2) var(--s-3)',
                           fontWeight: 'var(--fw-medium)', color: 'var(--text-muted)' }}>
                Liberado
              </th>
              <th style={{ textAlign: 'right', padding: 'var(--s-2) var(--s-3)',
                           fontWeight: 'var(--fw-medium)', color: 'var(--text-muted)' }}>
                Glosado
              </th>
            </tr>
          </thead>
          <tbody>
            {itens.map((item) => {
              const temGlosa = item.glosadoCentavos > 0;
              return (
                <tr key={item.id} style={{
                  borderBottom: 'var(--border)',
                  background: temGlosa ? 'var(--danger-soft)' : 'transparent',
                }}>
                  <td style={{ padding: 'var(--s-3)', verticalAlign: 'top' }}>
                    <div>
                      <span className="num" style={{
                        fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums',
                        color: 'var(--text-muted)',
                      }}>
                        {item.guiaNumero}
                      </span>
                      {' '}
                      <span style={{ fontWeight: 'var(--fw-medium)' }}>
                        {item.pacienteNome}
                      </span>
                    </div>
                    <div style={{ fontSize: 'var(--fs-11)', color: 'var(--text-muted)' }}>
                      {item.nomeProcedimento}
                    </div>
                    {temGlosa && item.codigoGlosa !== null ? (
                      <div style={{ fontSize: 'var(--fs-11)', color: 'var(--danger)',
                                    marginTop: 'var(--s-1)' }}>
                        <span className="num" style={{ fontFamily: 'var(--font-mono)' }}>
                          {item.codigoGlosa}
                        </span>
                        {' '}
                        {item.descricaoGlosa}
                      </div>
                    ) : null}
                  </td>
                  <td className="num" style={{
                    textAlign: 'right', padding: 'var(--s-3)',
                    fontVariantNumeric: 'tabular-nums', verticalAlign: 'top',
                  }}>
                    {centavosParaReais(item.apresentadoCentavos)}
                  </td>
                  <td className="num" style={{
                    textAlign: 'right', padding: 'var(--s-3)',
                    fontVariantNumeric: 'tabular-nums', verticalAlign: 'top',
                  }}>
                    {centavosParaReais(item.processadoCentavos)}
                  </td>
                  <td className="num" style={{
                    textAlign: 'right', padding: 'var(--s-3)',
                    fontVariantNumeric: 'tabular-nums', verticalAlign: 'top',
                  }}>
                    {centavosParaReais(item.liberadoCentavos)}
                  </td>
                  <td className="num" style={{
                    textAlign: 'right', padding: 'var(--s-3)',
                    fontVariantNumeric: 'tabular-nums', verticalAlign: 'top',
                    color: temGlosa ? 'var(--danger)' : 'var(--text)',
                    fontWeight: temGlosa ? 'var(--fw-medium)' : 'var(--fw-regular)',
                  }}>
                    {centavosParaReais(item.glosadoCentavos)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </PainelLateral>
  );
}
```

- [ ] Executar o teste e confirmar que passa:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run apps/web/src/telas/DetalheDemonstrativo.test.tsx 2>&1 | tail -3
# Esperado: Tests  7 passed
```

- [ ] Commitar:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
git add apps/web/src/telas/DetalheDemonstrativo.tsx apps/web/src/telas/DetalheDemonstrativo.test.tsx
git commit -m "feat(web): add DetalheDemonstrativo side panel with item-level value comparison

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 41: Componente FormRecursoGlosa — wizard 2 passos para recurso de glosa

**Arquivos**

- Criar `apps/web/src/telas/FormRecursoGlosa.tsx`
- Criar `apps/web/src/telas/FormRecursoGlosa.test.tsx`

**Por que**: Design §5.3 define wizard de 2 passos: (1) selecionar glosas e preencher justificativa individual; (2) justificativa geral + revisar + submeter. O recurso de glosa e o ponto onde a clinica recupera receita, e a justificativa individual e o conteudo que vai no XML TISS.

- [ ] Criar o arquivo de teste `apps/web/src/telas/FormRecursoGlosa.test.tsx`:

```tsx
// apps/web/src/telas/FormRecursoGlosa.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import {
  FormRecursoGlosa,
  type GlosaParaRecurso,
} from './FormRecursoGlosa';

const GLOSAS: readonly GlosaParaRecurso[] = [
  {
    id: 'gl1',
    guiaNumero: '000001',
    pacienteNome: 'Carlos Melo',
    codigoGlosa: '1005',
    descricaoGlosa: 'Procedimento nao autorizado',
    valorGlosadoCentavos: 15000,
  },
  {
    id: 'gl2',
    guiaNumero: '000002',
    pacienteNome: 'Ana Silva',
    codigoGlosa: '1015',
    descricaoGlosa: 'Fora do prazo',
    valorGlosadoCentavos: 8000,
  },
];

function montar() {
  const aoSubmeter = vi.fn<(dados: {
    glosas: { glosaId: string; justificativa: string }[];
    justificativaGeral: string;
  }) => Promise<void>>().mockResolvedValue(undefined);
  const aoCancelar = vi.fn();

  render(
    <FormRecursoGlosa
      glosas={GLOSAS}
      aoSubmeter={aoSubmeter}
      aoCancelar={aoCancelar}
    />,
  );
  return { aoSubmeter, aoCancelar };
}

describe('FormRecursoGlosa', () => {
  it('passo 1: mostra lista de glosas com campo de justificativa individual', () => {
    montar();
    expect(screen.getByText(/Passo 1/i)).toBeVisible();
    expect(screen.getByText('000001')).toBeVisible();
    expect(screen.getByText('Carlos Melo')).toBeVisible();
    expect(screen.getByText('000002')).toBeVisible();
    expect(screen.getByText('Ana Silva')).toBeVisible();
    const campos = screen.getAllByLabelText(/Justificativa/i);
    expect(campos).toHaveLength(2);
  });

  it('passo 1: botao Proximo desabilitado se justificativas estao vazias', () => {
    montar();
    const proximo = screen.getByRole('button', { name: /Proximo/i });
    expect(proximo).toBeDisabled();
  });

  it('passo 1: botao Proximo habilitado apos preencher todas as justificativas', async () => {
    montar();
    const campos = screen.getAllByLabelText(/Justificativa/i);
    await userEvent.type(campos[0]!, 'Procedimento estava devidamente autorizado.');
    await userEvent.type(campos[1]!, 'Envio realizado dentro do prazo contratual.');
    const proximo = screen.getByRole('button', { name: /Proximo/i });
    expect(proximo).toBeEnabled();
  });

  it('passo 2: mostra campo de justificativa geral e resumo', async () => {
    montar();
    const campos = screen.getAllByLabelText(/Justificativa/i);
    await userEvent.type(campos[0]!, 'Autorizado.');
    await userEvent.type(campos[1]!, 'Dentro do prazo.');
    await userEvent.click(screen.getByRole('button', { name: /Proximo/i }));
    expect(screen.getByText(/Passo 2/i)).toBeVisible();
    expect(screen.getByLabelText(/Justificativa geral/i)).toBeVisible();
    expect(screen.getByText(/2 glosa/i)).toBeVisible();
    expect(screen.getByText('R$ 230,00')).toBeVisible();
  });

  it('passo 2: botao Submeter chama aoSubmeter com dados corretos', async () => {
    const { aoSubmeter } = montar();
    const campos = screen.getAllByLabelText(/Justificativa/i);
    await userEvent.type(campos[0]!, 'Autorizado.');
    await userEvent.type(campos[1]!, 'Dentro do prazo.');
    await userEvent.click(screen.getByRole('button', { name: /Proximo/i }));
    const geral = screen.getByLabelText(/Justificativa geral/i);
    await userEvent.type(geral, 'Recurso fundamentado conforme protocolo.');
    await userEvent.click(screen.getByRole('button', { name: /Submeter/i }));
    await waitFor(() => {
      expect(aoSubmeter).toHaveBeenCalledWith({
        glosas: [
          { glosaId: 'gl1', justificativa: 'Autorizado.' },
          { glosaId: 'gl2', justificativa: 'Dentro do prazo.' },
        ],
        justificativaGeral: 'Recurso fundamentado conforme protocolo.',
      });
    });
  });

  it('passo 2: botao Voltar retorna ao passo 1', async () => {
    montar();
    const campos = screen.getAllByLabelText(/Justificativa/i);
    await userEvent.type(campos[0]!, 'Autorizado.');
    await userEvent.type(campos[1]!, 'Dentro do prazo.');
    await userEvent.click(screen.getByRole('button', { name: /Proximo/i }));
    expect(screen.getByText(/Passo 2/i)).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: /Voltar/i }));
    expect(screen.getByText(/Passo 1/i)).toBeVisible();
  });

  it('botao Cancelar chama aoCancelar', async () => {
    const { aoCancelar } = montar();
    await userEvent.click(screen.getByRole('button', { name: /Cancelar/i }));
    expect(aoCancelar).toHaveBeenCalled();
  });

  it('sem violacao de acessibilidade no passo 1', async () => {
    const { container } = render(
      <FormRecursoGlosa
        glosas={GLOSAS}
        aoSubmeter={async () => {}}
        aoCancelar={() => {}}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Executar o teste e confirmar que falha:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run apps/web/src/telas/FormRecursoGlosa.test.tsx 2>&1 | tail -5
# Esperado: FAIL — Cannot find module './FormRecursoGlosa'
```

- [ ] Criar o componente `apps/web/src/telas/FormRecursoGlosa.tsx`:

```tsx
// apps/web/src/telas/FormRecursoGlosa.tsx
'use client';

import { useState } from 'react';
import { Botao } from '../ui/Botao';

// ── Tipos ──────────────────────────────────────────────────────────────────

export interface GlosaParaRecurso {
  readonly id: string;
  readonly guiaNumero: string;
  readonly pacienteNome: string;
  readonly codigoGlosa: string;
  readonly descricaoGlosa: string;
  readonly valorGlosadoCentavos: number;
}

export interface DadosRecurso {
  readonly glosas: { glosaId: string; justificativa: string }[];
  readonly justificativaGeral: string;
}

export interface FormRecursoGlosaProps {
  readonly glosas: readonly GlosaParaRecurso[];
  readonly aoSubmeter: (dados: DadosRecurso) => Promise<void>;
  readonly aoCancelar: () => void;
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

export function FormRecursoGlosa(p: FormRecursoGlosaProps) {
  const [passo, setPasso] = useState<1 | 2>(1);
  const [justificativas, setJustificativas] = useState<Record<string, string>>(
    () => Object.fromEntries(p.glosas.map((g) => [g.id, ''])),
  );
  const [justificativaGeral, setJustificativaGeral] = useState('');
  const [submetendo, setSubmetendo] = useState(false);

  const todasPreenchidas = p.glosas.every(
    (g) => (justificativas[g.id] ?? '').trim().length > 0,
  );

  const totalCentavos = p.glosas.reduce((s, g) => s + g.valorGlosadoCentavos, 0);

  function atualizarJustificativa(glosaId: string, valor: string): void {
    setJustificativas((prev) => ({ ...prev, [glosaId]: valor }));
  }

  function submeter(): void {
    setSubmetendo(true);
    void p.aoSubmeter({
      glosas: p.glosas.map((g) => ({
        glosaId: g.id,
        justificativa: (justificativas[g.id] ?? '').trim(),
      })),
      justificativaGeral: justificativaGeral.trim(),
    }).finally(() => setSubmetendo(false));
  }

  if (passo === 1) {
    return (
      <div style={{ display: 'grid', gap: 'var(--s-6)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)', margin: 0 }}>
            Passo 1 de 2 — Justificativas individuais
          </h3>
        </div>

        <ul style={{ listStyle: 'none', margin: 0, padding: 0,
                     display: 'grid', gap: 'var(--s-5)' }}>
          {p.glosas.map((g) => (
            <li key={g.id} style={{
              border: 'var(--border)', borderRadius: 'var(--r-md)',
              padding: 'var(--s-5)', background: 'var(--surface)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-3)',
                            marginBottom: 'var(--s-3)' }}>
                <span className="num" style={{
                  fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums',
                  color: 'var(--text-muted)', fontSize: 'var(--fs-13)',
                }}>
                  {g.guiaNumero}
                </span>
                <span style={{ fontWeight: 'var(--fw-medium)', fontSize: 'var(--fs-14)' }}>
                  {g.pacienteNome}
                </span>
                <span className="num" style={{
                  fontSize: 'var(--fs-13)', fontVariantNumeric: 'tabular-nums',
                  color: 'var(--danger)', marginInlineStart: 'auto',
                }}>
                  {centavosParaReais(g.valorGlosadoCentavos)}
                </span>
              </div>
              <div style={{ fontSize: 'var(--fs-12)', color: 'var(--text-muted)',
                            marginBottom: 'var(--s-3)' }}>
                <span className="num" style={{ fontFamily: 'var(--font-mono)' }}>{g.codigoGlosa}</span>
                {' '}{g.descricaoGlosa}
              </div>
              <div style={{ display: 'grid', gap: 'var(--s-2)' }}>
                <label htmlFor={`just-${g.id}`} style={{
                  fontSize: 'var(--fs-12)', fontWeight: 'var(--fw-medium)',
                  lineHeight: 1.3, color: 'var(--text-muted)',
                }}>
                  Justificativa
                </label>
                <textarea
                  id={`just-${g.id}`}
                  aria-label="Justificativa"
                  value={justificativas[g.id] ?? ''}
                  onChange={(e) => atualizarJustificativa(g.id, e.target.value)}
                  rows={3}
                  style={{
                    padding: 'var(--s-3) var(--s-4)',
                    border: 'var(--border)', borderRadius: 'var(--r-md)',
                    background: 'var(--surface)', color: 'var(--text)',
                    fontSize: 'var(--fs-14)', fontFamily: 'var(--font-ui)',
                    resize: 'vertical',
                  }}
                />
              </div>
            </li>
          ))}
        </ul>

        <div style={{ display: 'flex', gap: 'var(--s-3)', justifyContent: 'flex-end' }}>
          <Botao variante="fantasma" altura={32} onClick={p.aoCancelar}>
            Cancelar
          </Botao>
          <Botao variante="primario" altura={32}
            disabled={!todasPreenchidas}
            onClick={() => setPasso(2)}>
            Proximo
          </Botao>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--s-6)' }}>
      <h3 style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)', margin: 0 }}>
        Passo 2 de 2 — Revisar e submeter
      </h3>

      {/* Resumo */}
      <div style={{
        border: 'var(--border)', borderRadius: 'var(--r-md)',
        padding: 'var(--s-5)', background: 'var(--surface)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-4)' }}>
          <span style={{ fontSize: 'var(--fs-14)', fontWeight: 'var(--fw-medium)' }}>
            {p.glosas.length} glosa(s)
          </span>
          <span className="num" style={{
            fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)',
            fontVariantNumeric: 'tabular-nums', color: 'var(--danger)',
          }}>
            {centavosParaReais(totalCentavos)}
          </span>
        </div>
      </div>

      {/* Justificativa geral */}
      <div style={{ display: 'grid', gap: 'var(--s-2)' }}>
        <label htmlFor="justificativa-geral" style={{
          fontSize: 'var(--fs-12)', fontWeight: 'var(--fw-medium)',
          lineHeight: 1.3, color: 'var(--text-muted)',
        }}>
          Justificativa geral
        </label>
        <textarea
          id="justificativa-geral"
          aria-label="Justificativa geral"
          value={justificativaGeral}
          onChange={(e) => setJustificativaGeral(e.target.value)}
          rows={4}
          style={{
            padding: 'var(--s-3) var(--s-4)',
            border: 'var(--border)', borderRadius: 'var(--r-md)',
            background: 'var(--surface)', color: 'var(--text)',
            fontSize: 'var(--fs-14)', fontFamily: 'var(--font-ui)',
            resize: 'vertical',
          }}
        />
      </div>

      {/* Lista resumida das glosas com justificativas */}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0,
                   border: 'var(--border)', borderRadius: 'var(--r-md)',
                   overflow: 'hidden', background: 'var(--surface-sunken)' }}>
        {p.glosas.map((g) => (
          <li key={g.id} style={{
            padding: 'var(--s-3) var(--s-4)',
            borderBottom: 'var(--border)', fontSize: 'var(--fs-12)',
          }}>
            <div style={{ display: 'flex', gap: 'var(--s-3)', alignItems: 'center' }}>
              <span className="num" style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                {g.guiaNumero}
              </span>
              <span>{g.pacienteNome}</span>
              <span className="num" style={{
                fontVariantNumeric: 'tabular-nums', color: 'var(--danger)',
                marginInlineStart: 'auto',
              }}>
                {centavosParaReais(g.valorGlosadoCentavos)}
              </span>
            </div>
            <p style={{ fontSize: 'var(--fs-11)', color: 'var(--text-muted)',
                        margin: 'var(--s-1) 0 0', lineHeight: 1.4 }}>
              {justificativas[g.id]}
            </p>
          </li>
        ))}
      </ul>

      <div style={{ display: 'flex', gap: 'var(--s-3)', justifyContent: 'flex-end' }}>
        <Botao variante="fantasma" altura={32} onClick={p.aoCancelar}>
          Cancelar
        </Botao>
        <Botao variante="secundario" altura={32} onClick={() => setPasso(1)}>
          Voltar
        </Botao>
        <Botao variante="primario" altura={32}
          carregando={submetendo}
          onClick={submeter}>
          Submeter
        </Botao>
      </div>
    </div>
  );
}
```

- [ ] Executar o teste e confirmar que passa:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run apps/web/src/telas/FormRecursoGlosa.test.tsx 2>&1 | tail -3
# Esperado: Tests  7 passed
```

- [ ] Commitar:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
git add apps/web/src/telas/FormRecursoGlosa.tsx apps/web/src/telas/FormRecursoGlosa.test.tsx
git commit -m "feat(web): add FormRecursoGlosa wizard with 2-step justification flow

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 42: Atualizar ConveniosLayout — adicionar sub-aba Retornos e contadores de glosas

**Arquivos**

- Modificar `apps/web/src/telas/ConveniosLayout.tsx`
- Modificar `apps/web/src/telas/ConveniosLayout.test.tsx`

**Por que**: Design §5.3 define "a faturar -> lotes -> retornos e glosas" na navegacao de Convenios. A Fase 4 criou 3 sub-abas; a Fase 5 adiciona "Retornos" como quarta sub-aba e dois contadores na faixa: "Glosas pendentes" e "Recursos rascunho".

- [ ] Editar o teste `apps/web/src/telas/ConveniosLayout.test.tsx` para validar 4 sub-abas e 6 contadores:

```tsx
// apps/web/src/telas/ConveniosLayout.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import {
  ConveniosLayout,
  type SubAbaConvenios,
  type ContadoresConvenios,
} from './ConveniosLayout';

const CONTADORES: ContadoresConvenios = {
  guiasAFaturar: 14,
  lotesRascunho: 2,
  lotesEnviados: 5,
  pendencias: 3,
  glosasPendentes: 8,
  recursosRascunho: 1,
};

function montar(abaAtiva: SubAbaConvenios = 'a-faturar') {
  const aoNavegar = vi.fn();
  const aoFiltrar = vi.fn();
  render(
    <ConveniosLayout
      abaAtiva={abaAtiva}
      aoNavegar={aoNavegar}
      contadores={CONTADORES}
      aoFiltrar={aoFiltrar}
    >
      <div data-testid="conteudo-filho">Conteudo da sub-aba</div>
    </ConveniosLayout>,
  );
  return { aoNavegar, aoFiltrar };
}

describe('ConveniosLayout', () => {
  it('renderiza o titulo "Convenios"', () => {
    montar();
    expect(screen.getByRole('heading', { level: 2, name: /Convenios/ })).toBeVisible();
  });

  it('renderiza as 4 sub-abas: A faturar, Lotes, Retornos, Operadoras', () => {
    montar();
    const nav = screen.getByRole('navigation', { name: /Sub-navegacao convenios/i });
    expect(nav).toBeVisible();
    expect(screen.getByRole('link', { name: /A faturar/i })).toBeVisible();
    expect(screen.getByRole('link', { name: /Lotes/i })).toBeVisible();
    expect(screen.getByRole('link', { name: /Retornos/i })).toBeVisible();
    expect(screen.getByRole('link', { name: /Operadoras/i })).toBeVisible();
  });

  it('marca a sub-aba Retornos com aria-current="page"', () => {
    montar('retornos');
    const link = screen.getByRole('link', { name: /Retornos/i });
    expect(link).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: /A faturar/i })).not.toHaveAttribute('aria-current');
  });

  it('ao clicar em Retornos chama aoNavegar com o slug correto', async () => {
    const { aoNavegar } = montar('a-faturar');
    await userEvent.click(screen.getByRole('link', { name: /Retornos/i }));
    expect(aoNavegar).toHaveBeenCalledWith('retornos');
  });

  it('renderiza a faixa de contadores com os 6 valores', () => {
    montar();
    const grupo = screen.getByRole('group', { name: /Contadores de convenios/i });
    expect(grupo).toBeVisible();
    expect(screen.getByText('14')).toBeVisible();
    expect(screen.getByText('2')).toBeVisible();
    expect(screen.getByText('5')).toBeVisible();
    expect(screen.getByText('3')).toBeVisible();
    expect(screen.getByText('8')).toBeVisible();
    expect(screen.getByText('1')).toBeVisible();
  });

  it('rotulos dos contadores incluem glosas pendentes e recursos rascunho', () => {
    montar();
    expect(screen.getByText(/Guias a faturar/i)).toBeVisible();
    expect(screen.getByText(/Lotes rascunho/i)).toBeVisible();
    expect(screen.getByText(/Lotes enviados/i)).toBeVisible();
    expect(screen.getByText(/Pendencias/i)).toBeVisible();
    expect(screen.getByText(/Glosas pendentes/i)).toBeVisible();
    expect(screen.getByText(/Recursos rascunho/i)).toBeVisible();
  });

  it('ao clicar em um contador chama aoFiltrar com a chave correta', async () => {
    const { aoFiltrar } = montar();
    await userEvent.click(screen.getByRole('button', { name: /Glosas pendentes/i }));
    expect(aoFiltrar).toHaveBeenCalledWith('glosasPendentes');
  });

  it('renderiza o conteudo filho dentro do container', () => {
    montar();
    expect(screen.getByTestId('conteudo-filho')).toBeVisible();
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <ConveniosLayout
        abaAtiva="a-faturar"
        aoNavegar={() => {}}
        contadores={CONTADORES}
        aoFiltrar={() => {}}
      >
        <div>Conteudo</div>
      </ConveniosLayout>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Executar o teste e confirmar que falha (sub-aba Retornos e contadores novos ausentes):

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run apps/web/src/telas/ConveniosLayout.test.tsx 2>&1 | tail -5
# Esperado: FAIL — unable to find link "Retornos" / contadores novos
```

- [ ] Atualizar `apps/web/src/telas/ConveniosLayout.tsx` para adicionar sub-aba Retornos e contadores novos:

```tsx
// apps/web/src/telas/ConveniosLayout.tsx
'use client';

import type { ReactNode } from 'react';

// ── Tipos ──────────────────────────────────────────────────────────────────

export type SubAbaConvenios = 'a-faturar' | 'lotes' | 'retornos' | 'operadoras';

export interface ContadoresConvenios {
  readonly guiasAFaturar: number;
  readonly lotesRascunho: number;
  readonly lotesEnviados: number;
  readonly pendencias: number;
  readonly glosasPendentes: number;
  readonly recursosRascunho: number;
}

export type FiltroConvenios = keyof ContadoresConvenios;

interface SubAbaConfig {
  readonly slug: SubAbaConvenios;
  readonly rotulo: string;
  readonly href: string;
}

const SUB_ABAS: readonly SubAbaConfig[] = [
  { slug: 'a-faturar',  rotulo: 'A faturar',  href: '/financeiro/convenios' },
  { slug: 'lotes',      rotulo: 'Lotes',       href: '/financeiro/convenios/lotes' },
  { slug: 'retornos',   rotulo: 'Retornos',    href: '/financeiro/convenios/retornos' },
  { slug: 'operadoras', rotulo: 'Operadoras',  href: '/financeiro/convenios/operadoras' },
];

const ROTULOS_CONTADORES: Record<FiltroConvenios, string> = {
  guiasAFaturar:    'Guias a faturar',
  lotesRascunho:    'Lotes rascunho',
  lotesEnviados:    'Lotes enviados',
  pendencias:       'Pendencias',
  glosasPendentes:  'Glosas pendentes',
  recursosRascunho: 'Recursos rascunho',
};

// ── Props ──────────────────────────────────────────────────────────────────

export interface ConveniosLayoutProps {
  readonly abaAtiva: SubAbaConvenios;
  readonly aoNavegar: (aba: SubAbaConvenios) => void;
  readonly contadores: ContadoresConvenios;
  readonly aoFiltrar: (filtro: FiltroConvenios) => void;
  readonly filtroAtivo?: FiltroConvenios;
  readonly children: ReactNode;
}

// ── Componente ─────────────────────────────────────────────────────────────

export function ConveniosLayout({
  abaAtiva, aoNavegar, contadores, aoFiltrar, filtroAtivo, children,
}: ConveniosLayoutProps) {
  const chaves = Object.keys(ROTULOS_CONTADORES) as FiltroConvenios[];

  return (
    <div style={{ display: 'grid', gap: 'var(--s-6)' }}>
      <h2 style={{ fontSize: 'var(--fs-18)', fontWeight: 'var(--fw-semibold)',
                   lineHeight: 'var(--lh-tight)', margin: 0 }}>
        Convenios
      </h2>

      {/* Faixa de contadores */}
      <div
        role="group" aria-label="Contadores de convenios" aria-live="polite"
        style={{ display: 'flex', border: 'var(--border)', borderRadius: 'var(--r-md)',
                 background: 'var(--surface)', overflow: 'hidden' }}
      >
        {chaves.map((k, i) => (
          <button
            key={k} type="button" onClick={() => aoFiltrar(k)}
            aria-pressed={filtroAtivo === k}
            style={{
              flex: 1, border: 0,
              background: filtroAtivo === k ? 'var(--surface-hover)' : 'transparent',
              borderInlineStart: i === 0 ? 'none' : '1px solid var(--line)',
              padding: `var(--s-5) var(--s-4)`, cursor: 'pointer', minHeight: 44,
              display: 'grid', gap: 'var(--s-1)', justifyItems: 'start', color: 'var(--text)',
            }}
          >
            <span className="num" style={{ fontSize: '28px', fontWeight: 600, lineHeight: 1.1 }}>
              {contadores[k]}
            </span>
            <span style={{ fontSize: 'var(--fs-11)', textTransform: 'uppercase',
                           letterSpacing: '.04em', color: 'var(--text-muted)' }}>
              {ROTULOS_CONTADORES[k]}
            </span>
          </button>
        ))}
      </div>

      {/* Sub-abas */}
      <nav aria-label="Sub-navegacao convenios">
        <ul style={{ display: 'flex', gap: 'var(--s-1)', listStyle: 'none',
                     margin: 0, padding: 0, borderBottom: 'var(--border)' }}>
          {SUB_ABAS.map((aba) => {
            const ativo = aba.slug === abaAtiva;
            return (
              <li key={aba.slug}>
                <a
                  href={aba.href}
                  aria-current={ativo ? 'page' : undefined}
                  onClick={(e) => { e.preventDefault(); aoNavegar(aba.slug); }}
                  style={{
                    display: 'inline-block',
                    padding: `var(--s-4) var(--s-5)`,
                    color: ativo ? 'var(--text)' : 'var(--text-muted)',
                    fontWeight: ativo ? 'var(--fw-medium)' : 'var(--fw-regular)',
                    fontSize: 'var(--fs-14)',
                    textDecoration: 'none',
                    borderBottom: ativo
                      ? '2px solid var(--accent)'
                      : '2px solid transparent',
                    whiteSpace: 'nowrap',
                    minHeight: 24,
                  }}
                >
                  {aba.rotulo}
                </a>
              </li>
            );
          })}
        </ul>
      </nav>

      <div>{children}</div>
    </div>
  );
}
```

- [ ] Executar o teste e confirmar que passa:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run apps/web/src/telas/ConveniosLayout.test.tsx 2>&1 | tail -3
# Esperado: Tests  9 passed
```

- [ ] Commitar:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
git add apps/web/src/telas/ConveniosLayout.tsx apps/web/src/telas/ConveniosLayout.test.tsx
git commit -m "feat(web): add Retornos tab and glosa counters to ConveniosLayout

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 43: Atualizar convenios-navegacao.test para incluir fluxo Retornos

**Arquivos**

- Modificar `apps/web/src/telas/convenios-navegacao.test.tsx`

**Por que**: O teste de integracao de navegacao da Fase 4 valida a composicao FinanceiroLayout + ConveniosLayout + sub-abas. A Fase 5 precisa garantir que a sub-aba Retornos renderiza ConveniosRetornos dentro da composicao completa, e que os contadores novos aparecem.

- [ ] Atualizar o teste `apps/web/src/telas/convenios-navegacao.test.tsx`:

```tsx
// apps/web/src/telas/convenios-navegacao.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { FinanceiroLayout } from './FinanceiroLayout';
import { ConveniosLayout, type ContadoresConvenios } from './ConveniosLayout';
import { ConveniosAFaturar, type AFaturarDados } from './ConveniosAFaturar';
import { ConveniosLotes, type LotesDados } from './ConveniosLotes';
import { ConveniosOperadoras, type OperadorasDados } from './ConveniosOperadoras';
import { ConveniosRetornos, type RetornosDados } from './ConveniosRetornos';

const CONTADORES: ContadoresConvenios = {
  guiasAFaturar: 7, lotesRascunho: 1, lotesEnviados: 3, pendencias: 2,
  glosasPendentes: 4, recursosRascunho: 1,
};

const DADOS_FATURAR: AFaturarDados = {
  guias: [
    {
      id: 'g1', numeroGuia: '000001', pacienteNome: 'Carlos Melo',
      operadoraNome: 'Unimed', registroAns: '123456',
      codigoProcedimento: '10101012', nomeProcedimento: 'Consulta',
      valorCentavos: 15000, dataAtendimento: '2026-08-01', status: 'completa',
    },
  ],
  operadoras: [{ id: 'op1', nome: 'Unimed', registroAns: '123456' }],
};

const DADOS_LOTES: LotesDados = {
  lotes: [
    {
      id: 'l1', numero: 'L-001', operadoraNome: 'Unimed',
      registroAns: '123456', status: 'rascunho',
      totalGuias: 3, totalCentavos: 45000,
      criadoEm: '2026-08-05', enviadoEm: null, guias: [],
    },
  ],
};

const DADOS_OPERADORAS: OperadorasDados = {
  operadoras: [
    {
      id: 'op1', nome: 'Unimed', registroAns: '123456',
      versaoTiss: '4.01.00', cnpj: 'AB1234567890CD',
      email: null, telefone: null, ativa: true, totalPacientes: 10,
    },
  ],
};

const DADOS_RETORNOS: RetornosDados = {
  demonstrativos: [
    {
      id: 'd1', operadoraNome: 'Unimed', operadoraId: 'op1',
      registroAns: '123456', protocolo: 'PROT-001', tipo: 'analise',
      dataImportacao: '2026-08-01', periodoInicio: '2026-07-01',
      periodoFim: '2026-07-31', totalApresentadoCentavos: 500000,
      totalProcessadoCentavos: 480000, totalLiberadoCentavos: 450000,
      totalGlosadoCentavos: 30000, totalItens: 15, itensGlosados: 3,
    },
  ],
  operadoras: [{ id: 'op1', nome: 'Unimed', registroAns: '123456' }],
  totais: {
    apresentadoCentavos: 500000, processadoCentavos: 480000,
    liberadoCentavos: 450000, glosadoCentavos: 30000,
  },
};

describe('Navegacao completa: Financeiro > Convenios', () => {
  it('renderiza FinanceiroLayout com aba Convenios ativa contendo ConveniosLayout', () => {
    render(
      <FinanceiroLayout abaAtiva="convenios" aoNavegar={() => {}}>
        <ConveniosLayout
          abaAtiva="a-faturar" aoNavegar={() => {}}
          contadores={CONTADORES} aoFiltrar={() => {}}
        >
          <div data-testid="conteudo-afaturar">Fila</div>
        </ConveniosLayout>
      </FinanceiroLayout>,
    );
    expect(screen.getByRole('heading', { level: 1, name: /Financeiro/ })).toBeVisible();
    expect(screen.getByRole('link', { name: /Convenios/i })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('heading', { level: 2, name: /Convenios/ })).toBeVisible();
    expect(screen.getByText('7')).toBeVisible();
    expect(screen.getByTestId('conteudo-afaturar')).toBeVisible();
  });

  it('sub-aba A faturar renderiza lista de guias', async () => {
    render(
      <FinanceiroLayout abaAtiva="convenios" aoNavegar={() => {}}>
        <ConveniosLayout
          abaAtiva="a-faturar" aoNavegar={() => {}}
          contadores={CONTADORES} aoFiltrar={() => {}}
        >
          <ConveniosAFaturar
            carregarDados={async () => DADOS_FATURAR}
            aoCriarLote={async () => {}}
            aoAbrirGuia={() => {}}
          />
        </ConveniosLayout>
      </FinanceiroLayout>,
    );
    await waitFor(() => expect(screen.getByText('Carlos Melo')).toBeVisible());
    expect(screen.getByText('000001')).toBeVisible();
  });

  it('sub-aba Lotes renderiza lista de lotes', async () => {
    render(
      <FinanceiroLayout abaAtiva="convenios" aoNavegar={() => {}}>
        <ConveniosLayout
          abaAtiva="lotes" aoNavegar={() => {}}
          contadores={CONTADORES} aoFiltrar={() => {}}
        >
          <ConveniosLotes
            carregarDados={async () => DADOS_LOTES}
            aoEnviar={async () => {}}
            aoCancelar={async () => {}}
            aoBaixarXml={async () => {}}
          />
        </ConveniosLayout>
      </FinanceiroLayout>,
    );
    await waitFor(() => expect(screen.getByText('L-001')).toBeVisible());
    expect(screen.getByText('Rascunho')).toBeVisible();
  });

  it('sub-aba Operadoras renderiza lista de operadoras', async () => {
    render(
      <FinanceiroLayout abaAtiva="convenios" aoNavegar={() => {}}>
        <ConveniosLayout
          abaAtiva="operadoras" aoNavegar={() => {}}
          contadores={CONTADORES} aoFiltrar={() => {}}
        >
          <ConveniosOperadoras
            carregarDados={async () => DADOS_OPERADORAS}
            aoSalvar={async () => {}}
            aoDesativar={async () => {}}
          />
        </ConveniosLayout>
      </FinanceiroLayout>,
    );
    await waitFor(() => expect(screen.getByText('Unimed')).toBeVisible());
    expect(screen.getByRole('button', { name: /Nova operadora/i })).toBeVisible();
  });

  it('sub-aba Retornos renderiza lista de demonstrativos', async () => {
    render(
      <FinanceiroLayout abaAtiva="convenios" aoNavegar={() => {}}>
        <ConveniosLayout
          abaAtiva="retornos" aoNavegar={() => {}}
          contadores={CONTADORES} aoFiltrar={() => {}}
        >
          <ConveniosRetornos
            carregarDados={async () => DADOS_RETORNOS}
            aoImportarXml={async () => {}}
            aoAbrirDemonstrativo={() => {}}
          />
        </ConveniosLayout>
      </FinanceiroLayout>,
    );
    await waitFor(() => expect(screen.getByText('PROT-001')).toBeVisible());
    expect(screen.getByRole('link', { name: /Retornos/i })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('button', { name: /Importar/i })).toBeVisible();
  });

  it('contadores da faixa incluem glosas pendentes e recursos rascunho', () => {
    render(
      <FinanceiroLayout abaAtiva="convenios" aoNavegar={() => {}}>
        <ConveniosLayout
          abaAtiva="a-faturar" aoNavegar={() => {}}
          contadores={CONTADORES} aoFiltrar={() => {}}
        >
          <div>Conteudo</div>
        </ConveniosLayout>
      </FinanceiroLayout>,
    );
    expect(screen.getByText(/Glosas pendentes/i)).toBeVisible();
    expect(screen.getByText(/Recursos rascunho/i)).toBeVisible();
    expect(screen.getByText('4')).toBeVisible();
  });

  it('contadores da faixa sao botoes clicaveis', async () => {
    const aoFiltrar = vi.fn();
    render(
      <FinanceiroLayout abaAtiva="convenios" aoNavegar={() => {}}>
        <ConveniosLayout
          abaAtiva="a-faturar" aoNavegar={() => {}}
          contadores={CONTADORES} aoFiltrar={aoFiltrar}
        >
          <div>Conteudo</div>
        </ConveniosLayout>
      </FinanceiroLayout>,
    );
    await userEvent.click(screen.getByRole('button', { name: /Glosas pendentes/i }));
    expect(aoFiltrar).toHaveBeenCalledWith('glosasPendentes');
  });

  it('sem violacao de acessibilidade na composicao com Retornos', async () => {
    const { container } = render(
      <FinanceiroLayout abaAtiva="convenios" aoNavegar={() => {}}>
        <ConveniosLayout
          abaAtiva="retornos" aoNavegar={() => {}}
          contadores={CONTADORES} aoFiltrar={() => {}}
        >
          <ConveniosRetornos
            carregarDados={async () => DADOS_RETORNOS}
            aoImportarXml={async () => {}}
            aoAbrirDemonstrativo={() => {}}
          />
        </ConveniosLayout>
      </FinanceiroLayout>,
    );
    await waitFor(() => expect(screen.getByText('PROT-001')).toBeVisible());
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Executar o teste e confirmar que passa:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run apps/web/src/telas/convenios-navegacao.test.tsx 2>&1 | tail -3
# Esperado: Tests  8 passed
```

- [ ] Commitar:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
git add apps/web/src/telas/convenios-navegacao.test.tsx
git commit -m "test(web): update convenios navigation test for Retornos tab and glosa counters

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 44: Teste de integracao de composicao: Retornos + Glosas + Recursos + Detalhe + Form

**Arquivos**

- Criar `apps/web/src/telas/retornos-glosas-composicao.test.tsx`

**Por que**: Valida que os 5 componentes novos (ConveniosRetornos, ConveniosGlosas, ConveniosRecursos, DetalheDemonstrativo, FormRecursoGlosa) exportam os tipos corretos, compoem sem erro dentro do ConveniosLayout, e o fluxo completo funciona: abrir retorno -> ver glosas -> selecionar -> abrir wizard -> submeter. E o "teste de fumo" que garante que nenhuma interface mudou silenciosamente.

- [ ] Criar o arquivo de teste `apps/web/src/telas/retornos-glosas-composicao.test.tsx`:

```tsx
// apps/web/src/telas/retornos-glosas-composicao.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { ConveniosLayout, type ContadoresConvenios } from './ConveniosLayout';
import { ConveniosRetornos, type RetornosDados } from './ConveniosRetornos';
import { ConveniosGlosas, type GlosasDados } from './ConveniosGlosas';
import { ConveniosRecursos, type RecursosDados } from './ConveniosRecursos';
import { DetalheDemonstrativo, type ItemDemonstrativo } from './DetalheDemonstrativo';
import { FormRecursoGlosa, type GlosaParaRecurso } from './FormRecursoGlosa';

const CONTADORES: ContadoresConvenios = {
  guiasAFaturar: 5, lotesRascunho: 1, lotesEnviados: 2, pendencias: 1,
  glosasPendentes: 3, recursosRascunho: 0,
};

const RETORNOS: RetornosDados = {
  demonstrativos: [{
    id: 'd1', operadoraNome: 'Unimed', operadoraId: 'op1',
    registroAns: '123456', protocolo: 'PROT-100', tipo: 'analise',
    dataImportacao: '2026-08-01', periodoInicio: '2026-07-01',
    periodoFim: '2026-07-31', totalApresentadoCentavos: 200000,
    totalProcessadoCentavos: 180000, totalLiberadoCentavos: 170000,
    totalGlosadoCentavos: 10000, totalItens: 8, itensGlosados: 2,
  }],
  operadoras: [{ id: 'op1', nome: 'Unimed', registroAns: '123456' }],
  totais: { apresentadoCentavos: 200000, processadoCentavos: 180000,
            liberadoCentavos: 170000, glosadoCentavos: 10000 },
};

const GLOSAS: GlosasDados = {
  glosas: [{
    id: 'gl1', demonstrativoId: 'd1', guiaNumero: '000010',
    pacienteNome: 'Maria Lima', operadoraNome: 'Unimed', operadoraId: 'op1',
    codigoProcedimento: '10101012', nomeProcedimento: 'Consulta',
    codigoGlosa: '1005', descricaoGlosa: 'Nao autorizado',
    valorApresentadoCentavos: 15000, valorGlosadoCentavos: 15000,
    dataAtendimento: '2026-07-20', status: 'pendente',
  }],
  operadoras: [{ id: 'op1', nome: 'Unimed', registroAns: '123456' }],
  totalGlosadoPendenteCentavos: 15000,
};

const RECURSOS: RecursosDados = {
  recursos: [{
    id: 'r1', operadoraNome: 'Unimed', operadoraId: 'op1',
    status: 'rascunho', justificativaGeral: 'Recurso.',
    criadoEm: '2026-08-05', enviadoEm: null, totalGlosasCentavos: 15000,
    itens: [{
      id: 'ri1', glosaId: 'gl1', guiaNumero: '000010',
      pacienteNome: 'Maria Lima', codigoGlosa: '1005',
      valorGlosadoCentavos: 15000, justificativa: 'Autorizado.',
    }],
  }],
};

const ITENS_DETALHE: readonly ItemDemonstrativo[] = [{
  id: 'it1', guiaNumero: '000010', pacienteNome: 'Maria Lima',
  codigoProcedimento: '10101012', nomeProcedimento: 'Consulta',
  apresentadoCentavos: 15000, processadoCentavos: 15000,
  liberadoCentavos: 0, glosadoCentavos: 15000,
  codigoGlosa: '1005', descricaoGlosa: 'Nao autorizado',
}];

const GLOSAS_RECURSO: readonly GlosaParaRecurso[] = [{
  id: 'gl1', guiaNumero: '000010', pacienteNome: 'Maria Lima',
  codigoGlosa: '1005', descricaoGlosa: 'Nao autorizado',
  valorGlosadoCentavos: 15000,
}];

describe('Composicao completa: Retornos + Glosas + Recursos + Detalhe + Form', () => {
  it('ConveniosRetornos compoe dentro de ConveniosLayout com aba retornos', async () => {
    render(
      <ConveniosLayout
        abaAtiva="retornos" aoNavegar={() => {}}
        contadores={CONTADORES} aoFiltrar={() => {}}
      >
        <ConveniosRetornos
          carregarDados={async () => RETORNOS}
          aoImportarXml={async () => {}}
          aoAbrirDemonstrativo={() => {}}
        />
      </ConveniosLayout>,
    );
    await waitFor(() => expect(screen.getByText('PROT-100')).toBeVisible());
    expect(screen.getByRole('link', { name: /Retornos/i })).toHaveAttribute('aria-current', 'page');
  });

  it('ConveniosGlosas compoe dentro de ConveniosLayout', async () => {
    render(
      <ConveniosLayout
        abaAtiva="retornos" aoNavegar={() => {}}
        contadores={CONTADORES} aoFiltrar={() => {}}
      >
        <ConveniosGlosas
          carregarDados={async () => GLOSAS}
          aoCriarRecurso={() => {}}
        />
      </ConveniosLayout>,
    );
    await waitFor(() => expect(screen.getByText('000010')).toBeVisible());
    expect(screen.getByText('Maria Lima')).toBeVisible();
  });

  it('ConveniosRecursos compoe dentro de ConveniosLayout', async () => {
    render(
      <ConveniosLayout
        abaAtiva="retornos" aoNavegar={() => {}}
        contadores={CONTADORES} aoFiltrar={() => {}}
      >
        <ConveniosRecursos
          carregarDados={async () => RECURSOS}
          aoEditar={() => {}}
          aoEnviar={async () => {}}
          aoVerResultado={() => {}}
        />
      </ConveniosLayout>,
    );
    await waitFor(() => expect(screen.getByText('Unimed')).toBeVisible());
    expect(screen.getByText(/Rascunho/i)).toBeVisible();
  });

  it('DetalheDemonstrativo abre com itens do demonstrativo', () => {
    render(
      <DetalheDemonstrativo
        aberto
        titulo="Demonstrativo PROT-100"
        itens={ITENS_DETALHE}
        aoFechar={() => {}}
      />,
    );
    expect(screen.getByText('Demonstrativo PROT-100')).toBeVisible();
    expect(screen.getByText('000010')).toBeVisible();
    expect(screen.getByText('1005')).toBeVisible();
  });

  it('FormRecursoGlosa wizard completo: preencher justificativa -> proximo -> submeter', async () => {
    const aoSubmeter = vi.fn<(d: {
      glosas: { glosaId: string; justificativa: string }[];
      justificativaGeral: string;
    }) => Promise<void>>().mockResolvedValue(undefined);

    render(
      <FormRecursoGlosa
        glosas={GLOSAS_RECURSO}
        aoSubmeter={aoSubmeter}
        aoCancelar={() => {}}
      />,
    );
    expect(screen.getByText(/Passo 1/i)).toBeVisible();
    const campo = screen.getByLabelText(/Justificativa/i);
    await userEvent.type(campo, 'Procedimento devidamente autorizado.');
    await userEvent.click(screen.getByRole('button', { name: /Proximo/i }));
    expect(screen.getByText(/Passo 2/i)).toBeVisible();
    const geral = screen.getByLabelText(/Justificativa geral/i);
    await userEvent.type(geral, 'Recurso conforme protocolo.');
    await userEvent.click(screen.getByRole('button', { name: /Submeter/i }));
    await waitFor(() => {
      expect(aoSubmeter).toHaveBeenCalledWith({
        glosas: [{ glosaId: 'gl1', justificativa: 'Procedimento devidamente autorizado.' }],
        justificativaGeral: 'Recurso conforme protocolo.',
      });
    });
  });

  it('sem violacao de acessibilidade na composicao com glosas', async () => {
    const { container } = render(
      <ConveniosLayout
        abaAtiva="retornos" aoNavegar={() => {}}
        contadores={CONTADORES} aoFiltrar={() => {}}
      >
        <ConveniosGlosas
          carregarDados={async () => GLOSAS}
          aoCriarRecurso={() => {}}
        />
      </ConveniosLayout>,
    );
    await waitFor(() => expect(screen.getByText('000010')).toBeVisible());
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Executar o teste e confirmar que passa:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run apps/web/src/telas/retornos-glosas-composicao.test.tsx 2>&1 | tail -3
# Esperado: Tests  7 passed
```

- [ ] Executar todos os testes do bloco de uma vez para confirmar que nada quebrou:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run apps/web/src/telas/ConveniosRetornos.test.tsx apps/web/src/telas/ConveniosGlosas.test.tsx apps/web/src/telas/ConveniosRecursos.test.tsx apps/web/src/telas/DetalheDemonstrativo.test.tsx apps/web/src/telas/FormRecursoGlosa.test.tsx apps/web/src/telas/ConveniosLayout.test.tsx apps/web/src/telas/convenios-navegacao.test.tsx apps/web/src/telas/retornos-glosas-composicao.test.tsx 2>&1 | tail -5
# Esperado: Tests  55+ passed, 0 failed
```

- [ ] Commitar:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
git add apps/web/src/telas/retornos-glosas-composicao.test.tsx
git commit -m "test(web): add composition test for retornos, glosas, recursos, detalhe and form

Co-Authored-By: Claude <noreply@anthropic.com>"
```
