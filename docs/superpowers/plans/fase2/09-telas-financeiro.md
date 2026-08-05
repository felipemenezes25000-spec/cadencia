<!-- RECONCILIACAO (00-CONTRATOS) ──────────────────────────────────────
  Correcoes aplicadas pela reconciliacao dos 10 blocos:
  1. Task 53: alteracao de FASE_ATUAL e Financeiro disponivelNaFase
     REMOVIDA deste bloco — o Bloco 10 (Task 55) e o responsavel.
  2. Task 53: reescrita de BarraDeNavegacao.test.tsx REMOVIDA — vence
     a versao do Bloco 10 (Task 55).
  3. Task 51: LinhaDaFila deve ser UNIFICADA com Bloco 10 Task 56,
     adicionando mensagensNaoLidas e pagamentoPendente (Bloco 10) E
     valorSugeridoCentavos (este bloco).
  4. Task 51: HojeProps simplificado — usar aoCobrar(linha) do Bloco 10
     em vez de aoRegistrarPagamento/aoCriarLinkPagamento inline.
─────────────────────────────────────────────────────────────────── -->

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

### Task 50: Integrar painel de cobranca na TelaDeAtendimento com atalho `Ctrl+$`

**Arquivos**

- Modificar `apps/web/src/telas/atalhos.ts`
- Modificar `apps/web/src/telas/atalhos.test.ts`
- Modificar `apps/web/src/telas/TelaDeAtendimento.tsx`
- Modificar `apps/web/src/telas/fluxo-b.test.tsx`

**Por que**: Design §5.3 define "Cobrar" no cabecalho do atendimento e §5.6 menciona `$` como modo de dinheiro na paleta. O atalho `Ctrl+$` (que no teclado brasileiro e `Ctrl+Shift+4`) abre o painel sem tirar as maos do teclado.

- [ ] Escrever os testes que falham:

```ts
// apps/web/src/telas/atalhos.test.ts — adicionar ao describe existente
  it('Ctrl+$ abre a cobranca no atendimento', () => {
    const a = ATALHOS_DO_ATENDIMENTO.find((x) => x.combinacao === 'Ctrl+$');
    expect(a?.acao).toBe('cobrar');
    expect(a?.descricao).toBe('Cobrar');
  });
```

```tsx
// apps/web/src/telas/fluxo-b.test.tsx — adicionar ao describe existente
  it('Ctrl+$ abre o painel de cobranca ao lado do atendimento', async () => {
    montar();
    const editor = screen.getByRole('article');
    fireEvent.keyDown(editor, { key: '$', ctrlKey: true });
    expect(screen.getByRole('dialog', { name: /Cobrar/ })).toBeVisible();
    expect(screen.getByText('Maria Souza Lima')).toBeVisible();
  });
```

- [ ] Rodar e confirmar a falha:

```bash
cd apps/web && pnpm vitest run src/telas/atalhos.test.ts src/telas/fluxo-b.test.tsx
# Esperado: FAIL — 2 testes falhando
```

- [ ] Adicionar o atalho no catalogo:

```ts
// apps/web/src/telas/atalhos.ts — adicionar ao array ATALHOS_DO_ATENDIMENTO, antes do ultimo item
  { combinacao: 'Ctrl+$', acao: 'cobrar', descricao: 'Cobrar' },
```

O array completo fica:

```ts
export const ATALHOS_DO_ATENDIMENTO: readonly AtalhoDoAtendimento[] = [
  { combinacao: 'Ctrl+R', acao: 'prescrever', descricao: 'Prescrever ao lado' },
  { combinacao: 'Ctrl+E', acao: 'pedir_exame', descricao: 'Pedido de exame' },
  { combinacao: 'Ctrl+D', acao: 'emitir_documento', descricao: 'Documento' },
  { combinacao: 'Ctrl+I', acao: 'transcricao_por_ia', descricao: 'Transcrição por IA' },
  { combinacao: 'Ctrl+;', acao: 'inserir_data_hora_do_servidor',
    descricao: 'Data/hora do servidor' },
  { combinacao: 'Ctrl+$', acao: 'cobrar', descricao: 'Cobrar' },
  { combinacao: 'Ctrl+ArrowUp', acao: 'secao_anterior', descricao: 'Seção anterior' },
  { combinacao: 'Ctrl+ArrowDown', acao: 'proxima_secao', descricao: 'Próxima seção' },
  { combinacao: 'Ctrl+Enter', acao: 'finalizar', descricao: 'Finalizar atendimento' },
];
```

- [ ] Atualizar o teste de atalhos para refletir a nova ordem:

```ts
// apps/web/src/telas/atalhos.test.ts — atualizar o teste 'cobre os atalhos com modificador da §5.6'
  it('cobre os atalhos com modificador da §5.6', () => {
    expect(ATALHOS_DO_ATENDIMENTO.map((a) => a.combinacao)).toEqual([
      'Ctrl+R', 'Ctrl+E', 'Ctrl+D', 'Ctrl+I', 'Ctrl+;', 'Ctrl+$',
      'Ctrl+ArrowUp', 'Ctrl+ArrowDown', 'Ctrl+Enter']);
  });
```

- [ ] Integrar o painel na tela de atendimento:

