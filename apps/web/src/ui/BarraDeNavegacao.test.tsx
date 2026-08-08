import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { BarraDeNavegacao } from './BarraDeNavegacao';
import { ITENS_NAV, FASE_ATUAL } from './nav';

/* ── Mocks ───────────────────────────────────────────────────────────── */

const pushMock = vi.fn();

vi.mock('next/navigation', () => ({
  usePathname: () => '/hoje',
  useRouter: () => ({ push: pushMock }),
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

let mediaMock = false;
vi.mock('../lib/hooks', () => ({
  useMediaQuery: () => mediaMock,
  useKeyboardShortcut: vi.fn(),
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
  pushMock.mockClear();
  localStorageMock.clear();
});

/* ── Testes de configuracao ──────────────────────────────────────────── */

describe('nav.ts', () => {
  it('segue a ordem CRONOLOGICA do dia, nao o organograma do software', () => {
    expect(ITENS_NAV.map((i) => i.rotulo)).toEqual([
      'Hoje',
      'Agenda',
      'Conversas',
      'Pacientes',
      'Financeiro',
      'Desempenho',
    ]);
  });

  it('na Fase 5 nenhum item esta marcado como futuro', () => {
    expect(FASE_ATUAL).toBe(5);
    const futuros = ITENS_NAV.filter((i) => i.disponivelNaFase > FASE_ATUAL);
    expect(futuros).toEqual([]);
  });

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
  it('renderiza todos os itens de navegacao', () => {
    render(<BarraDeNavegacao />);
    for (const item of ITENS_NAV) {
      expect(screen.getByRole('link', { name: new RegExp(item.rotulo) })).toBeInTheDocument();
    }
  });

  it('destaca item ativo com base na rota atual', () => {
    render(<BarraDeNavegacao />);
    const linkAtivo = screen.getByRole('link', { name: /Hoje/ });
    expect(linkAtivo).toHaveAttribute('aria-current', 'page');
  });

  it('renderiza icones para todos os itens', () => {
    render(<BarraDeNavegacao />);
    // Cada item de navegacao renderiza um SVG (icone Phosphor)
    const nav = screen.getByRole('navigation');
    const svgs = nav.querySelectorAll('svg');
    // Pelo menos 1 SVG por item visivel + icones extras (brand, user, toggle)
    expect(svgs.length).toBeGreaterThanOrEqual(ITENS_NAV.length);
  });

  it('expande ao clicar no toggle', async () => {
    const user = userEvent.setup();
    render(<BarraDeNavegacao />);
    // Inicia colapsado (estado padrao false mas sem localStorage = false = expandido)
    // Clica no toggle para colapsar
    const toggle = screen.getByRole('button', { name: /colapsar/i });
    await user.click(toggle);
    // Agora deve mostrar "Expandir navegacao"
    expect(
      screen.getByRole('button', { name: /expandir/i }),
    ).toBeInTheDocument();
  });

  it('colapsa ao clicar no toggle', async () => {
    const user = userEvent.setup();
    localStorageMock.setItem('cadencia:nav-colapsado', 'true');
    render(<BarraDeNavegacao />);
    const toggle = screen.getByRole('button', { name: /expandir/i });
    await user.click(toggle);
    expect(
      screen.getByRole('button', { name: /colapsar/i }),
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
    // Mobile tab bar tem classe fixed e bottom-0
    expect(nav.className).toMatch(/fixed/);
    expect(nav.className).toMatch(/bottom-0/);
  });

  it('mostra "Mais" no mobile quando ha itens overflow', () => {
    mediaMock = true;
    render(<BarraDeNavegacao />);
    // Com 6 itens e limite de 5, deve haver botao "Mais"
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

  it('nao tem violacoes de acessibilidade', async () => {
    const { container } = render(<BarraDeNavegacao />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('nao tem violacoes de acessibilidade no modo mobile', async () => {
    mediaMock = true;
    const { container } = render(<BarraDeNavegacao />);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('Auditoria e Ajustes NAO estao na barra', () => {
    render(<BarraDeNavegacao />);
    expect(screen.queryByText('Auditoria')).not.toBeInTheDocument();
    expect(screen.queryByText('Ajustes')).not.toBeInTheDocument();
  });
});
