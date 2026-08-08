### Task 59: Detalhe da guia — painel lateral com campos projetados e historico de ajustes

**Arquivos**

- Criar `apps/web/src/telas/DetalheGuia.tsx`
- Criar `apps/web/src/telas/DetalheGuia.test.tsx`

**Por que**: Ao clicar em uma guia na fila "A faturar" ou em uma guia de lote, abre painel lateral com os campos projetados do atendimento (paciente, operadora, procedimento, valor, prestador) e o historico de ajustes (`guia_ajuste`). O botao "Ajustar" abre formulario com `campo_alterado` e motivo obrigatorio. Usa o PainelLateral existente da Fase 1.

- [ ] Criar o teste `apps/web/src/telas/DetalheGuia.test.tsx`:

```tsx
// apps/web/src/telas/DetalheGuia.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { DetalheGuia, type GuiaDetalhe, type AjusteGuia } from './DetalheGuia';

const AJUSTES: readonly AjusteGuia[] = [
  {
    id: 'aj1', campoAlterado: 'codigo_procedimento',
    valorAnterior: '10101012', valorNovo: '10102019',
    motivo: 'Correcao para casar com tabela da operadora',
    autorNome: 'Ana Financeiro', criadoEm: '2026-08-05 14:30',
  },
];

const GUIA: GuiaDetalhe = {
  id: 'g1', numeroGuia: '000001',
  pacienteNome: 'Maria Souza', numeroCns: '123456789012345',
  operadoraNome: 'Unimed', registroAns: '123456',
  numeroCarteira: '00112233', atendimentoRn: false,
  cnes: '1234567',
  conselhoProfissional: 'CRM', numeroConselho: '12345', ufConselho: 'SP',
  cbos: '225142',
  indicacaoAcidente: '9', regimeAtendimento: '01', tipoConsulta: '1',
  codigoTabela: '22', codigoProcedimento: '10102019',
  nomeProcedimento: 'Consulta em consultorio',
  valorCentavos: 15000, dataAtendimento: '2026-08-01',
  observacao: null,
  ajustes: AJUSTES,
};

function montar(aberto = true) {
  const props = {
    aberto,
    guia: GUIA,
    aoFechar: vi.fn(),
    aoAjustar: vi.fn(async (_input: { guiaId: string; campoAlterado: string;
      valorNovo: string; motivo: string }) => {}),
  };
  render(<DetalheGuia {...props} />);
  return props;
}

describe('DetalheGuia', () => {
  it('exibe o titulo com o numero da guia', () => {
    montar();
    expect(screen.getByRole('dialog', { name: /Guia 000001/i })).toBeVisible();
  });

  it('exibe os campos projetados: paciente, operadora, procedimento', () => {
    montar();
    expect(screen.getByText('Maria Souza')).toBeVisible();
    expect(screen.getByText('Unimed')).toBeVisible();
    expect(screen.getByText('10102019')).toBeVisible();
    expect(screen.getByText('Consulta em consultorio')).toBeVisible();
  });

  it('exibe o valor formatado em reais', () => {
    montar();
    expect(screen.getByText('R$ 150,00')).toBeVisible();
  });

  it('exibe dados do prestador: CNES, conselho, CBO', () => {
    montar();
    expect(screen.getByText('1234567')).toBeVisible();
    expect(screen.getByText(/CRM/)).toBeVisible();
    expect(screen.getByText('12345')).toBeVisible();
    expect(screen.getByText('SP')).toBeVisible();
  });

  it('exibe o historico de ajustes com campo, valores e motivo', () => {
    montar();
    const secao = screen.getByRole('region', { name: /Historico de ajustes/i });
    expect(secao).toBeVisible();
    expect(within(secao).getByText('codigo_procedimento')).toBeVisible();
    expect(within(secao).getByText('10101012')).toBeVisible();
    expect(within(secao).getByText('10102019')).toBeVisible();
    expect(within(secao).getByText(/Correcao para casar/i)).toBeVisible();
    expect(within(secao).getByText('Ana Financeiro')).toBeVisible();
  });

  it('tem botao "Ajustar" que abre formulario', async () => {
    montar();
    const botao = screen.getByRole('button', { name: /Ajustar/i });
    expect(botao).toBeVisible();
    await userEvent.click(botao);
    expect(screen.getByLabelText(/Campo alterado/i)).toBeVisible();
    expect(screen.getByLabelText(/Novo valor/i)).toBeVisible();
    expect(screen.getByLabelText(/Motivo/i)).toBeVisible();
  });

  it('ao preencher e confirmar ajuste chama aoAjustar com os dados', async () => {
    const props = montar();
    await userEvent.click(screen.getByRole('button', { name: /Ajustar/i }));
    const selectCampo = screen.getByLabelText(/Campo alterado/i);
    await userEvent.selectOptions(selectCampo, 'codigo_procedimento');
    const inputValor = screen.getByLabelText(/Novo valor/i);
    await userEvent.type(inputValor, '10101012');
    const textareaMotivo = screen.getByLabelText(/Motivo/i);
    await userEvent.type(textareaMotivo, 'Retorno ao codigo original');
    await userEvent.click(screen.getByRole('button', { name: /Confirmar ajuste/i }));
    expect(props.aoAjustar).toHaveBeenCalledWith({
      guiaId: 'g1',
      campoAlterado: 'codigo_procedimento',
      valorNovo: '10101012',
      motivo: 'Retorno ao codigo original',
    });
  });

  it('nao renderiza quando fechado', () => {
    montar(false);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <DetalheGuia
        aberto
        guia={GUIA}
        aoFechar={() => {}}
        aoAjustar={async () => {}}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Rodar o teste e confirmar que falha porque o modulo nao existe:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run apps/web/src/telas/DetalheGuia.test.tsx 2>&1 | head -20
# Esperado: FAIL — Cannot find module './DetalheGuia'
```