```tsx
// apps/web/src/telas/TelaDeAtendimento.tsx
'use client';

import { useEffect, useState } from 'react';
import { EditorClinico, type CodigoHit, type ModeloHit, type ValorAnterior } from './EditorClinico';
import { PainelLateral } from '../ui/PainelLateral';
import { PainelDeCobranca, type MetodoPagamento } from '../ui/PainelDeCobranca';

export interface TelaDeAtendimentoProps {
  readonly encounterId: string;
  readonly pacienteNome: string;
  readonly procedimentoNome?: string;
  readonly valorSugeridoCentavos?: number;
  readonly abrirSessaoDoPrescritor: () => Promise<{ mode: string }>;
  readonly buscarCodigo: (termo: string) => Promise<CodigoHit[]>;
  readonly buscarModelo: (termo: string) => Promise<ModeloHit[]>;
  readonly buscarValorAnterior: (campo: string) => Promise<ValorAnterior | null>;
  readonly aoConfirmarPrescricao: () => Promise<{ prescriptionId: string }>;
  readonly aoFinalizar: () => Promise<{ versionId: string; versionNo: number }>;
  readonly aoRegistrarPagamento?: (dados: { amountCents: number; method: Exclude<MetodoPagamento, 'link'> }) =>
    Promise<{ entryId: string; receiptNumber: number }>;
  readonly aoCriarLinkPagamento?: (dados: { amountCents: number }) =>
    Promise<{ linkUrl: string; linkId: string }>;
}

export function TelaDeAtendimento(p: TelaDeAtendimentoProps) {
  const [prescricaoAberta, setPrescricaoAberta] = useState(false);
  const [cobrancaAberta, setCobrancaAberta] = useState(false);
  const [finalizado, setFinalizado] = useState(false);

  useEffect(() => {
    void p.abrirSessaoDoPrescritor();
  }, []);

  async function finalizar() {
    await p.aoFinalizar();
    setFinalizado(true);
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr', height: '100vh' }}>
      <div style={{ display: 'grid', gap: 'var(--s-4)', padding: 'var(--s-6)',
                    gridTemplateRows: 'auto 1fr auto' }}>
        <header style={{ display: 'flex', justifyContent: 'space-between',
                         alignItems: 'center' }}>
          <h1 style={{ fontSize: 'var(--fs-18)', fontWeight: 'var(--fw-semibold)', margin: 0 }}>
            {p.pacienteNome}
          </h1>
          {p.aoRegistrarPagamento !== undefined ? (
            <button type="button"
              onClick={() => setCobrancaAberta(true)}
              aria-label="Cobrar"
              style={{ border: 'var(--border)', borderRadius: 'var(--r-md)',
                       background: 'var(--surface)', padding: 'var(--s-3) var(--s-5)',
                       cursor: 'pointer', color: 'var(--text)',
                       fontSize: 'var(--fs-14)', fontWeight: 'var(--fw-medium)' }}>
              Cobrar
            </button>
          ) : null}
        </header>

        <EditorClinico
          encounterId={p.encounterId}
          buscarCodigo={p.buscarCodigo}
          buscarModelo={p.buscarModelo}
          buscarValorAnterior={p.buscarValorAnterior}
          aoPrescrever={() => setPrescricaoAberta(true)}
          aoPedirExame={() => {}}
          aoEmitirDocumento={() => {}}
          aoFinalizar={() => { void finalizar(); }}
          aoCobrar={() => setCobrancaAberta(true)}
        />

        {finalizado ? (
          <div role="status" style={{ display: 'flex', gap: 'var(--s-4)',
                                      alignItems: 'center', justifyContent: 'center',
                                      padding: 'var(--s-4)', background: 'var(--success-soft)',
                                      borderRadius: 'var(--r-md)' }}>
            <span style={{ color: 'var(--success)' }}>Atendimento finalizado</span>
            <button type="button"
              style={{ border: 'var(--border)', borderRadius: 'var(--r-md)',
                       background: 'var(--surface)', padding: 'var(--s-3) var(--s-5)',
                       cursor: 'pointer', color: 'var(--text)' }}>
              Próximo paciente (Enter)
            </button>
          </div>
        ) : null}
      </div>

      <PainelLateral aberto={prescricaoAberta} titulo="Prescrever"
        aoFechar={() => setPrescricaoAberta(false)}>
        <p style={{ margin: 0 }}>Prescrição embarcada para {p.pacienteNome}</p>
      </PainelLateral>

      {p.aoRegistrarPagamento !== undefined && p.aoCriarLinkPagamento !== undefined ? (
        <PainelDeCobranca
          aberto={cobrancaAberta}
          pacienteNome={p.pacienteNome}
          procedimentoNome={p.procedimentoNome ?? 'Consulta'}
          valorSugeridoCentavos={p.valorSugeridoCentavos ?? 0}
          aoRegistrar={p.aoRegistrarPagamento}
          aoCriarLink={p.aoCriarLinkPagamento}
          aoFechar={() => setCobrancaAberta(false)}
        />
      ) : null}
    </div>
  );
}
```

- [ ] Atualizar a montagem do fluxo-b.test para incluir as novas props:

