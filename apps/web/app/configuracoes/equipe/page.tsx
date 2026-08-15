'use client';

import { useEffect, useMemo, useState } from 'react';
import { ShieldCheck, UserPlus, UsersThree } from '@phosphor-icons/react';
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

  async function alterarPapel(userId: string, novoRole: string) {
    try {
      await apiFetch(`/v1/configuracoes/equipe/${userId}/role`, {
        method: 'PUT', body: { role: novoRole }, clinicId, csrfToken: lerCsrf(),
      });
      await carregarEquipe();
    } catch (e) {
      if (e instanceof ApiError) throw new Error(e.codigo);
      throw e;
    }
  }

  const resumo = useMemo(() => ({
    total: equipe.length,
    mfa: equipe.filter((membro) => membro.temTotp).length,
    profissionais: equipe.filter((membro) => membro.ehProfissional).length,
  }), [equipe]);

  return (
    <div className="grid gap-5">
      <section className="grid gap-3 rounded-[10px] border border-line bg-surface-subtle/55 p-3.5 sm:grid-cols-[1fr_auto] sm:items-center sm:p-4" aria-label="Resumo da equipe">
        <div className="grid gap-3 sm:grid-cols-3 sm:gap-2">
          <div className="flex items-center gap-3 rounded-[9px] border border-line bg-surface px-3 py-2.5">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent"><UsersThree size={16} weight="duotone" aria-hidden /></span>
            <span><strong className="block text-[15px] leading-none text-text tabular-nums">{resumo.total}</strong><small className="mt-1 block text-[9px] font-semibold uppercase tracking-[.05em] text-text-faint">Membros</small></span>
          </div>
          <div className="flex items-center gap-3 rounded-[9px] border border-line bg-surface px-3 py-2.5">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-ok-soft text-ok"><ShieldCheck size={16} weight="duotone" aria-hidden /></span>
            <span><strong className="block text-[15px] leading-none text-text tabular-nums">{resumo.mfa}</strong><small className="mt-1 block text-[9px] font-semibold uppercase tracking-[.05em] text-text-faint">Com MFA</small></span>
          </div>
          <div className="rounded-[9px] border border-line bg-surface px-3 py-2.5">
            <strong className="block text-[15px] leading-none text-text tabular-nums">{resumo.profissionais}</strong>
            <small className="mt-1 block text-[9px] font-semibold uppercase tracking-[.05em] text-text-faint">Profissionais clínicos</small>
          </div>
        </div>

        {ehAdmin ? (
          <Botao variante="primario" tamanho="sm" iconeEsquerda={UserPlus} onClick={() => setModalAberto(true)}>
            Convidar pessoa
          </Botao>
        ) : null}
      </section>

      <div>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="m-0 text-[13px] font-semibold text-text">Acessos da unidade</h3>
            <p className="mt-1 text-[10px] leading-relaxed text-text-faint">Papéis, registros profissionais e segundo fator em um único lugar.</p>
          </div>
          {!ehAdmin ? <span className="rounded-full border border-line bg-surface-subtle px-2.5 py-1 text-[9px] font-semibold text-text-faint">Somente visualização</span> : null}
        </div>

        <TabelaEquipe
          itens={equipe}
          meuUserId={usuario.userId}
          ehAdmin={ehAdmin}
          aoRevogar={revogar}
          aoDesativarMfa={desativarMfa}
          {...(ehAdmin ? { aoAlterarPapel: alterarPapel } : {})}
        />
      </div>

      <ConvidarUsuario
        aberto={modalAberto}
        aoFechar={() => setModalAberto(false)}
        aoConvidar={convidar}
      />
    </div>
  );
}
