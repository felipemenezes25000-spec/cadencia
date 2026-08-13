import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useEstadoNaUrl } from './useEstadoNaUrl';

function Exemplo() {
  const [busca, setBusca] = useEstadoNaUrl('busca');
  return <input aria-label="Busca" value={busca} onChange={(e) => setBusca(e.target.value)} />;
}

describe('useEstadoNaUrl', () => {
  afterEach(() => window.history.replaceState({}, '', '/'));

  it('lê e atualiza o filtro na URL', () => {
    window.history.replaceState({}, '', '/pacientes?busca=ana');
    render(<Exemplo />);
    const campo = screen.getByRole('textbox', { name: 'Busca' });
    expect(campo).toHaveValue('ana');
    fireEvent.change(campo, { target: { value: 'bia' } });
    expect(window.location.search).toBe('?busca=bia');
  });
});
