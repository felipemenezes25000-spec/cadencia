import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'vitest-axe';
import { BuscaDeCatalogo } from './BuscaDeCatalogo';
import { ApiError } from '../api';

describe('BuscaDeCatalogo', () => {
  const buscar = vi.fn().mockResolvedValue([{ codigo: 'J45', descricao: 'Asma' }]);
  const colunas = [
    { chave: 'codigo' as const, rotulo: 'Codigo' },
    { chave: 'descricao' as const, rotulo: 'Descricao' },
  ];

  beforeEach(() => {
    buscar.mockReset();
    buscar.mockResolvedValue([{ codigo: 'J45', descricao: 'Asma' }]);
  });

  it('mostra estado vazio antes da busca', () => {
    render(<BuscaDeCatalogo titulo="CID-10" placeholder="Buscar" colunas={colunas} buscar={buscar} />);
    expect(screen.getByText(/digite ao menos 2 caracteres/i)).toBeDefined();
  });

  it('exibe resultados apos digitar >= 2 chars', async () => {
    const user = userEvent.setup();
    render(<BuscaDeCatalogo titulo="CID-10" placeholder="Buscar" colunas={colunas} buscar={buscar} />);
    await user.type(screen.getByRole('searchbox'), 'J45');
    await waitFor(() => { expect(buscar).toHaveBeenCalledWith('J45'); });
    await waitFor(() => { expect(screen.getByText('Asma')).toBeDefined(); });
  });

  it('nao busca com menos de 2 chars', async () => {
    const user = userEvent.setup();
    render(<BuscaDeCatalogo titulo="CID-10" placeholder="Buscar" colunas={colunas} buscar={buscar} />);
    await user.type(screen.getByRole('searchbox'), 'J');
    await new Promise((r) => setTimeout(r, 500));
    expect(buscar).not.toHaveBeenCalled();
  });

  it('explica quando o catálogo ainda não foi carregado e permite tentar novamente', async () => {
    buscar.mockRejectedValueOnce(new ApiError('catalogo_nao_carregado', 503));
    const user = userEvent.setup();
    render(<BuscaDeCatalogo titulo="CID-10" placeholder="Buscar" colunas={colunas} buscar={buscar} />);

    await user.type(screen.getByRole('searchbox'), 'J45');
    const alerta = await screen.findByRole('alert');
    expect(alerta).toHaveTextContent(/ainda não foi carregado/i);

    buscar.mockResolvedValueOnce([{ codigo: 'J45', descricao: 'Asma' }]);
    await user.click(screen.getByRole('button', { name: /tentar novamente/i }));
    expect(await screen.findByText('Asma')).toBeInTheDocument();
  });

  it('passa a11y', async () => {
    const { container } = render(<BuscaDeCatalogo titulo="CID-10" placeholder="Buscar" colunas={colunas} buscar={buscar} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
