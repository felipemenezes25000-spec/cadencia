import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { BarraDeNavegacao } from './BarraDeNavegacao';
import { ITENS_NAV } from './nav';

/* ── Mocks ───────────────────────────────────────────────────────────── */

const mockPush = vi.fn();
const mockReplace = vi.fn();
vi.mock('next/navigation', () => ({
  usePathname: () => '/hoje',
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
}));

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    [k: string]: unknown;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const mockTrocarUnidade = vi.fn().mockResolvedValue(undefined);
const mockSair = vi.fn().mockResolvedValue(undefined);
vi.mock('../sessao', async () => {
  const actual = await vi.importActual('../sessao');
  return {
    ...actual as object,
    useSessao: () => ({
      clinicId: 'c1', csrfToken: 'tok',
      usuario: {
        userId: 'u1', email: 'dr@test.com', nome: 'Dr. Test', mfaOk: true,
        unidadeAtiva: { tenantId: 't1', clinicId: 'c1' },
        vinculos: [
          { tenantId: 't1', clinicId: 'c1', clinicNome: 'Clinica A', tenantNome: 'Tenant', timezone: 'America/Sao_Paulo', role: 'admin_clinico' },
          { tenantId: 't1', clinicId: 'c2', clinicNome: 'Clinica B', tenantNome: 'Tenant', timezone: 'America/Sao_Paulo', role: 'profissional' },
        ],
      },
      vinculoAtivo: { tenantId: 't1', clinicId: 'c1', clinicNome: 'Clinica A', tenantNome: 'Tenant', timezone: 'America/Sao_Paulo', role: 'admin_clinico' },
      trocarUnidade: mockTrocarUnidade, sair: mockSair,
    }),
  };
});

let mediaMock = false;
vi.mock('../lib/hooks', () => ({
  useMediaQuery: () => mediaMock,
}));

/* Mock localStorage */
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(window, 'localStorage', { value: localStorageMock });

beforeEach(() => {
  mediaMock = false;
  vi.clearAllMocks();
  localStorageMock.clear();
});

/* ── Testes de configuracao ──────────────────────────────────────────── */

describe('nav.ts', () => {
  it('todos os itens tem icone e id unicos', () => {
    const ids = ITENS_NAV.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const item of ITENS_NAV) {
      expect(item.icone).toBeDefined();
    }
  });
});

/* ── Testes do componente ─────────────────────────────────────────────── */

describe('BarraDeNavegacao', () => {
  it('renderiza os dois grupos da sidebar', () => {
    render(<BarraDeNavegacao />);
    expect(screen.getByText('Workspace')).toBeDefined();
    expect(screen.getByText('Gestao')).toBeDefined();
  });

  it('mostra Convenios na sidebar', () => {
    render(<BarraDeNavegacao />);
    expect(screen.getByRole('link', { name: /convenios/i })).toBeDefined();
  });

  it('mostra Relatorios na sidebar', () => {
    render(<BarraDeNavegacao />);
    expect(screen.getByRole('link', { name: /relatorios/i })).toBeDefined();
  });

  it('mostra nome do usuario real', () => {
    render(<BarraDeNavegacao />);
    expect(screen.getByText('Dr. Test')).toBeDefined();
  });

  it('mostra nome da clinica ativa', () => {
    render(<BarraDeNavegacao />);
    expect(screen.getByText(/Clinica A/)).toBeDefined();
  });

  it('tem link para configuracoes', () => {
    render(<BarraDeNavegacao />);
    expect(screen.getByRole('link', { name: /configuracoes/i })).toBeDefined();
  });

  it('passa a11y', async () => {
    const { container } = render(<BarraDeNavegacao />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('destaca item ativo com base na rota atual', () => {
    render(<BarraDeNavegacao />);
    const linkAtivo = screen.getByRole('link', { name: /Hoje/ });
    expect(linkAtivo).toHaveAttribute('aria-current', 'page');
  });

  it('expande ao clicar no toggle', async () => {
    const user = userEvent.setup();
    render(<BarraDeNavegacao />);
    const toggle = screen.getByRole('button', { name: /colapsar/i });
    await user.click(toggle);
    expect(
      screen.getByRole('button', { name: /expandir/i }),
    ).toBeInTheDocument();
  });

  it('salva preferencia de colapso no localStorage', async () => {
    const user = userEvent.setup();
    render(<BarraDeNavegacao />);
    const toggle = screen.getByRole('button', { name: /colapsar/i });
    await user.click(toggle);
    expect(localStorageMock.getItem('cadencia:nav-colapsado')).toBe('true');
  });

  it('renderiza como tab bar no mobile', () => {
    mediaMock = true;
    render(<BarraDeNavegacao />);
    const nav = screen.getByRole('navigation');
    expect(nav.className).toMatch(/fixed/);
    expect(nav.className).toMatch(/bottom-0/);
  });

  it('mostra "Mais" no mobile quando ha itens overflow', () => {
    mediaMock = true;
    render(<BarraDeNavegacao />);
    expect(
      screen.getByRole('button', { name: /mais/i }),
    ).toBeInTheDocument();
  });

  it('tem navegacao acessivel com role=navigation', () => {
    render(<BarraDeNavegacao />);
    expect(
      screen.getByRole('navigation', { name: 'Navegacao principal' }),
    ).toBeInTheDocument();
  });

  it('nao tem violacoes de acessibilidade no modo mobile', async () => {
    mediaMock = true;
    const { container } = render(<BarraDeNavegacao />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
