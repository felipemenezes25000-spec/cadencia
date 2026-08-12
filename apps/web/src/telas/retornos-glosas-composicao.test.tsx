// apps/web/src/telas/retornos-glosas-composicao.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';

/* Mock de next/navigation (ConveniosLayout usa usePathname + useRouter) */
vi.mock('next/navigation', () => ({
  usePathname: () => '/convenios/retornos',
  useRouter: () => ({ push: vi.fn() }),
}));

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
    expect(screen.getByRole('tab', { name: /Retornos/i })).toHaveAttribute('data-state', 'active');
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
    await waitFor(() => expect(screen.getAllByText('Unimed').length).toBeGreaterThan(0));
    expect(screen.getAllByText(/Rascunho/).length).toBeGreaterThan(0);
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
    await userEvent.click(screen.getByRole('button', { name: /Próximo/i }));
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
    /*
     * Desabilitamos aria-valid-attr-value porque o Radix Tabs emite
     * aria-controls apontando para TabsContent que nao existe neste layout.
     */
    expect(await axe(container, {
      rules: { 'aria-valid-attr-value': { enabled: false } },
    })).toHaveNoViolations();
  });
});
