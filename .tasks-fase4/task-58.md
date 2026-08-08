### Task 58: Tela Operadoras — CRUD de operadoras e contratos

**Arquivos**

- Criar `apps/web/src/telas/ConveniosOperadoras.tsx`
- Criar `apps/web/src/telas/ConveniosOperadoras.test.tsx`

**Por que**: A tela "Operadoras" (`/financeiro/convenios/operadoras`) permite cadastrar e editar operadoras e seus contratos (registro ANS, versao TISS acordada, dados de contato). E o ponto de entrada para vincular paciente a convenio (tambem acessivel pelo `/pacientes/{id}`). Design §5.3 — CRUD de operadoras no escopo financeiro.

- [ ] Criar o teste `apps/web/src/telas/ConveniosOperadoras.test.tsx`:

```tsx
// apps/web/src/telas/ConveniosOperadoras.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import {
  ConveniosOperadoras,
  type Operadora,
  type OperadorasDados,
} from './ConveniosOperadoras';

const OPERADORAS: readonly Operadora[] = [
  {
    id: 'op1', nome: 'Unimed', registroAns: '123456',
    versaoTiss: '4.01.00', cnpj: 'AB1234567890CD',
    email: 'faturamento@unimed.com.br', telefone: '(11) 3333-4444',
    ativa: true, totalPacientes: 42,
  },
  {
    id: 'op2', nome: 'Bradesco Saude', registroAns: '654321',
    versaoTiss: '4.01.00', cnpj: 'XY9876543210ZW',
    email: 'tiss@bradescosaude.com.br', telefone: '(11) 5555-6666',
    ativa: true, totalPacientes: 18,
  },
  {
    id: 'op3', nome: 'SulAmerica', registroAns: '111222',
    versaoTiss: '3.05.00', cnpj: 'SA1111222233CD',
    email: null, telefone: null,
    ativa: false, totalPacientes: 0,
  },
];

const DADOS: OperadorasDados = { operadoras: OPERADORAS };

function montar() {
  const props = {
    carregarDados: vi.fn(async () => DADOS),
    aoSalvar: vi.fn(async (_op: Partial<Operadora> & { nome: string; registroAns: string }) => {}),
    aoDesativar: vi.fn(async (_id: string) => {}),
  };
  render(<ConveniosOperadoras {...props} />);
  return props;
}

describe('ConveniosOperadoras', () => {
  it('lista as operadoras com nome, registro ANS e status', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('Unimed')).toBeVisible());
    expect(screen.getByText('Bradesco Saude')).toBeVisible();
    expect(screen.getByText('SulAmerica')).toBeVisible();
    expect(screen.getByText('123456')).toBeVisible();
  });

  it('exibe a versao TISS acordada de cada operadora', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('Unimed')).toBeVisible());
    expect(screen.getByText('4.01.00')).toBeVisible();
  });

  it('exibe o total de pacientes vinculados', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('Unimed')).toBeVisible());
    const linha = screen.getByText('Unimed').closest('li');
    expect(linha).toBeTruthy();
    expect(within(linha!).getByText(/42 paciente/i)).toBeVisible();
  });

  it('operadoras inativas tem indicador visual', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('SulAmerica')).toBeVisible());
    const linha = screen.getByText('SulAmerica').closest('li');
    expect(linha).toBeTruthy();
    expect(within(linha!).getByText(/Inativa/i)).toBeVisible();
  });

  it('tem botao para criar nova operadora', async () => {
    montar();
    await waitFor(() => expect(
      screen.getByRole('button', { name: /Nova operadora/i })).toBeVisible());
  });

  it('ao clicar em Nova operadora abre formulario', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('Unimed')).toBeVisible());
    await userEvent.click(screen.getByRole('button', { name: /Nova operadora/i }));
    expect(screen.getByRole('dialog', { name: /Nova operadora/i })).toBeVisible();
  });

  it('formulario exige nome e registro ANS', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('Unimed')).toBeVisible());
    await userEvent.click(screen.getByRole('button', { name: /Nova operadora/i }));
    expect(screen.getByLabelText(/^Nome/i)).toBeVisible();
    expect(screen.getByLabelText(/Registro ANS/i)).toBeVisible();
    expect(screen.getByLabelText(/Versao TISS/i)).toBeVisible();
  });

  it('cada operadora ativa tem botao Desativar', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('Unimed')).toBeVisible());
    const linha = screen.getByText('Unimed').closest('li');
    expect(linha).toBeTruthy();
    expect(within(linha!).getByRole('button', { name: /Desativar/i })).toBeVisible();
  });

  it('ao clicar Desativar chama aoDesativar com o id', async () => {
    const props = montar();
    await waitFor(() => expect(screen.getByText('Unimed')).toBeVisible());
    const linha = screen.getByText('Unimed').closest('li');
    await userEvent.click(within(linha!).getByRole('button', { name: /Desativar/i }));
    expect(props.aoDesativar).toHaveBeenCalledWith('op1');
  });

  it('sem violacao de acessibilidade', async () => {
    const { container } = render(
      <ConveniosOperadoras
        carregarDados={async () => DADOS}
        aoSalvar={async () => {}}
        aoDesativar={async () => {}}
      />,
    );
    await waitFor(() => expect(screen.getByText('Unimed')).toBeVisible());
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] Rodar o teste e confirmar que falha porque o modulo nao existe:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run apps/web/src/telas/ConveniosOperadoras.test.tsx 2>&1 | head -20
# Esperado: FAIL — Cannot find module './ConveniosOperadoras'
```

