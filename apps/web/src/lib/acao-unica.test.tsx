import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useState } from 'react';
import { Botao } from '../ui/Botao';
import { BotaoIcone } from '../ui/BotaoIcone';
import { Plus } from '@phosphor-icons/react';
import { useSubmitUnico } from './acao-unica';

/**
 * Dois cliques no MESMO tick — é assim que o navegador entrega duplo clique de
 * mouse, duplo toque e o clique fantasma do touch. `fireEvent.click` do RTL
 * embrulha cada chamada em `act()` e força um commit entre elas, o que esconde
 * exatamente o bug; por isso os eventos vão direto ao elemento.
 */
function clicarDuasVezesNoMesmoTick(elemento: HTMLElement): void {
  elemento.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  elemento.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

function esperar(ms: number): Promise<void> {
  return new Promise((r) => { setTimeout(r, ms); });
}

describe('guarda de reentrada do Botao', () => {
  it('dois cliques no mesmo tick chamam a ação UMA vez', async () => {
    const aoClicar = vi.fn(async () => { await esperar(30); });
    render(<Botao onClick={aoClicar}>Salvar</Botao>);

    await act(async () => {
      clicarDuasVezesNoMesmoTick(screen.getByRole('button'));
      await esperar(60);
    });

    expect(aoClicar).toHaveBeenCalledTimes(1);
  });

  it('segura o botão pela requisição inteira quando o handler devolve a promessa', async () => {
    // Sem `carregando`/`disabled` nenhum: só a promessa devolvida protege.
    // É o caso do duplo clique humano, ~150 ms entre um e outro, em que o
    // React já commitou e um guard baseado em estado não existiria.
    const aoClicar = vi.fn(async () => { await esperar(200); });
    render(<Botao onClick={aoClicar}>Emitir</Botao>);
    const botao = screen.getByRole('button');

    await act(async () => {
      fireEvent.click(botao);
      await esperar(150);
      fireEvent.click(botao);
      await esperar(200);
    });

    expect(aoClicar).toHaveBeenCalledTimes(1);
  });

  it('libera o botão depois que a ação termina', async () => {
    const aoClicar = vi.fn(async () => { await esperar(20); });
    render(<Botao onClick={aoClicar}>Salvar</Botao>);
    const botao = screen.getByRole('button');

    await act(async () => { fireEvent.click(botao); await esperar(60); });
    await act(async () => { fireEvent.click(botao); await esperar(60); });

    // Travar de vez seria trocar um bug por outro: salvar duas vezes de
    // propósito é operação legítima.
    expect(aoClicar).toHaveBeenCalledTimes(2);
  });

  it('libera o botão quando a ação FALHA, e deixa a rejeição passar', async () => {
    const aoClicar = vi.fn(async () => {
      await esperar(20);
      throw new Error('rede caiu');
    });

    const rejeicoes: unknown[] = [];
    const capturar = (motivo: unknown) => { rejeicoes.push(motivo); };
    process.on('unhandledRejection', capturar);

    render(<Botao onClick={aoClicar}>Salvar</Botao>);
    const botao = screen.getByRole('button');

    // Requisição que falhou é justamente a que o usuário precisa repetir.
    await act(async () => { fireEvent.click(botao); await esperar(60); });
    await act(async () => { fireEvent.click(botao); await esperar(60); });

    process.off('unhandledRejection', capturar);

    expect(aoClicar).toHaveBeenCalledTimes(2);
    // O guard não pode virar `catch` global: a falha continua visível para o
    // console e para qualquer captura de `unhandledrejection`.
    expect(rejeicoes).toHaveLength(2);
  });

  it('não trava botão síncrono clicado várias vezes', async () => {
    function Contador() {
      const [n, setN] = useState(0);
      return <Botao onClick={() => setN((v) => v + 1)}>{`n=${n}`}</Botao>;
    }
    render(<Contador />);
    const botao = screen.getByRole('button');

    // Guard eterno quebraria "+1", paginação, "adicionar item".
    for (let i = 0; i < 3; i += 1) {
      await act(async () => { fireEvent.click(botao); await esperar(5); });
    }

    expect(botao).toHaveTextContent('n=3');
  });

  it('vale também para BotaoIcone', async () => {
    const aoClicar = vi.fn(async () => { await esperar(30); });
    render(<BotaoIcone icone={Plus} rotulo="Remover" onClick={aoClicar} />);

    await act(async () => {
      clicarDuasVezesNoMesmoTick(screen.getByRole('button', { name: 'Remover' }));
      await esperar(60);
    });

    expect(aoClicar).toHaveBeenCalledTimes(1);
  });
});

describe('useSubmitUnico', () => {
  function Formulario({ aoEnviar }: { readonly aoEnviar: () => Promise<void> }) {
    const enviar = useSubmitUnico(aoEnviar);
    return (
      <form onSubmit={enviar} aria-label="teste">
        <button type="submit">Enviar</button>
      </form>
    );
  }

  it('dois submits no mesmo tick enviam UMA vez', async () => {
    const aoEnviar = vi.fn(async () => { await esperar(30); });
    render(<Formulario aoEnviar={aoEnviar} />);
    const form = screen.getByRole('form', { name: 'teste' });

    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await esperar(60);
    });

    expect(aoEnviar).toHaveBeenCalledTimes(1);
  });

  it('barra o segundo submit COM preventDefault', async () => {
    const aoEnviar = vi.fn(async () => { await esperar(50); });
    render(<Formulario aoEnviar={aoEnviar} />);
    const form = screen.getByRole('form', { name: 'teste' });

    const primeiro = new Event('submit', { bubbles: true, cancelable: true });
    const segundo = new Event('submit', { bubbles: true, cancelable: true });
    await act(async () => {
      form.dispatchEvent(primeiro);
      form.dispatchEvent(segundo);
      await esperar(80);
    });

    // Sem `preventDefault` no envio barrado o formulário cairia na submissão
    // nativa do navegador e a página navegaria por GET.
    expect(segundo.defaultPrevented).toBe(true);
  });
});
