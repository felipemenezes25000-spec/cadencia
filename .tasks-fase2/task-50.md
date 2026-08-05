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