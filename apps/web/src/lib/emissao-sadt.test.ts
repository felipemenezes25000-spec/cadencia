import { describe, expect, it, vi } from 'vitest';
import { criarEmissorDeSadt } from './emissao-sadt';
import type { NovaGuiaSadt } from './sadt-tipos';

const GUIA: NovaGuiaSadt = {
  caraterAtendimento: '1',
  tipoAtendimento: '04',
  indicacaoClinica: 'Investigacao de anemia',
  procedimentos: [{
    codigoTabela: '22', codigoProcedimento: '40304361',
    descricao: 'Hemograma completo', quantidade: 2, valorCentavos: 4500,
  }],
};

describe('emissão da guia SP/SADT', () => {
  it('em rascunho, guarda em vez de enviar', async () => {
    const enviar = vi.fn(async () => {});
    const e = criarEmissorDeSadt({ enviar });

    await e.compor(GUIA, 'rascunho');

    // A rota exige versão selada. Enviar agora devolveria 422 depois de o
    // médico ter montado a guia inteira.
    expect(enviar).not.toHaveBeenCalled();
    expect(e.temPendente()).toBe(true);
  });

  it('finalizado, envia na hora', async () => {
    const enviar = vi.fn(async () => {});
    const e = criarEmissorDeSadt({ enviar });

    await e.compor(GUIA, 'finalizado');

    expect(enviar).toHaveBeenCalledWith(GUIA);
    expect(e.temPendente()).toBe(false);
  });

  it('ao selar, emite o que estava guardado', async () => {
    const enviar = vi.fn(async () => {});
    const e = criarEmissorDeSadt({ enviar });

    await e.compor(GUIA, 'rascunho');
    const r = await e.aoSelar();

    expect(enviar).toHaveBeenCalledWith(GUIA);
    expect(r).toEqual({ emitida: true });
    expect(e.temPendente()).toBe(false);
  });

  it('selar sem guia pendente não chama nada', async () => {
    const enviar = vi.fn(async () => {});
    const e = criarEmissorDeSadt({ enviar });

    const r = await e.aoSelar();

    expect(enviar).not.toHaveBeenCalled();
    expect(r).toEqual({ emitida: false });
  });

  it('falha ao emitir NÃO derruba o selar, e a guia volta para a fila', async () => {
    const enviar = vi.fn(async () => { throw new Error('fora do ar'); });
    const aoFalhar = vi.fn();
    const e = criarEmissorDeSadt({ enviar, aoFalhar });

    await e.compor(GUIA, 'rascunho');
    const r = await e.aoSelar();

    // O registro clínico JÁ foi selado neste ponto, e isso não se desfaz.
    // Propagar o erro faria uma falha de FATURAMENTO parecer falha de
    // prontuário — e o médico tentaria finalizar de novo algo já finalizado.
    expect(r).toEqual({ emitida: false, erro: true });
    expect(aoFalhar).toHaveBeenCalledOnce();
    // Devolver ao pendente deixa o próximo selar tentar de novo.
    expect(e.temPendente()).toBe(true);
  });

  it('duas composições seguidas: vale a última', async () => {
    const enviar = vi.fn(async () => {});
    const e = criarEmissorDeSadt({ enviar });

    await e.compor(GUIA, 'rascunho');
    const segunda: NovaGuiaSadt = { ...GUIA, indicacaoClinica: 'Revisada' };
    await e.compor(segunda, 'rascunho');
    await e.aoSelar();

    // O médico ajustou a guia antes de finalizar. Emitir as duas geraria
    // cobrança dobrada do mesmo exame.
    expect(enviar).toHaveBeenCalledOnce();
    expect(enviar).toHaveBeenCalledWith(segunda);
  });

  it('selar duas vezes não emite a guia duas vezes', async () => {
    const enviar = vi.fn(async () => {});
    const e = criarEmissorDeSadt({ enviar });

    await e.compor(GUIA, 'rascunho');
    await e.aoSelar();
    const segundo = await e.aoSelar();

    expect(enviar).toHaveBeenCalledOnce();
    expect(segundo).toEqual({ emitida: false });
  });
});
