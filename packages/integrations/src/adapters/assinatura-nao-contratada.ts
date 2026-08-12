import { failure, success, type ProviderResult, type Rfc3339 } from '../contracts/common';
import type { SignatureProvider, VerifyResult } from '../contracts/signature';

/**
 * Assinatura sem PSC contratado.
 *
 * NAO e um fake. O fake assina com sucesso e reporta `valida`: e a ferramenta
 * certa para desenvolver offline, e a errada para qualquer ambiente onde alguem
 * de verdade emite documento. Usado fora de desenvolvimento, ele grava atestado
 * com `signature_id` preenchido e estado `assinado` — indistinguivel de uma
 * assinatura ICP-Brasil real no banco, e sem valor legal nenhum. Quem descobre
 * e o paciente, no balcao do INSS.
 *
 * Este provedor recusa. O documento continua sendo EMITIDO e registrado no
 * prontuario; ele apenas nasce PENDENTE de assinatura, que e exatamente o que
 * `clin.signature_pending` existe para representar. Quando o PSC for contratado,
 * a fila de pendencias e assinada sem reemitir documento nenhum.
 *
 * Trocar isto por um adaptador real e uma decisao COMERCIAL antes de ser
 * tecnica: exige contrato com um PSC credenciado no ITI e uma ACT credenciada
 * para o carimbo de tempo. O contrato em `contracts/signature.ts` ja descreve o
 * que o adaptador precisa fazer.
 */
export function createUncontractedSignatureProvider(): SignatureProvider {
  const motivo = 'psc_nao_contratado';

  function recusar<T>(operacao: string): ProviderResult<T> {
    return failure({
      kind: 'rejected',
      retrySafe: false,
      code: motivo,
      detail: `${operacao} indisponivel: nenhum PSC ICP-Brasil contratado`,
    });
  }

  return {
    id: 'signature-nao-contratado',
    // Não declara `ad-rt` nem `ltv`: quem consulta capabilities para decidir se
    // pode emitir documento assinado precisa receber "não" aqui.
    capabilities: new Set(['residency:br']),
    safety: {
      authorizeSigner: 'idempotent',
      completeAuthorization: 'unsafe',
      sign: 'idempotent',
      verify: 'idempotent',
      retimestamp: 'idempotent',
    },

    async health() {
      // `up: false` de propósito. O monitor precisa mostrar isto vermelho: não é
      // uma indisponibilidade passageira de rede, e sim a ausência de um contrato —
      // e um painel todo verde faria ninguém lembrar de resolver.
      return { up: false, latencyMs: 0, checkedAt: '1970-01-01T00:00:00.000Z' as Rfc3339 };
    },

    async authorizeSigner() { return recusar('autorização de signatário'); },
    async completeAuthorization() { return recusar('conclusão de autorização'); },
    async sign() { return recusar('assinatura'); },
    async retimestamp() { return recusar('recarimbo'); },

    async verify(): Promise<ProviderResult<VerifyResult>> {
      // A chamada em si SUCEDE — o que ela informa e que nada pode ser afirmado.
      // Devolver `inválida` diria que a assinatura foi conferida e reprovada;
      // devolver erro faria a tela mostrar falha onde não houve falha. A
      // ICP-Brasil já tem a palavra exata para "não dá para concluir".
      return success<VerifyResult>({
        status: 'indeterminada',
        chainOk: false,
        revocationOk: false,
        timestampOk: false,
        reasons: [motivo],
      }, 'verify:sem-psc');
    },
  };
}
