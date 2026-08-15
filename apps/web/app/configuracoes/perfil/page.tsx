'use client';
import { useMemo, useState } from 'react';
import {
  Buildings,
  CheckCircle,
  ShieldCheck,
  SignOut,
  User,
} from '@phosphor-icons/react';
import { useSessao, rotulo, lerCsrf } from '../../../src/sessao';
import { apiFetch, ApiError } from '../../../src/api';
import { Botao } from '../../../src/ui/Botao';
import { TrocaDeSenha } from '../../../src/telas/TrocaDeSenha';
import { CadastroMfa } from '../../../src/telas/CadastroMfa';

function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  const primeira = partes[0]?.charAt(0) ?? '?';
  const ultima = partes.length > 1 ? partes[partes.length - 1]?.charAt(0) ?? '' : '';
  return `${primeira}${ultima}`.toLocaleUpperCase('pt-BR');
}

export default function PaginaPerfil() {
  const { usuario, vinculoAtivo, trocarUnidade, sair, clinicId } = useSessao();
  const [trocando, setTrocando] = useState<string | null>(null);
  const [saindo, setSaindo] = useState(false);

  const outrasUnidades = usuario.vinculos.filter(
    (v) => v.clinicId !== vinculoAtivo.clinicId,
  );
  const avatar = useMemo(() => iniciais(usuario.nome), [usuario.nome]);

  async function trocarSenha(senhaAtual: string, senhaNova: string) {
    try {
      await apiFetch('/v1/sessao/senha', {
        method: 'PUT',
        body: { senhaAtual, senhaNova },
        clinicId,
        csrfToken: lerCsrf(),
      });
    } catch (e) {
      if (e instanceof ApiError) throw new Error(e.codigo);
      throw e;
    }
  }

  async function iniciarMfa() {
    try {
      return await apiFetch<{ qrcodeUri: string; segredo: string }>(
        '/v1/sessao/mfa/cadastrar',
        { method: 'POST', clinicId, csrfToken: lerCsrf() },
      );
    } catch (e) {
      if (e instanceof ApiError) throw new Error(e.codigo);
      throw e;
    }
  }

  async function confirmarMfa(codigo: string) {
    try {
      await apiFetch('/v1/sessao/mfa', {
        method: 'POST',
        body: { codigo },
        clinicId,
        csrfToken: lerCsrf(),
      });
    } catch (e) {
      if (e instanceof ApiError) throw new Error(e.codigo);
      throw e;
    }
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,.92fr)_minmax(0,1.08fr)] xl:items-start">
      <div className="grid gap-5">
        <section className="overflow-hidden rounded-[12px] border border-line bg-surface">
          <div className="relative border-b border-line bg-[radial-gradient(circle_at_90%_0%,rgb(98_217_206_/_0.17),transparent_15rem),linear-gradient(135deg,#f8fcfb,#fff)] p-5 sm:p-6">
            <div className="flex items-start gap-4">
              <div className="grid size-14 shrink-0 place-items-center rounded-[16px] border border-accent/15 bg-surface text-[15px] font-bold text-accent shadow-elev-1">
                {avatar}
              </div>
              <div className="min-w-0 flex-1 pt-1">
                <p className="truncate text-[18px] font-bold tracking-[-.025em] text-text">{usuario.nome}</p>
                <p className="mt-1 break-words text-xs text-text-muted">{usuario.email}</p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <span className="rounded-full border border-line bg-surface/85 px-2.5 py-1 text-[10px] font-semibold text-text-secondary">{rotulo(vinculoAtivo.role)}</span>
                  <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-semibold ${usuario.mfaCadastrado ? 'border-ok/15 bg-ok-soft text-ok' : 'border-warn/15 bg-warn-soft text-warn'}`}>
                    {usuario.mfaCadastrado ? <CheckCircle size={12} weight="fill" aria-hidden /> : <ShieldCheck size={12} aria-hidden />}
                    {usuario.mfaCadastrado ? 'MFA protegido' : 'MFA pendente'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <dl className="grid gap-px bg-line sm:grid-cols-2">
            <div className="bg-surface p-4">
              <dt className="text-[9px] font-bold uppercase tracking-[.06em] text-text-faint">Perfil de acesso</dt>
              <dd className="mt-1.5 text-[13px] font-semibold text-text">{rotulo(vinculoAtivo.role)}</dd>
            </div>
            <div className="bg-surface p-4">
              <dt className="text-[9px] font-bold uppercase tracking-[.06em] text-text-faint">Autenticação</dt>
              <dd className="mt-1.5 text-[13px] font-semibold text-text">{usuario.mfaCadastrado ? 'Segundo fator ativo' : 'Senha apenas'}</dd>
            </div>
          </dl>
        </section>

        <section className="rounded-[12px] border border-line bg-surface p-4 sm:p-5">
          <div className="mb-4 flex items-center gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-accent-soft text-accent"><Buildings size={18} weight="duotone" aria-hidden /></span>
            <div className="min-w-0">
              <h2 className="m-0 text-[13px] font-semibold text-text">Unidade de trabalho</h2>
              <p className="mt-0.5 text-[10px] text-text-faint">Contexto que está ativo nesta sessão.</p>
            </div>
          </div>

          <div className="rounded-[10px] border border-accent/20 bg-accent-soft/35 p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="truncate text-[13px] font-semibold text-text">{vinculoAtivo.clinicNome}</p>
                <p className="mt-1 truncate text-[10px] text-text-muted">{vinculoAtivo.tenantNome}</p>
              </div>
              <span className="shrink-0 rounded-full border border-accent/15 bg-surface px-2 py-1 text-[8px] font-bold uppercase tracking-[.05em] text-accent">Em uso</span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-[10px] text-text-muted">
              <span>{rotulo(vinculoAtivo.role)}</span><span aria-hidden>·</span><span>{vinculoAtivo.timezone}</span>
            </div>
          </div>

          {outrasUnidades.length > 0 ? (
            <div className="mt-4">
              <p className="mb-2 text-[9px] font-bold uppercase tracking-[.06em] text-text-faint">Trocar de unidade</p>
              <ul className="grid gap-2 sm:grid-cols-2">
                {outrasUnidades.map((v) => (
                  <li key={v.clinicId}>
                    <button
                      type="button"
                      disabled={trocando !== null}
                      onClick={() => {
                        setTrocando(v.clinicId);
                        void trocarUnidade(v.clinicId).finally(() => setTrocando(null));
                      }}
                      className="group w-full rounded-[10px] border border-line bg-surface-subtle/45 px-3.5 py-3 text-left transition hover:border-accent/35 hover:bg-accent-soft/30 disabled:opacity-50"
                    >
                      <span className="block truncate text-xs font-semibold text-text group-hover:text-accent">{v.clinicNome}</span>
                      <span className="mt-1 block truncate text-[10px] text-text-muted">{v.tenantNome} · {rotulo(v.role)}</span>
                      {trocando === v.clinicId ? <span className="mt-1.5 block text-[10px] font-semibold text-accent">Trocando contexto…</span> : null}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      </div>

      <div className="grid gap-5">
        <section className="rounded-[12px] border border-line bg-surface p-4 sm:p-5">
          <div className="mb-5 flex items-center gap-3 border-b border-line pb-4">
            <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-ok-soft text-ok"><ShieldCheck size={18} weight="duotone" aria-hidden /></span>
            <div>
              <h2 className="m-0 text-[13px] font-semibold text-text">Segurança da conta</h2>
              <p className="mt-0.5 text-[10px] text-text-faint">Senha e autenticação em duas etapas.</p>
            </div>
          </div>

          <div className="grid gap-6">
            <TrocaDeSenha aoTrocar={trocarSenha} />
            <div className="h-px bg-line" aria-hidden />
            <CadastroMfa
              mfaCadastrado={usuario.mfaCadastrado}
              aoIniciar={iniciarMfa}
              aoConfirmar={confirmarMfa}
            />
          </div>
        </section>

        <section className="rounded-[12px] border border-danger/15 bg-danger-soft/35 p-4 sm:p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-surface text-danger"><User size={17} aria-hidden /></span>
              <div>
                <h2 className="m-0 text-[13px] font-semibold text-text">Sessão atual</h2>
                <p className="mt-1 max-w-md text-[10px] leading-relaxed text-text-muted">Encerra o acesso deste navegador. Nenhuma informação clínica é apagada.</p>
              </div>
            </div>
            <Botao
              variante="perigo"
              tamanho="sm"
              iconeEsquerda={SignOut}
              carregando={saindo}
              onClick={() => { setSaindo(true); void sair(); }}
            >
              Sair da sessão
            </Botao>
          </div>
        </section>
      </div>
    </div>
  );
}