- [ ] Criar o componente `apps/web/src/telas/DetalheGuia.tsx`:

```tsx
// apps/web/src/telas/DetalheGuia.tsx
'use client';

import { useState } from 'react';
import { PainelLateral } from '../ui/PainelLateral';
import { Botao } from '../ui/Botao';
import { Campo } from '../ui/Campo';

// ── Tipos ──────────────────────────────────────────────────────────────────

export interface AjusteGuia {
  readonly id: string;
  readonly campoAlterado: string;
  readonly valorAnterior: string;
  readonly valorNovo: string;
  readonly motivo: string;
  readonly autorNome: string;
  readonly criadoEm: string;
}

export interface GuiaDetalhe {
  readonly id: string;
  readonly numeroGuia: string;
  readonly pacienteNome: string;
  readonly numeroCns: string;
  readonly operadoraNome: string;
  readonly registroAns: string;
  readonly numeroCarteira: string;
  readonly atendimentoRn: boolean;
  readonly cnes: string;
  readonly conselhoProfissional: string;
  readonly numeroConselho: string;
  readonly ufConselho: string;
  readonly cbos: string;
  readonly indicacaoAcidente: string;
  readonly regimeAtendimento: string;
  readonly tipoConsulta: string;
  readonly codigoTabela: string;
  readonly codigoProcedimento: string;
  readonly nomeProcedimento: string;
  readonly valorCentavos: number;
  readonly dataAtendimento: string;
  readonly observacao: string | null;
  readonly ajustes: readonly AjusteGuia[];
}

export interface AjusteInput {
  readonly guiaId: string;
  readonly campoAlterado: string;
  readonly valorNovo: string;
  readonly motivo: string;
}

export interface DetalheGuiaProps {
  readonly aberto: boolean;
  readonly guia: GuiaDetalhe;
  readonly aoFechar: () => void;
  readonly aoAjustar: (input: AjusteInput) => Promise<void>;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function centavosParaReais(centavos: number): string {
  const abs = Math.abs(centavos);
  const inteiro = Math.floor(abs / 100);
  const decimais = String(abs % 100).padStart(2, '0');
  const formatado = inteiro.toLocaleString('pt-BR');
  return `R$ ${centavos < 0 ? '-' : ''}${formatado},${decimais}`;
}

const CAMPOS_AJUSTAVEIS: readonly { value: string; label: string }[] = [
  { value: 'codigo_procedimento', label: 'Codigo do procedimento' },
  { value: 'codigo_tabela', label: 'Codigo da tabela' },
  { value: 'valor_procedimento', label: 'Valor do procedimento' },
  { value: 'tipo_consulta', label: 'Tipo de consulta' },
  { value: 'regime_atendimento', label: 'Regime de atendimento' },
  { value: 'cbos', label: 'CBOS' },
];

// ── Linhas de dados ───────────────────────────────────────────────────────

function LinhaInfo({ rotulo, valor }: { readonly rotulo: string; readonly valor: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between',
                  padding: 'var(--s-2) 0', borderBottom: 'var(--border)' }}>
      <span style={{ fontSize: 'var(--fs-12)', color: 'var(--text-muted)',
                     textTransform: 'uppercase', letterSpacing: '.04em' }}>
        {rotulo}
      </span>
      <span className="num" style={{ fontSize: 'var(--fs-14)', fontFamily: 'var(--font-mono)',
                                      fontVariantNumeric: 'tabular-nums' }}>
        {valor}
      </span>
    </div>
  );
}

// ── Componente ─────────────────────────────────────────────────────────────

export function DetalheGuia(p: DetalheGuiaProps) {
  const [ajustando, setAjustando] = useState(false);
  const [campoAlterado, setCampoAlterado] = useState('');
  const [valorNovo, setValorNovo] = useState('');
  const [motivo, setMotivo] = useState('');

  function limparAjuste(): void {
    setCampoAlterado('');
    setValorNovo('');
    setMotivo('');
    setAjustando(false);
  }

  function confirmarAjuste(): void {
    void p.aoAjustar({
      guiaId: p.guia.id,
      campoAlterado,
      valorNovo,
      motivo,
    }).then(limparAjuste);
  }

  return (
    <PainelLateral
      aberto={p.aberto}
      titulo={`Guia ${p.guia.numeroGuia}`}
      aoFechar={p.aoFechar}
    >
      <div style={{ display: 'grid', gap: 'var(--s-6)', marginTop: 'var(--s-4)' }}>
        {/* Dados do paciente */}
        <div>
          <span style={{ fontSize: 'var(--fs-12)', color: 'var(--text-muted)',
                         textTransform: 'uppercase', letterSpacing: '.04em' }}>
            Paciente
          </span>
          <p style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-medium)',
                      margin: 'var(--s-1) 0 0' }}>
            {p.guia.pacienteNome}
          </p>
        </div>

        {/* Dados da operadora */}
        <div>
          <span style={{ fontSize: 'var(--fs-12)', color: 'var(--text-muted)',
                         textTransform: 'uppercase', letterSpacing: '.04em' }}>
            Operadora
          </span>
          <p style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-medium)',
                      margin: 'var(--s-1) 0 0' }}>
            {p.guia.operadoraNome}
          </p>
        </div>

        {/* Dados estruturados */}
        <div style={{ display: 'grid', gap: 0 }}>
          <LinhaInfo rotulo="Carteira" valor={p.guia.numeroCarteira} />
          <LinhaInfo rotulo="Procedimento" valor={p.guia.codigoProcedimento} />
          <div style={{ display: 'flex', justifyContent: 'space-between',
                        padding: 'var(--s-2) 0', borderBottom: 'var(--border)' }}>
            <span style={{ fontSize: 'var(--fs-12)', color: 'var(--text-muted)',
                           textTransform: 'uppercase', letterSpacing: '.04em' }}>
              Descricao
            </span>
            <span style={{ fontSize: 'var(--fs-14)' }}>
              {p.guia.nomeProcedimento}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between',
                        padding: 'var(--s-2) 0', borderBottom: 'var(--border)' }}>
            <span style={{ fontSize: 'var(--fs-12)', color: 'var(--text-muted)',
                           textTransform: 'uppercase', letterSpacing: '.04em' }}>
              Valor
            </span>
            <span className="num" style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)',
                                            fontVariantNumeric: 'tabular-nums' }}>
              {centavosParaReais(p.guia.valorCentavos)}
            </span>
          </div>
          <LinhaInfo rotulo="Data" valor={p.guia.dataAtendimento} />
          <LinhaInfo rotulo="CNES" valor={p.guia.cnes} />
          <LinhaInfo rotulo="Conselho" valor={`${p.guia.conselhoProfissional} ${p.guia.numeroConselho} ${p.guia.ufConselho}`} />
          <LinhaInfo rotulo="CBOS" valor={p.guia.cbos} />
          <LinhaInfo rotulo="Tabela" valor={p.guia.codigoTabela} />
        </div>

        {/* Botao ajustar */}
        {!ajustando ? (
          <Botao variante="secundario" altura={32} onClick={() => setAjustando(true)}>
            Ajustar
          </Botao>
        ) : (
          <div style={{ display: 'grid', gap: 'var(--s-4)',
                        padding: 'var(--s-4)', border: 'var(--border)',
                        borderRadius: 'var(--r-md)', background: 'var(--surface-sunken)' }}>
            <div style={{ display: 'grid', gap: 'var(--s-2)' }}>
              <label htmlFor="ajuste-campo" style={{
                fontSize: 'var(--fs-12)', fontWeight: 'var(--fw-medium)',
                lineHeight: 1.3, color: 'var(--text-muted)',
              }}>
                Campo alterado
              </label>
              <select
                id="ajuste-campo" value={campoAlterado}
                onChange={(e) => setCampoAlterado(e.target.value)}
                aria-label="Campo alterado"
                style={{
                  height: 32, padding: '0 var(--s-4)',
                  border: 'var(--border)', borderRadius: 'var(--r-md)',
                  background: 'var(--surface)', color: 'var(--text)',
                  fontSize: 'var(--fs-14)',
                }}
              >
                <option value="">Selecione</option>
                {CAMPOS_AJUSTAVEIS.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
            <Campo rotulo="Novo valor" value={valorNovo}
              onChange={(e) => setValorNovo(e.target.value)}
              aria-label="Novo valor" />
            <div style={{ display: 'grid', gap: 'var(--s-2)' }}>
              <label htmlFor="ajuste-motivo" style={{
                fontSize: 'var(--fs-12)', fontWeight: 'var(--fw-medium)',
                lineHeight: 1.3, color: 'var(--text-muted)',
              }}>
                Motivo
              </label>
              <textarea
                id="ajuste-motivo" value={motivo}
                onChange={(e) => setMotivo(e.target.value)}
                aria-label="Motivo" required
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
            <div style={{ display: 'flex', gap: 'var(--s-3)' }}>
              <Botao variante="primario" altura={32} onClick={confirmarAjuste}>
                Confirmar ajuste
              </Botao>
              <Botao variante="fantasma" altura={32} onClick={limparAjuste}>
                Cancelar
              </Botao>
            </div>
          </div>
        )}

        {/* Historico de ajustes */}
        {p.guia.ajustes.length > 0 ? (
          <section aria-label="Historico de ajustes" style={{ display: 'grid', gap: 'var(--s-3)' }}>
            <h3 style={{ fontSize: 'var(--fs-13)', fontWeight: 'var(--fw-semibold)',
                         textTransform: 'uppercase', letterSpacing: '.04em',
                         color: 'var(--text-muted)', margin: 0 }}>
              Historico de ajustes
            </h3>
            <ul style={{ listStyle: 'none', margin: 0, padding: 0,
                         border: 'var(--border)', borderRadius: 'var(--r-sm)',
                         overflow: 'hidden', background: 'var(--surface-sunken)' }}>
              {p.guia.ajustes.map((aj) => (
                <li key={aj.id} style={{
                  padding: 'var(--s-3) var(--s-4)', borderBottom: 'var(--border)',
                  fontSize: 'var(--fs-13)',
                }}>
                  <div style={{ display: 'flex', gap: 'var(--s-3)', alignItems: 'baseline' }}>
                    <span className="num" style={{ fontFamily: 'var(--font-mono)',
                                                    fontVariantNumeric: 'tabular-nums',
                                                    color: 'var(--accent)' }}>
                      {aj.campoAlterado}
                    </span>
                    <span className="num" style={{ fontFamily: 'var(--font-mono)',
                                                    fontVariantNumeric: 'tabular-nums',
                                                    textDecoration: 'line-through',
                                                    color: 'var(--text-faint)' }}>
                      {aj.valorAnterior}
                    </span>
                    <span style={{ color: 'var(--text-muted)' }}>&rarr;</span>
                    <span className="num" style={{ fontFamily: 'var(--font-mono)',
                                                    fontVariantNumeric: 'tabular-nums' }}>
                      {aj.valorNovo}
                    </span>
                  </div>
                  <div style={{ color: 'var(--text-muted)', marginTop: 'var(--s-1)' }}>
                    {aj.motivo}
                  </div>
                  <div style={{ color: 'var(--text-faint)', fontSize: 'var(--fs-11)',
                                marginTop: 'var(--s-1)' }}>
                    {aj.autorNome} — {aj.criadoEm}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </PainelLateral>
  );
}
```

- [ ] Rodar o teste e confirmar que passa:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run apps/web/src/telas/DetalheGuia.test.tsx 2>&1 | tail -5
# Esperado: Tests  9 passed
```

- [ ] Commitar:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
git add apps/web/src/telas/DetalheGuia.tsx apps/web/src/telas/DetalheGuia.test.tsx
git commit -m "feat(web): add DetalheGuia panel with adjustment history"
```

---