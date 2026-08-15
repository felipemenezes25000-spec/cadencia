import { expect, test } from '@playwright/test';

const SESSAO = {
  userId: 'user-1',
  email: 'admin@cadencia.test',
  nome: 'Dra. Helena Vasques',
  mfaOk: true,
  mfaCadastrado: true,
  unidadeAtiva: { tenantId: 'tenant-1', clinicId: 'clinic-1' },
  vinculos: [{
    tenantId: 'tenant-1',
    tenantNome: 'Aurora Saúde',
    clinicId: 'clinic-1',
    clinicNome: 'Unidade Centro',
    timezone: 'America/Sao_Paulo',
    role: 'admin_clinico',
  }],
};

function luminancia([r, g, b]: readonly number[]): number {
  const [rl, gl, bl] = [r, g, b].map((canal) => {
    const valor = canal! / 255;
    return valor <= 0.04045 ? valor / 12.92 : ((valor + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * rl! + 0.7152 * gl! + 0.0722 * bl!;
}

function contraste(corA: readonly number[], corB: readonly number[]): number {
  const [maior, menor] = [luminancia(corA), luminancia(corB)].sort((a, b) => b - a);
  return (maior! + 0.05) / (menor! + 0.05);
}

test('sidebar usa o shell midnight com texto legível', async ({ page, isMobile }) => {
  test.skip(isMobile, 'No mobile, a navegação principal fica no dock inferior.');
  await page.route('**/v1/**', async (route) => {
    const caminho = new URL(route.request().url()).pathname;
    const body = caminho === '/v1/sessao'
      ? SESSAO
      : caminho === '/v1/agenda/dia'
        ? { contadores: { agendados: 0, confirmados: 0, aguardando: 0, atendidos: 0, faltas: 0 }, fila: [] }
        : caminho === '/v1/agenda/precisa-de-voce'
          ? { confirmacoesSemResposta: 0, prescricoesNaoAssinadas: 0, resultadosChegados: 0, rascunhosDeOntem: 0, guiasAFaturar: 0 }
          : {};
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });

  const origem = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';
  await page.goto(`${origem}/hoje`);
  const sidebar = page.locator('.cadencia-sidebar');
  await expect(sidebar).toBeVisible();

  const aparencia = await sidebar.evaluate((elemento) => {
    const estilos = getComputedStyle(elemento);
    const linkInativo = elemento.querySelector('a:not([aria-current="page"])');
    return {
      fundo: estilos.backgroundImage,
      texto: linkInativo ? getComputedStyle(linkInativo).color : '',
    };
  });

  /* Antes este teste fixava `rgb(239, 247, 255)`: a sidebar era azul-clara
     porque a folha light-blue vencia a camada premium. O Precision Aurora v11
     assumiu o shell midnight de vez, entao cravar um hex so registraria a cor
     da vez. O que precisa continuar verdadeiro e o contrato: o shell e escuro
     e o texto dele se le.

     A medicao usa as paradas OPACAS do gradiente — as rgba() por cima sao
     brilhos decorativos. A pior das paradas para um texto claro e a mais
     clara delas, entao e contra ela que o contraste tem de fechar. */
  const paradasOpacas = [...aparencia.fundo.matchAll(/rgb\((\d+), (\d+), (\d+)\)/g)]
    .map((m) => [Number(m[1]), Number(m[2]), Number(m[3])] as const);
  expect(paradasOpacas.length, 'nenhuma parada opaca no gradiente da sidebar').toBeGreaterThan(0);

  const maisClara = paradasOpacas.reduce((a, b) => (luminancia(a) > luminancia(b) ? a : b));
  expect(luminancia(maisClara), `shell deixou de ser escuro: rgb(${maisClara.join(', ')})`)
    .toBeLessThan(0.05);

  const canaisDoTexto = aparencia.texto.match(/\d+/g)?.map(Number);
  expect(canaisDoTexto).toHaveLength(3);
  expect(
    contraste(canaisDoTexto!, maisClara),
    `texto ${aparencia.texto} sobre rgb(${maisClara.join(', ')})`,
  ).toBeGreaterThanOrEqual(4.5);
});
