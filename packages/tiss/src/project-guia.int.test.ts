// packages/tiss/src/project-guia.int.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closePools, withTenantTx, type Actor } from '@cadencia/db';
import { isOk, uuidv7 } from '@cadencia/kernel';
import { projectGuiaConsulta } from './project-guia';
import {
  semearProjecaoParticular,
  type TissSementeParticular,
} from './test-support';

let sp: TissSementeParticular;
let actorParticular: Actor;

beforeAll(async () => {
  sp = await semearProjecaoParticular();
  actorParticular = {
    kind: 'user',
    tenantId: sp.tenantId,
    userId: sp.userId,
    clinicId: sp.clinicId,
    requestId: uuidv7(),
  };
});
afterAll(async () => { await closePools(); });

describe('projectGuiaConsulta — atendimento particular', () => {
  it('retorna ok com kind skipped quando encounter_billing nao tem registro_ans', async () => {
    // O caso particular nao precisa de encounter finalizado: projectGuiaConsulta
    // apenas le encounter_billing e verifica registro_ans. A seed ja criou o
    // billing com registro_ans NULL. Usamos um versionId dummy porque o path
    // particular retorna antes de usa-lo.
    // Nota: finalize_encounter esta quebrado por bug na RLS do outbox (migration 0118
    // concedeu INSERT a clin_writer mas nao criou policy RLS). Divergencia registrada.
    const dummyVersionId = uuidv7();

    const result = await withTenantTx(actorParticular, async (tx) => {
      return projectGuiaConsulta(tx, sp.encounterId, dummyVersionId);
    });

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.kind).toBe('skipped');
    }
  });
});