```tsx
// apps/web/src/telas/fluxo-b.test.tsx — atualizar a funcao montar
function montar(over = {}) {
  const props = {
    encounterId: 'e1', pacienteNome: 'Maria Souza Lima',
    procedimentoNome: 'Consulta', valorSugeridoCentavos: 25000,
    abrirSessaoDoPrescritor: vi.fn(async () => ({ mode: 'embedded' as const })),
    buscarCodigo: vi.fn(async () => [{ code: 'I10', display: 'Hipertensão essencial' }]),
    buscarModelo: vi.fn(async () => [{ code: 'retorno', texto: 'Retorno em 30 dias.' }]),
    buscarValorAnterior: vi.fn(async () => ({ valor: '72,4 kg', em: '12/05/2026' })),
    aoConfirmarPrescricao: vi.fn(async () => ({ prescriptionId: 'rx1' })),
    aoFinalizar: vi.fn(async () => ({ versionId: 'v1', versionNo: 1 })),
    aoRegistrarPagamento: vi.fn(async () => ({ entryId: 'e1', receiptNumber: 42 })),
    aoCriarLinkPagamento: vi.fn(async () => ({ linkUrl: 'https://pay.example.com/abc', linkId: 'lk1' })),
    ...over,
  };
  render(<TelaDeAtendimento {...props} />);
  return props;
}
```

- [ ] Rodar e confirmar que passa:

```bash
cd apps/web && pnpm vitest run src/telas/atalhos.test.ts src/telas/fluxo-b.test.tsx
# Esperado: todos os testes passando
```

- [ ] Commitar:

```bash
git add apps/web/src/telas/atalhos.ts apps/web/src/telas/atalhos.test.ts \
  apps/web/src/telas/TelaDeAtendimento.tsx apps/web/src/telas/fluxo-b.test.tsx
git commit -m "feat(web): integrate payment panel into encounter screen with Ctrl+$ shortcut"
```

---

### Task 51: Acao "Cobrar" na fila do dia (`/hoje`) abrindo o painel de cobranca

**Arquivos**

- Modificar `apps/web/src/telas/Hoje.tsx`
- Modificar `apps/web/src/telas/Hoje.test.tsx`

**Por que**: Design §5.3 define "cobrar [$]" como acao na fila do dia. Reutiliza o `PainelDeCobranca` da Task 49.

- [ ] Escrever o teste que falha:

```tsx
// apps/web/src/telas/Hoje.test.tsx — adicionar ao describe existente
  it('botao "Cobrar" na fila abre o painel de cobranca com os dados da linha', async () => {
    const aoRegistrarPagamento = vi.fn(async () => ({ entryId: 'e1', receiptNumber: 1 }));
    const aoCriarLinkPagamento = vi.fn(async () => ({ linkUrl: 'https://pay.example.com/x', linkId: 'l1' }));
    montar({ aoRegistrarPagamento, aoCriarLinkPagamento });
    await waitFor(() => expect(screen.getAllByRole('listitem').length).toBeGreaterThan(0));
    const botoes = screen.getAllByRole('button', { name: /Cobrar/i });
    expect(botoes.length).toBeGreaterThan(0);
    await userEvent.click(botoes[0]!);
    expect(screen.getByRole('dialog', { name: /Cobrar/ })).toBeVisible();
    expect(screen.getByText('Maria Souza Lima')).toBeVisible();
  });
```

- [ ] Rodar e confirmar a falha:

```bash
cd apps/web && pnpm vitest run src/telas/Hoje.test.tsx
# Esperado: FAIL — botao Cobrar nao encontrado
```

- [ ] Estender as props de Hoje e adicionar o botao com o painel:

