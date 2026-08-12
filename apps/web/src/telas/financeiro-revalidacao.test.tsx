// apps/web/src/telas/financeiro-revalidacao.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, useCallback } from 'react';
import { PainelDeCobranca, type MetodoPagamento } from '../ui/PainelDeCobranca';
import { ToastProvider } from '../ui/ToastProvider';

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
        <ToastProvider>
          <CobrancaComInvalidacao buscarCaixa={buscarCaixa} />
        </ToastProvider>
      </QueryClientProvider>
    );

    // 1. Caixa carrega com total inicial (50000)
    await waitFor(() => expect(screen.getByTestId('total-caixa')).toHaveTextContent('50000'));
    expect(buscarCaixa).toHaveBeenCalledTimes(1);

    // 2. Abrir painel de cobranca
    await userEvent.click(screen.getByRole('button', { name: /Abrir cobranca/ }));
    expect(screen.getByRole('dialog', { name: /Cobrança/ })).toBeVisible();

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

    // Captura a rejeicao esperada para nao poluir o relatorio do vitest
    const rejeicoes: Array<unknown> = [];
    const capturar = (_reason: unknown) => { rejeicoes.push(_reason); };
    process.on('unhandledRejection', capturar);

    function Falha() {
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
        <ToastProvider>
          <Falha />
        </ToastProvider>
      </QueryClientProvider>
    );

    await waitFor(() => expect(screen.getByTestId('total-caixa')).toHaveTextContent('50000'));
    await userEvent.click(screen.getByRole('button', { name: /Abrir cobranca/ }));
    await userEvent.click(screen.getByRole('button', { name: /Registrar/ }));

    // Aguarda para garantir que nao houve invalidacao extra
    await act(async () => { await new Promise((r) => setTimeout(r, 100)); });
    expect(buscarCaixa).toHaveBeenCalledTimes(1);

    // Confirma que a rejeicao ocorreu (o erro do servidor)
    expect(rejeicoes.length).toBeGreaterThanOrEqual(1);
    process.off('unhandledRejection', capturar);
  });
});