- [ ] Criar o componente `apps/web/src/telas/ConveniosOperadoras.tsx`:

```tsx
// apps/web/src/telas/ConveniosOperadoras.tsx
'use client';

import { useEffect, useState } from 'react';
import { Botao } from '../ui/Botao';
import { Campo } from '../ui/Campo';
import { PainelLateral } from '../ui/PainelLateral';

// ── Tipos ──────────────────────────────────────────────────────────────────

export interface Operadora {
  readonly id: string;
  readonly nome: string;
  readonly registroAns: string;
  readonly versaoTiss: string;
  readonly cnpj: string;
  readonly email: string | null;
  readonly telefone: string | null;
  readonly ativa: boolean;
  readonly totalPacientes: number;
}

export interface OperadorasDados {
  readonly operadoras: readonly Operadora[];
}

export interface ConveniosOperadorasProps {
  readonly carregarDados: () => Promise<OperadorasDados>;
  readonly aoSalvar: (op: Partial<Operadora> & { nome: string; registroAns: string }) => Promise<void>;
  readonly aoDesativar: (operadoraId: string) => Promise<void>;
}

// ── Componente ─────────────────────────────────────────────────────────────

export function ConveniosOperadoras(p: ConveniosOperadorasProps) {
  const [dados, setDados] = useState<OperadorasDados | null>(null);
  const [formAberto, setFormAberto] = useState(false);
  const [nome, setNome] = useState('');
  const [registroAns, setRegistroAns] = useState('');
  const [versaoTiss, setVersaoTiss] = useState('4.01.00');
  const [cnpj, setCnpj] = useState('');
  const [email, setEmail] = useState('');
  const [telefone, setTelefone] = useState('');

  useEffect(() => {
    void p.carregarDados().then(setDados);
  }, [p]);

  function limparForm(): void {
    setNome('');
    setRegistroAns('');
    setVersaoTiss('4.01.00');
    setCnpj('');
    setEmail('');
    setTelefone('');
  }

  function salvar(): void {
    void p.aoSalvar({
      nome, registroAns, versaoTiss, cnpj,
      email: email === '' ? null : email,
      telefone: telefone === '' ? null : telefone,
    }).then(() => {
      setFormAberto(false);
      limparForm();
    });
  }

  if (dados === null) return null;

  return (
    <div style={{ display: 'grid', gap: 'var(--s-6)' }}>
      {/* Cabecalho */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)', margin: 0 }}>
          Operadoras
        </h2>
        <Botao variante="primario" altura={32}
          onClick={() => { limparForm(); setFormAberto(true); }}>
          Nova operadora
        </Botao>
      </div>

      {/* Lista de operadoras */}
      <section aria-label="Operadoras cadastradas">
        <ul style={{ listStyle: 'none', margin: 0, padding: 0,
                     border: 'var(--border)', borderRadius: 'var(--r-md)',
                     overflow: 'hidden', background: 'var(--surface)' }}>
          {dados.operadoras.map((op) => (
            <li key={op.id} style={{
              display: 'grid', gridTemplateColumns: '1fr auto',
              alignItems: 'center', gap: 'var(--s-4)',
              padding: 'var(--s-5) var(--s-5)',
              borderBottom: 'var(--border)', minHeight: 56,
            }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-3)' }}>
                  <span style={{ fontWeight: 'var(--fw-medium)', fontSize: 'var(--fs-15)' }}>
                    {op.nome}
                  </span>
                  <span className="num" style={{
                    fontSize: 'var(--fs-12)', fontFamily: 'var(--font-mono)',
                    fontVariantNumeric: 'tabular-nums', color: 'var(--text-muted)',
                  }}>
                    {op.registroAns}
                  </span>
                  {!op.ativa ? (
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: 'var(--s-2)',
                      fontSize: 'var(--fs-11)', textTransform: 'uppercase', letterSpacing: '.04em',
                      fontWeight: 'var(--fw-medium)', padding: 'var(--s-1) var(--s-4)',
                      borderRadius: 'var(--r-full)',
                      color: 'var(--text-faint)', background: 'var(--surface-sunken)',
                    }}>
                      Inativa
                    </span>
                  ) : null}
                </div>
                <span style={{ display: 'block', fontSize: 'var(--fs-12)',
                               color: 'var(--text-muted)' }}>
                  TISS {op.versaoTiss} — {op.totalPacientes} paciente(s) vinculado(s)
                </span>
              </div>

              <div style={{ display: 'flex', gap: 'var(--s-2)' }}>
                {op.ativa ? (
                  <Botao variante="fantasma" altura={28}
                    onClick={() => { void p.aoDesativar(op.id); }}>
                    Desativar
                  </Botao>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* Formulario de nova operadora */}
      <PainelLateral
        aberto={formAberto}
        titulo="Nova operadora"
        aoFechar={() => setFormAberto(false)}
      >
        <div style={{ display: 'grid', gap: 'var(--s-5)', marginTop: 'var(--s-4)' }}>
          <Campo rotulo="Nome" value={nome}
            onChange={(e) => setNome(e.target.value)}
            aria-label="Nome" required />
          <Campo rotulo="Registro ANS" value={registroAns}
            onChange={(e) => setRegistroAns(e.target.value)}
            aria-label="Registro ANS" maxLength={6} required />
          <Campo rotulo="Versao TISS" value={versaoTiss}
            onChange={(e) => setVersaoTiss(e.target.value)}
            aria-label="Versao TISS" />
          <Campo rotulo="CNPJ" value={cnpj}
            onChange={(e) => setCnpj(e.target.value)}
            aria-label="CNPJ" maxLength={14} />
          <Campo rotulo="E-mail" type="email" value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-label="E-mail" />
          <Campo rotulo="Telefone" type="tel" value={telefone}
            onChange={(e) => setTelefone(e.target.value)}
            aria-label="Telefone" />
          <Botao variante="primario" altura={40} onClick={salvar}>
            Salvar
          </Botao>
        </div>
      </PainelLateral>
    </div>
  );
}
```

- [ ] Rodar o teste e confirmar que passa:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
pnpm vitest run apps/web/src/telas/ConveniosOperadoras.test.tsx 2>&1 | tail -5
# Esperado: Tests  10 passed
```

- [ ] Commitar:

```bash
cd "C:/Users/Felipe/Downloads/novo projeto"
git add apps/web/src/telas/ConveniosOperadoras.tsx apps/web/src/telas/ConveniosOperadoras.test.tsx
git commit -m "feat(web): add ConveniosOperadoras CRUD screen"
```

---