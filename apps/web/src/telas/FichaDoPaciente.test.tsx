import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { FichaDoPaciente } from './FichaDoPaciente';
import type { AtendimentoResumo, DocumentoResumo, LancamentoResumo } from './FichaDoPaciente';

/* ── Mocks ───────────────────────────────────────────────────────────── */

vi.mock('next/navigation', () => ({
  usePathname: () => '/pacientes/p1',
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

/* ── Fixtures ────────────────────────────────────────────────────────── */

const PACIENTE = {
  patientId: 'p1',
  displayName: 'Maria Souza Lima',
  legalName: 'Maria Souza Lima',
  hasSocialName: false,
  birthDate: '1988-03-14',
  cadastroStatus: 'preliminar' as const,
  phonePrimary: '11987654321',
};

const ATENDIMENTOS: AtendimentoResumo[] = [
  {
    id: 'a1',
    tipo: 'Consulta',
    data: '2026-08-01',
    resumo: 'Paciente com queixas de cefaleia',
    profissional: 'Ana Silva',
  },
  {
    id: 'a2',
    tipo: 'Retorno',
    data: '2026-08-05',
    resumo: 'Melhora significativa apos tratamento',
    profissional: 'Ana Silva',
  },
];

const LANCAMENTOS: LancamentoResumo[] = [
  {
    entryId: 'e1',
    description: 'Consulta particular',
    amountCents: 30000,
    status: 'paid' as const,
    dueDate: '2026-08-03',
    paidAt: '2026-08-03',
  },
];

const DOCUMENTOS: DocumentoResumo[] = [
  {
    id: 'd1',
    origem: 'emitido',
    titulo: 'Relatorio de acompanhamento',
    categoria: 'Relatorio medico',
    criadoEm: '2026-08-05T14:30:00-03:00',
    tamanhoBytes: null,
    assinado: true,
  },
  {
    id: 'a1',
    origem: 'anexo',
    titulo: 'hemograma.pdf',
    categoria: 'Resultado de exame',
    criadoEm: '2026-08-04T10:00:00-03:00',
    tamanhoBytes: 245760,
    assinado: false,
  },
];

/* ── Helper de montagem ──────────────────────────────────────────────── */

function montar(over = {}) {
  const props = {
    paciente: PACIENTE,
    papel: 'profissional' as const,
    pendentes: [] as string[],
    carregarProntuario: vi.fn(async () => []),
    prontuarioAcessivel: true,
    existeMasSemAcesso: false,
    aoQuebrarVidro: vi.fn(async () => {}),
    carregarConversas: vi.fn(async () => []),
    carregarFinanceiro: vi.fn(async () => LANCAMENTOS),
    carregarDocumentos: vi.fn(async () => []),
    aoAbrirDocumento: vi.fn(async () => {}),
    podeVerFinanceiro: false,
    atendimentos: ATENDIMENTOS,
    aoMensagem: vi.fn(),
    aoNovoAtendimento: vi.fn(),
    ...over,
  };
  render(<FichaDoPaciente {...props} />);
  return props;
}

/* ── Testes ───────────────────────────────────────────────────────────── */

describe('FichaDoPaciente', () => {
  it('renderiza skeleton enquanto carrega', () => {
    montar({ carregando: true });
    expect(
      screen.getByRole('status', { name: 'Carregando ficha do paciente' }),
    ).toBeVisible();
    // Não deve renderizar o conteúdo real
    expect(
      screen.queryByRole('heading', { level: 1, name: 'Maria Souza Lima' }),
    ).not.toBeInTheDocument();
  });

  it('renderiza nome do paciente no título', () => {
    montar();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Maria Souza Lima' }),
    ).toBeVisible();
  });

  it('renderiza barra de resumo com dados demográficos', () => {
    montar();
    // Iniciais do avatar
    expect(screen.getByText('ML')).toBeVisible();
    // Valor da idade (calculado a partir de 1988-03-14)
    expect(screen.getByText(/\d+ anos/)).toBeVisible();
    // Telefone formatado aparece na barra de resumo (e no Resumo tab)
    expect(screen.getAllByText('(11) 98765-4321').length).toBeGreaterThanOrEqual(1);
    // Labels demográficos (Telefone aparece na barra e no tab Resumo)
    expect(screen.getAllByText('Telefone').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Idade')).toBeVisible();
  });

  it('renderiza tabs', () => {
    montar();
    expect(screen.getByRole('tab', { name: 'Resumo' })).toBeVisible();
    expect(screen.getByRole('tab', { name: 'Prontuário' })).toBeVisible();
    expect(screen.getByRole('tab', { name: 'Histórico' })).toBeVisible();
    expect(screen.getByRole('tab', { name: 'Documentos' })).toBeVisible();
    expect(screen.getByRole('tab', { name: 'Financeiro' })).toBeVisible();
    expect(screen.getByRole('tab', { name: 'Comunicações' })).toBeVisible();
  });

  it('muda conteúdo ao clicar em tab', async () => {
    montar();
    // Tab Resumo ativo por padrão - mostra seção de contato
    expect(screen.getByText('Contato')).toBeVisible();

    // Clicar em Historico mostra timeline
    await userEvent.click(screen.getByRole('tab', { name: 'Histórico' }));
    await waitFor(() => {
      expect(screen.getByText('Consulta')).toBeVisible();
    });

    // Clicar em Documentos mostra placeholder
    await userEvent.click(screen.getByRole('tab', { name: 'Documentos' }));
    await waitFor(() => {
      expect(
        screen.getByText('Nenhum documento cadastrado'),
      ).toBeVisible();
    });
  });

  it('carrega documentos emitidos e anexos ao abrir a aba', async () => {
    const props = montar({ carregarDocumentos: vi.fn(async () => DOCUMENTOS) });

    await userEvent.click(screen.getByRole('tab', { name: 'Documentos' }));

    expect(await screen.findByText('Relatorio de acompanhamento')).toBeVisible();
    expect(screen.getByText('hemograma.pdf')).toBeVisible();
    expect(screen.getByText('Documento assinado')).toBeVisible();
    expect(props.carregarDocumentos).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getAllByRole('button', { name: /Abrir/ })[0]!);
    expect(props.aoAbrirDocumento).toHaveBeenCalledWith(DOCUMENTOS[0]);
  });

  it('mostra timeline de atendimentos no tab Histórico', async () => {
    montar();
    await userEvent.click(screen.getByRole('tab', { name: 'Histórico' }));
    await waitFor(() => {
      expect(screen.getByText('Consulta')).toBeVisible();
      expect(
        screen.getByText('Paciente com queixas de cefaleia'),
      ).toBeVisible();
      // Ana Silva aparece em dois atendimentos
      expect(screen.getAllByText(/Ana Silva/).length).toBe(2);
      expect(screen.getByText('Retorno')).toBeVisible();
      expect(
        screen.getByText('Melhora significativa apos tratamento'),
      ).toBeVisible();
    });
  });

  it('mostra botões de ação: Mensagem e Novo atendimento', () => {
    montar();
    expect(
      screen.getByRole('button', { name: /Mensagem/ }),
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: /Novo atendimento/ }),
    ).toBeVisible();
  });

  it('mostra breadcrumbs com link para Pacientes', () => {
    montar();
    const link = screen.getByRole('link', { name: 'Pacientes' });
    expect(link).toBeVisible();
    expect(link).toHaveAttribute('href', '/pacientes');
  });

  it('não tem violações de acessibilidade', async () => {
    const { container } = render(
      <FichaDoPaciente
        paciente={PACIENTE}
        papel="profissional"
        pendentes={[]}
        carregarProntuario={async () => []}
        prontuarioAcessivel
        existeMasSemAcesso={false}
        aoQuebrarVidro={async () => {}}
        carregarConversas={async () => []}
        carregarFinanceiro={async () => []}
        carregarDocumentos={async () => []}
        aoAbrirDocumento={async () => {}}
        podeVerFinanceiro={false}
        atendimentos={ATENDIMENTOS}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