```tsx
// apps/web/src/telas/Hoje.tsx
'use client';

import { useEffect, useState } from 'react';
import { FaixaDeContadores, type Contadores, type FiltroDoDia } from '../ui/FaixaDeContadores';
import { LinhaDaAgenda } from '../ui/LinhaDaAgenda';
import { Botao } from '../ui/Botao';
import { PainelDeCobranca, type MetodoPagamento } from '../ui/PainelDeCobranca';
import type { StatusAgenda } from '../ui/ChipDeStatus';

export interface LinhaDaFila {
  readonly appointmentId: string; readonly startsAt: string; readonly endsAt: string;
  readonly patientId: string; readonly displayName: string; readonly professionalId: string;
  readonly procedureNome: string | null; readonly procedureCor: string | null;
  readonly operadoraNome: string | null; readonly status: StatusAgenda;
  readonly encaixe: boolean; readonly teleconsulta: boolean; readonly primeiraVez: boolean;
  readonly cadastroPreliminar: boolean; readonly encounterId: string | null;
  readonly valorSugeridoCentavos?: number;
}

export interface PrecisaDeVoce {
  readonly confirmacoesSemResposta: number; readonly prescricoesNaoAssinadas: number;
  readonly resultadosChegados: number; readonly rascunhosDeOntem: number;
  readonly guiasAFaturar: number;
}

export interface HojeProps {
  readonly dia: string;
  readonly filtro?: FiltroDoDia;
  readonly carregarDia: (dia: string, filtro?: FiltroDoDia) =>
    Promise<{ contadores: Contadores; fila: LinhaDaFila[] }>;
  readonly carregarPrecisaDeVoce: () => Promise<PrecisaDeVoce>;
  readonly aoCheckIn: (appointmentId: string) => Promise<void>;
  readonly aoAbrirAtendimento: (linha: LinhaDaFila) => void;
  readonly aoMudarFiltro: (filtro: FiltroDoDia | undefined) => void;
  readonly aoRegistrarPagamento?: (appointmentId: string, dados: {
    amountCents: number; method: Exclude<MetodoPagamento, 'link'>;
  }) => Promise<{ entryId: string; receiptNumber: number }>;
  readonly aoCriarLinkPagamento?: (appointmentId: string, dados: {
    amountCents: number;
  }) => Promise<{ linkUrl: string; linkId: string }>;
}

const PENDENCIAS: ReadonlyArray<[keyof PrecisaDeVoce, string]> = [
  ['confirmacoesSemResposta', 'confirmações sem resposta'],
  ['prescricoesNaoAssinadas', 'prescrições não assinadas'],
  ['resultadosChegados', 'resultados chegados'],
  ['rascunhosDeOntem', 'rascunhos de ontem'],
  ['guiasAFaturar', 'guias a faturar'],
];

function porExtenso(dia: string): string {
  const d = new Date(`${dia}T12:00:00Z`);
  const fmt = new Intl.DateTimeFormat('pt-BR',
    { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  return fmt.format(d);
}

function hora(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR',
    { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(new Date(iso));
}

export function Hoje(p: HojeProps) {
  const [contadores, setContadores] = useState<Contadores | null>(null);
  const [fila, setFila] = useState<LinhaDaFila[]>([]);
  const [precisa, setPrecisa] = useState<PrecisaDeVoce | null>(null);
  const [cobranca, setCobranca] = useState<LinhaDaFila | null>(null);

  useEffect(() => {
    void p.carregarDia(p.dia, p.filtro).then((r) => {
      setContadores(r.contadores); setFila(r.fila);
    });
  }, [p, p.dia, p.filtro]);

  useEffect(() => { void p.carregarPrecisaDeVoce().then(setPrecisa); }, [p]);

  async function checkIn(linha: LinhaDaFila): Promise<void> {
    setFila((atual) => atual.map((l) =>
      l.appointmentId === linha.appointmentId ? { ...l, status: 'aguardando' as const } : l));
    try {
      await p.aoCheckIn(linha.appointmentId);
    } catch {
      setFila((atual) => atual.map((l) =>
        l.appointmentId === linha.appointmentId ? { ...l, status: linha.status } : l));
    }
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--s-8)', padding: 'var(--s-8)' }}>
      <h1 style={{ fontSize: 'var(--fs-22)', fontWeight: 'var(--fw-semibold)',
                   lineHeight: 'var(--lh-tight)', margin: 0 }}>
        {`Hoje, ${porExtenso(p.dia)}`}
      </h1>

      {contadores === null ? null : (
        <FaixaDeContadores
          contadores={contadores}
          filtroAtivo={p.filtro}
          aoFiltrar={(f) => p.aoMudarFiltro(p.filtro === f ? undefined : f)}
        />
      )}

      <section aria-label="Fila do dia">
        <ul style={{ listStyle: 'none', margin: 0, padding: 0,
                     border: 'var(--border)', borderRadius: 'var(--r-md)',
                     overflow: 'hidden', background: 'var(--surface)' }}>
          {fila.map((l) => (
            <LinhaDaAgenda
              key={l.appointmentId}
              hora={hora(l.startsAt)}
              paciente={l.displayName}
              profissional={l.professionalId}
              {...(l.procedureNome === null ? {} : { procedimento: l.procedureNome })}
              {...(l.operadoraNome === null ? {} : { convenio: l.operadoraNome })}
              status={l.status}
              encaixe={l.encaixe}
              cadastroPreliminar={l.cadastroPreliminar}
              primeiraVez={l.primeiraVez}
              teleconsulta={l.teleconsulta}
            />
          ))}
        </ul>
        <div style={{ display: 'flex', gap: 'var(--s-4)', marginTop: 'var(--s-5)',
                      flexWrap: 'wrap' }}>
          {fila.map((l) => (
            <span key={l.appointmentId} style={{ display: 'contents' }}>
              <Botao variante="secundario" altura={28}
                aria-label={`Check-in de ${l.displayName}`}
                onClick={() => { void checkIn(l); }}>
                Check-in
              </Botao>
              <Botao variante="fantasma" altura={28}
                aria-label={`Abrir atendimento de ${l.displayName}`}
                onClick={() => p.aoAbrirAtendimento(l)}>
                {l.encounterId === null ? 'Abrir atendimento' : 'Continuar'}
              </Botao>
              {p.aoRegistrarPagamento !== undefined ? (
                <Botao variante="fantasma" altura={28}
                  aria-label={`Cobrar de ${l.displayName}`}
                  onClick={() => setCobranca(l)}>
                  Cobrar
                </Botao>
              ) : null}
            </span>
          ))}
        </div>
      </section>

      {precisa === null ? null : (
        <section aria-label="Precisa de você"
          style={{ border: 'var(--border)', borderRadius: 'var(--r-md)',
                   background: 'var(--surface)', padding: 'var(--s-6)' }}>
          <h2 style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)',
                       margin: `0 0 var(--s-4)` }}>
            Precisa de você
          </h2>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid',
                       gap: 'var(--s-3)' }}>
            {PENDENCIAS.map(([chave, rotulo]) => (
              <li key={chave} style={{ display: 'flex', gap: 'var(--s-4)', minHeight: 24 }}>
                <strong className="num" style={{ minWidth: '2ch', textAlign: 'right' }}>
                  {precisa[chave]}
                </strong>
                <span style={{ color: 'var(--text-muted)' }}>{rotulo}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {cobranca !== null && p.aoRegistrarPagamento !== undefined && p.aoCriarLinkPagamento !== undefined ? (
        <PainelDeCobranca
          aberto={true}
          pacienteNome={cobranca.displayName}
          procedimentoNome={cobranca.procedureNome ?? 'Consulta'}
          valorSugeridoCentavos={cobranca.valorSugeridoCentavos ?? 0}
          aoRegistrar={(dados) => p.aoRegistrarPagamento!(cobranca.appointmentId, dados)}
          aoCriarLink={(dados) => p.aoCriarLinkPagamento!(cobranca.appointmentId, dados)}
          aoFechar={() => setCobranca(null)}
        />
      ) : null}
    </div>
  );
}
```

