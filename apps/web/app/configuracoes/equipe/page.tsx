'use client';

import { useEffect, useState } from 'react';
import { UserPlus } from '@phosphor-icons/react';
import { apiFetch, ApiError } from '../../../src/api';
import { useSessao, lerCsrf } from '../../../src/sessao';
import { Botao } from '../../../src/ui/Botao';
import { TabelaEquipe, type MembroEquipe } from '../../../src/telas/TabelaEquipe';
import { ConvidarUsuario, type DadosConvite } from '../../../src/telas/ConvidarUsuario';

export default function PaginaEquipe() {
  const { clinicId, vinculoAtivo, usuario } = useSessao();
  const ehAdmin = vinculoAtivo.role === 'admin_clinico';

  const [equipe, setEquipe] = useState<readonly MembroEquipe[]>([]);
  const [modalAberto, setModalAberto] = useState(false);

  async function carregarEquipe() {
    try {
      const r = await apiFetch<{ itens: MembroEquipe[] }>(
        '/v1/configuracoes/equipe', { clinicId, csrfToken: lerCsrf() },
      );
      setEquipe(r.itens);
    } catch {
      setEquipe([]);
    }
  }

  useEffect(() => {
    void carregarEquipe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinicId]);

  async function convidar(dados: DadosConvite) {
    try {
      await apiFetch('/v1/configuracoes/equipe', {
        method: 'POST', body: dados, clinicId, csrfToken: lerCsrf(),
      });
      await carregarEquipe();
    } catch (e) {
      if (e instanceof ApiError) throw new Error(e.codigo);
      throw e;
    }
  }

  async function revogar(userId: string, role: string, motivo?: string) {
    try {
      await apiFetch(`/v1/configuracoes/equipe/${userId}/role/${role}`, {
        method: 'DELETE', body: { motivo }, clinicId, csrfToken: lerCsrf(),
      });
      await carregarEquipe();
    } catch (e) {
      if (e instanceof ApiError) throw new Error(e.codigo);
      throw e;
    }
  }

  async function desativarMfa(userId: string) {
    try {
      await apiFetch(`/v1/configuracoes/equipe/${userId}/mfa`, {
        method: 'DELETE', body: {}, clinicId, csrfToken: lerCsrf(),
      });
      await carregarEquipe();
    } catch (e) {
      if (e instanceof ApiError) throw new Error(e.codigo);
      throw e;
    }
  }

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">
          Equipe
        </h2>
        {ehAdmin && (
          <Botao variante="primario" tamanho="sm"
            iconeEsquerda={UserPlus}
            onClick={() => setModalAberto(true)}>
            Convidar
          </Botao>
        )}
      </div>

      <TabelaEquipe
        itens={equipe}
        meuUserId={usuario.userId}
        ehAdmin={ehAdmin}
        aoRevogar={revogar}
        aoDesativarMfa={desativarMfa}
      />

      <ConvidarUsuario
        aberto={modalAberto}
        aoFechar={() => setModalAberto(false)}
        aoConvidar={convidar}
      />
    </div>
  );
}
