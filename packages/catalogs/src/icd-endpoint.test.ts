import { describe, expect, it } from 'vitest';
import { exigeOauth } from './icd-endpoint';

describe('quando a API da CID-11 exige OAuth', () => {
  it('o servico publico da OMS exige', () => {
    expect(exigeOauth('https://id.who.int')).toBe(true);
    expect(exigeOauth('https://id.who.int/')).toBe(true);
  });

  it('instancia local NAO exige — a OMS e explicita nisso', () => {
    // "The locally deployed versions do not require OAUTH-2 authentication."
    // Exigir credencial aqui obrigaria quem roda o container próprio a se
    // registrar em id.who.int para falar com a própria máquina.
    expect(exigeOauth('http://localhost:8081')).toBe(false);
    expect(exigeOauth('http://127.0.0.1:8081')).toBe(false);
    expect(exigeOauth('http://icd-api')).toBe(false);
    expect(exigeOauth('http://cadencia-icd-api:80')).toBe(false);
  });

  it('host desconhecido exige, por precaucao', () => {
    // O padrão seguro é pedir credencial: mandar requisição sem token para um
    // host externo qualquer devolveria 401 e o erro apareceria como "a OMS
    // recusou", escondendo que faltava configuração.
    expect(exigeOauth('https://icd.exemplo.com.br')).toBe(true);
  });

  it('URL invalida nao derruba a decisao — trata como externa', () => {
    expect(exigeOauth('nao-e-uma-url')).toBe(true);
  });
});