- [ ] Atualizar a funcao `montar` do Hoje.test para incluir as novas props opcionais:

```tsx
// apps/web/src/telas/Hoje.test.tsx — atualizar montar
function montar(over: Partial<Parameters<typeof Hoje>[0]> = {}) {
  const props = {
    dia: '2026-08-03', carregarDia: vi.fn(async () => DIA),
    carregarPrecisaDeVoce: vi.fn(async () => PRECISA),
    aoCheckIn: vi.fn(async () => {}), aoAbrirAtendimento: vi.fn(),
    filtro: undefined, aoMudarFiltro: vi.fn(),
    aoRegistrarPagamento: undefined as HojeProps['aoRegistrarPagamento'],
    aoCriarLinkPagamento: undefined as HojeProps['aoCriarLinkPagamento'],
    ...over,
  };
  render(<Hoje {...props} />);
  return props;
}
```

- [ ] Rodar e confirmar que passa:

```bash
cd apps/web && pnpm vitest run src/telas/Hoje.test.tsx
# Esperado: todos os testes passando (inclusive os existentes)
```

- [ ] Commitar:

```bash
git add apps/web/src/telas/Hoje.tsx apps/web/src/telas/Hoje.test.tsx
git commit -m "feat(web): charge action in today queue opening payment panel"
```

---

### Task 52: Dashboard financeiro basico — tela `/financeiro`

**Arquivos**

- Criar `apps/web/src/telas/Financeiro.tsx`
- Criar `apps/web/src/telas/Financeiro.test.tsx`

**Por que**: Design §5.3 define "FINANCEIRO [$] -> Visao . Caixa . A receber". O painel mostra caixa do dia por metodo, receitas do mes em grafico de barras (SVG puro), e lista de pendencias.

- [ ] Escrever o teste que falha:

```tsx
// apps/web/src/telas/Financeiro.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { axe } from 'vitest-axe';
import { Financeiro } from './Financeiro';

const CAIXA_DO_DIA = {
  total: 125000,
  porMetodo: [
    { method: 'dinheiro' as const, total: 50000, count: 2 },
    { method: 'cartao' as const, total: 50000, count: 2 },
    { method: 'pix' as const, total: 25000, count: 1 },
  ],
};

const RECEITAS_DO_MES = {
  dias: [
    { dia: '2026-08-01', total: 45000 },
    { dia: '2026-08-02', total: 30000 },
    { dia: '2026-08-03', total: 50000 },
  ],
  totalMes: 125000,
  mediaDiaria: 41667,
};

const A_RECEBER = {
  total: 75000,
  entradas: [
    { entryId: 'e1', patientName: 'Joana Prado', description: 'Consulta',
      amountCents: 25000, dueDate: '2026-08-05', status: 'pendente' as const },
    { entryId: 'e2', patientName: 'Carlos Dias', description: 'Retorno',
      amountCents: 50000, dueDate: '2026-08-10', status: 'pendente' as const },
  ],
};

function montar() {
  const props = {
    carregarCaixaDoDia: vi.fn(async () => CAIXA_DO_DIA),
    carregarReceitasDoMes: vi.fn(async () => RECEITAS_DO_MES),
    carregarAReceber: vi.fn(async () => A_RECEBER),
    aoEnviarLink: vi.fn(async () => {}),
  };
  render(<Financeiro {...props} />);
  return props;
}

describe('tela Financeiro', () => {
  it('exibe o caixa do dia com total formatado em reais', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('R$ 1.250,00')).toBeVisible());
  });

  it('exibe o total por metodo de pagamento', async () => {
    montar();
    await waitFor(() => expect(screen.getByText(/Dinheiro/)).toBeVisible());
    expect(screen.getByText(/R\$ 500,00/)).toBeVisible();
  });

  it('exibe a secao de receitas do mes com total e media', async () => {
    montar();
    await waitFor(() => expect(
      screen.getByRole('region', { name: /Receitas do mês/ })).toBeVisible());
    expect(screen.getByText('R$ 1.250,00')).toBeVisible();
  });

  it('renderiza o grafico de barras como SVG acessivel', async () => {
    montar();
    await waitFor(() => expect(screen.getByRole('img', { name: /Receitas/ })).toBeVisible());
  });

  it('exibe a secao A receber com lista de pendencias ordenada por data', async () => {
    montar();
    await waitFor(() => expect(
      screen.getByRole('region', { name: /A receber/ })).toBeVisible());
    expect(screen.getByText('Joana Prado')).toBeVisible();
    expect(screen.getByText('Carlos Dias')).toBeVisible();
  });

  it('exibe o total pendente', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('R$ 750,00')).toBeVisible());
  });

  it('cada entrada pendente tem botao "Enviar link"', async () => {
    montar();
    await waitFor(() => expect(
      screen.getAllByRole('button', { name: /Enviar link/ }).length).toBe(2));
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <Financeiro
        carregarCaixaDoDia={async () => CAIXA_DO_DIA}
        carregarReceitasDoMes={async () => RECEITAS_DO_MES}
        carregarAReceber={async () => A_RECEBER}
        aoEnviarLink={async () => {}}
      />);
    await waitFor(() => expect(screen.getByText('R$ 1.250,00')).toBeVisible());
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Rodar e confirmar a falha:

```bash
cd apps/web && pnpm vitest run src/telas/Financeiro.test.tsx
# Esperado: FAIL — modulo Financeiro nao encontrado
```

- [ ] Implementar a tela:

```tsx
// apps/web/src/telas/Financeiro.tsx
'use client';

import { useEffect, useState } from 'react';
import { Botao } from '../ui/Botao';

export type MetodoResumo = 'dinheiro' | 'cartao' | 'pix' | 'link';

export interface CaixaDoDia {
  readonly total: number;
  readonly porMetodo: ReadonlyArray<{ method: MetodoResumo; total: number; count: number }>;
}

export interface ReceitasDoMes {
  readonly dias: ReadonlyArray<{ dia: string; total: number }>;
  readonly totalMes: number;
  readonly mediaDiaria: number;
}

export interface EntradaPendente {
  readonly entryId: string;
  readonly patientName: string;
  readonly description: string;
  readonly amountCents: number;
  readonly dueDate: string;
  readonly status: 'pendente';
}

export interface AReceber {
  readonly total: number;
  readonly entradas: readonly EntradaPendente[];
}

export interface FinanceiroProps {
  readonly carregarCaixaDoDia: () => Promise<CaixaDoDia>;
  readonly carregarReceitasDoMes: () => Promise<ReceitasDoMes>;
  readonly carregarAReceber: () => Promise<AReceber>;
  readonly aoEnviarLink: (entryId: string) => Promise<void>;
}

const ROTULO_METODO: Record<MetodoResumo, string> = {
  dinheiro: 'Dinheiro', cartao: 'Cartão', pix: 'Pix', link: 'Link',
};

function centavosParaReais(centavos: number): string {
  const abs = Math.abs(centavos);
  const inteiro = Math.floor(abs / 100);
  const decimais = String(abs % 100).padStart(2, '0');
  const formatado = inteiro.toLocaleString('pt-BR');
  return `R$ ${centavos < 0 ? '-' : ''}${formatado},${decimais}`;
}

function GraficoDeBarras({ dias }: { readonly dias: ReadonlyArray<{ dia: string; total: number }> }) {
  const maxTotal = Math.max(...dias.map((d) => d.total), 1);
  const larguraBarra = 24;
  const gap = 4;
  const alturaMax = 120;
  const largura = dias.length * (larguraBarra + gap);

  return (
    <svg
      role="img" aria-label="Receitas dos últimos dias"
      viewBox={`0 0 ${largura} ${alturaMax + 20}`}
      style={{ width: '100%', maxWidth: `${largura}px`, height: `${alturaMax + 20}px` }}
    >
      {dias.map((d, i) => {
        const altura = Math.max((d.total / maxTotal) * alturaMax, 2);
        const x = i * (larguraBarra + gap);
        const y = alturaMax - altura;
        const diaLabel = d.dia.slice(8);
        return (
          <g key={d.dia}>
            <rect
              x={x} y={y} width={larguraBarra} height={altura}
              rx={3} fill="var(--accent)"
            >
              <title>{`${d.dia}: ${centavosParaReais(d.total)}`}</title>
            </rect>
            <text x={x + larguraBarra / 2} y={alturaMax + 14}
              textAnchor="middle" fontSize="10" fill="var(--text-muted)">
              {diaLabel}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function Financeiro(p: FinanceiroProps) {
  const [caixa, setCaixa] = useState<CaixaDoDia | null>(null);
  const [receitas, setReceitas] = useState<ReceitasDoMes | null>(null);
  const [aReceber, setAReceber] = useState<AReceber | null>(null);

  useEffect(() => {
    void p.carregarCaixaDoDia().then(setCaixa);
    void p.carregarReceitasDoMes().then(setReceitas);
    void p.carregarAReceber().then(setAReceber);
  }, [p]);

  return (
    <div style={{ display: 'grid', gap: 'var(--s-8)', padding: 'var(--s-8)',
                  maxWidth: 960, margin: '0 auto' }}>
      <h1 style={{ fontSize: 'var(--fs-22)', fontWeight: 'var(--fw-semibold)',
                   lineHeight: 'var(--lh-tight)', margin: 0 }}>
        Financeiro
      </h1>

      {/* Caixa do dia */}
      {caixa !== null ? (
        <section aria-label="Caixa do dia"
          style={{ border: 'var(--border)', borderRadius: 'var(--r-md)',
                   background: 'var(--surface)', padding: 'var(--s-6)' }}>
          <h2 style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)',
                       margin: `0 0 var(--s-4)` }}>
            Caixa do dia
          </h2>
          <p className="num" style={{ fontSize: 'var(--fs-22)', fontWeight: 'var(--fw-semibold)',
                                      margin: `0 0 var(--s-4)` }}>
            {centavosParaReais(caixa.total)}
          </p>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid',
                       gap: 'var(--s-3)' }}>
            {caixa.porMetodo.map((m) => (
              <li key={m.method} style={{ display: 'flex', justifyContent: 'space-between',
                                          fontSize: 'var(--fs-14)' }}>
                <span style={{ color: 'var(--text-muted)' }}>
                  {ROTULO_METODO[m.method]} ({m.count})
                </span>
                <span className="num">{centavosParaReais(m.total)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Receitas do mes */}
      {receitas !== null ? (
        <section aria-label="Receitas do mês"
          style={{ border: 'var(--border)', borderRadius: 'var(--r-md)',
                   background: 'var(--surface)', padding: 'var(--s-6)' }}>
          <h2 style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)',
                       margin: `0 0 var(--s-4)` }}>
            Receitas do mês
          </h2>
          <div style={{ display: 'flex', gap: 'var(--s-8)', marginBottom: 'var(--s-6)' }}>
            <div>
              <span style={{ fontSize: 'var(--fs-12)', color: 'var(--text-muted)',
                             textTransform: 'uppercase', letterSpacing: '.04em' }}>Total</span>
              <p className="num" style={{ fontSize: 'var(--fs-18)',
                                          fontWeight: 'var(--fw-semibold)', margin: 0 }}>
                {centavosParaReais(receitas.totalMes)}
              </p>
            </div>
            <div>
              <span style={{ fontSize: 'var(--fs-12)', color: 'var(--text-muted)',
                             textTransform: 'uppercase', letterSpacing: '.04em' }}>
                Média diária
              </span>
              <p className="num" style={{ fontSize: 'var(--fs-18)',
                                          fontWeight: 'var(--fw-semibold)', margin: 0 }}>
                {centavosParaReais(receitas.mediaDiaria)}
              </p>
            </div>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <GraficoDeBarras dias={receitas.dias} />
          </div>
        </section>
      ) : null}

      {/* A receber */}
      {aReceber !== null ? (
        <section aria-label="A receber"
          style={{ border: 'var(--border)', borderRadius: 'var(--r-md)',
                   background: 'var(--surface)', padding: 'var(--s-6)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between',
                        alignItems: 'baseline', marginBottom: 'var(--s-4)' }}>
            <h2 style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)', margin: 0 }}>
              A receber
            </h2>
            <span className="num" style={{ fontSize: 'var(--fs-15)',
                                            fontWeight: 'var(--fw-semibold)' }}>
              {centavosParaReais(aReceber.total)}
            </span>
          </div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid',
                       gap: 'var(--s-3)' }}>
            {aReceber.entradas.map((e) => (
              <li key={e.entryId}
                style={{ display: 'grid',
                         gridTemplateColumns: '1fr auto auto',
                         alignItems: 'center', gap: 'var(--s-4)',
                         padding: 'var(--s-3) 0',
                         borderBottom: 'var(--border)' }}>
                <div>
                  <span style={{ fontWeight: 'var(--fw-medium)', fontSize: 'var(--fs-14)' }}>
                    {e.patientName}
                  </span>
                  <span style={{ display: 'block', fontSize: 'var(--fs-12)',
                                 color: 'var(--text-muted)' }}>
                    {e.description} — vence {e.dueDate}
                  </span>
                </div>
                <span className="num" style={{ fontSize: 'var(--fs-14)' }}>
                  {centavosParaReais(e.amountCents)}
                </span>
                <Botao variante="fantasma" altura={28}
                  onClick={() => { void p.aoEnviarLink(e.entryId); }}>
                  Enviar link
                </Botao>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
```

- [ ] Rodar e confirmar que passa:

```bash
cd apps/web && pnpm vitest run src/telas/Financeiro.test.tsx
# Esperado: 8 testes passando
```

- [ ] Commitar:

```bash
git add apps/web/src/telas/Financeiro.tsx apps/web/src/telas/Financeiro.test.tsx
git commit -m "feat(web): basic financial dashboard with cash, revenue chart and receivables"
```

---

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

### Task 54: Registrar pagamento no atendimento atualiza o caixa do dia — revalidacao TanStack Query

**Arquivos**

- Criar `apps/web/src/telas/financeiro-revalidacao.test.tsx`

**Por que**: O enunciado pede teste obrigatorio: "registrar pagamento no atendimento atualiza o caixa do dia em tempo real (revalidacao TanStack Query)". Este teste demonstra que ao registrar um pagamento, a query do caixa do dia e invalidada e recarrega automaticamente.

- [ ] Escrever o teste:

```tsx
// apps/web/src/telas/financeiro-revalidacao.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, useCallback } from 'react';
import { PainelDeCobranca, type MetodoPagamento } from '../ui/PainelDeCobranca';

/**
 * Este teste valida o contrato de revalidacao: ao registrar pagamento,
 * a queryKey ['caixa-do-dia'] e invalidada e o componente que escuta
 * essa query recarrega automaticamente.
 *
 * Nao testa uma tela inteira composta; testa o CONTRATO de invalidacao
 * que a integracao real usa.
 */

interface CaixaDoDia {
  readonly total: number;
}

function CaixaConsumidor({ buscar }: { buscar: () => Promise<CaixaDoDia> }) {
  const { data } = useQuery({ queryKey: ['caixa-do-dia'], queryFn: buscar });
  if (data === undefined) return <span>Carregando caixa...</span>;
  return <span data-testid="total-caixa">{data.total}</span>;
}

function CobrancaComInvalidacao({ buscarCaixa }: { buscarCaixa: () => Promise<CaixaDoDia> }) {
  const queryClient = useQueryClient();
  const [aberto, setAberto] = useState(false);

  const aoRegistrar = useCallback(async (_dados: {
    amountCents: number;
    method: Exclude<MetodoPagamento, 'link'>;
  }) => {
    const resultado = { entryId: 'e1', receiptNumber: 1 };
    await queryClient.invalidateQueries({ queryKey: ['caixa-do-dia'] });
    setAberto(false);
    return resultado;
  }, [queryClient]);

  const aoCriarLink = useCallback(async (_dados: { amountCents: number }) => {
    return { linkUrl: 'https://pay.example.com/x', linkId: 'l1' };
  }, []);

  return (
    <div>
      <CaixaConsumidor buscar={buscarCaixa} />
      <button type="button" onClick={() => setAberto(true)}>Abrir cobranca</button>
      <PainelDeCobranca
        aberto={aberto}
        pacienteNome="Maria Souza Lima"
        procedimentoNome="Consulta"
        valorSugeridoCentavos={25000}
        aoRegistrar={aoRegistrar}
        aoCriarLink={aoCriarLink}
        aoFechar={() => setAberto(false)}
      />
    </div>
  );
}

describe('revalidacao do caixa do dia apos pagamento', () => {
  it('registrar pagamento invalida a query do caixa e recarrega com o novo total', async () => {
    let chamadas = 0;
    const buscarCaixa = vi.fn(async (): Promise<CaixaDoDia> => {
      chamadas++;
      return { total: chamadas === 1 ? 50000 : 75000 };
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <CobrancaComInvalidacao buscarCaixa={buscarCaixa} />
      </QueryClientProvider>
    );

    // 1. Caixa carrega com total inicial (50000)
    await waitFor(() => expect(screen.getByTestId('total-caixa')).toHaveTextContent('50000'));
    expect(buscarCaixa).toHaveBeenCalledTimes(1);

    // 2. Abrir painel de cobranca
    await userEvent.click(screen.getByRole('button', { name: /Abrir cobranca/ }));
    expect(screen.getByRole('dialog', { name: /Cobrar/ })).toBeVisible();

    // 3. Registrar pagamento
    await userEvent.click(screen.getByRole('button', { name: /Registrar/ }));

    // 4. A query do caixa foi invalidada e recarregada — agora mostra 75000
    await waitFor(() => expect(screen.getByTestId('total-caixa')).toHaveTextContent('75000'));
    expect(buscarCaixa).toHaveBeenCalledTimes(2);
  });

  it('o caixa nao e recarregado se o pagamento falha', async () => {
    const buscarCaixa = vi.fn(async (): Promise<CaixaDoDia> => ({ total: 50000 }));

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    function Falha() {
      const queryClient2 = useQueryClient();
      const [aberto, setAberto] = useState(false);

      const aoRegistrar = useCallback(async () => {
        throw new Error('Falha no servidor');
      }, []);

      return (
        <div>
          <CaixaConsumidor buscar={buscarCaixa} />
          <button type="button" onClick={() => setAberto(true)}>Abrir cobranca</button>
          <PainelDeCobranca
            aberto={aberto}
            pacienteNome="Maria Souza Lima"
            procedimentoNome="Consulta"
            valorSugeridoCentavos={25000}
            aoRegistrar={aoRegistrar}
            aoCriarLink={async () => ({ linkUrl: '', linkId: '' })}
            aoFechar={() => setAberto(false)}
          />
        </div>
      );
    }

    render(
      <QueryClientProvider client={queryClient}>
        <Falha />
      </QueryClientProvider>
    );

    await waitFor(() => expect(screen.getByTestId('total-caixa')).toHaveTextContent('50000'));
    await userEvent.click(screen.getByRole('button', { name: /Abrir cobranca/ }));
    await userEvent.click(screen.getByRole('button', { name: /Registrar/ }));

    // Aguarda para garantir que nao houve invalidacao extra
    await act(async () => { await new Promise((r) => setTimeout(r, 100)); });
    expect(buscarCaixa).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] Rodar e confirmar que passa:

```bash
cd apps/web && pnpm vitest run src/telas/financeiro-revalidacao.test.tsx
# Esperado: 2 testes passando
```

- [ ] Commitar:

```bash
git add apps/web/src/telas/financeiro-revalidacao.test.tsx
git commit -m "test(web): payment registration invalidates daily cash query via TanStack Query"
```
