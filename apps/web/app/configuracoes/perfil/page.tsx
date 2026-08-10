'use client';
import { useState } from 'react';
import { User, Buildings, SignOut } from '@phosphor-icons/react';
import { useSessao, rotulo, lerCsrf } from '../../../src/sessao';
import { apiFetch, ApiError } from '../../../src/api';
import { Botao } from '../../../src/ui/Botao';
import { TrocaDeSenha } from '../../../src/telas/TrocaDeSenha';
import { CadastroMfa } from '../../../src/telas/CadastroMfa';

export default function PaginaPerfil() {
  const { usuario, vinculoAtivo, trocarUnidade, sair, clinicId } = useSessao();
  const [trocando, setTrocando] = useState<string | null>(null);
  const [saindo, setSaindo] = useState(false);

  const outrasUnidades = usuario.vinculos.filter(
    (v) => v.clinicId !== vinculoAtivo.clinicId,
  );

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
    <div className="grid max-w-2xl gap-8">
      <section className="grid gap-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">Seus dados</h2>
        <div className="rounded-xl border border-line bg-surface p-5">
          <div className="flex items-center gap-4">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
              <User size={24} weight="bold" />
            </div>
            <div>
              <p className="font-semibold text-text">{usuario.nome}</p>
              <p className="text-sm text-text-muted">{usuario.email}</p>
            </div>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-xs text-text-muted">Papel nesta unidade</dt>
              <dd className="font-medium">{rotulo(vinculoAtivo.role)}</dd>
            </div>
            <div>
              <dt className="text-xs text-text-muted">MFA</dt>
              <dd className="font-medium">{usuario.mfaCadastrado ? 'Ativo' : 'Nao configurado'}</dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="grid gap-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">Seguranca</h2>
        <div className="rounded-xl border border-line bg-surface p-5 grid gap-6">
          <TrocaDeSenha aoTrocar={trocarSenha} />
          <hr className="border-line" />
          <CadastroMfa
            mfaCadastrado={usuario.mfaCadastrado}
            aoIniciar={iniciarMfa}
            aoConfirmar={confirmarMfa}
          />
        </div>
      </section>

      <section className="grid gap-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">Unidade ativa</h2>
        <div className="rounded-xl border border-accent/30 bg-accent-soft/30 p-5">
          <div className="flex items-center gap-3">
            <Buildings size={20} className="text-accent" />
            <div>
              <p className="font-semibold text-text">{vinculoAtivo.clinicNome}</p>
              <p className="text-xs text-text-muted">{vinculoAtivo.tenantNome} · {rotulo(vinculoAtivo.role)} · {vinculoAtivo.timezone}</p>
            </div>
          </div>
        </div>
        {outrasUnidades.length > 0 && (
          <>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">Trocar para outra unidade</h3>
            <ul className="grid gap-2">
              {outrasUnidades.map((v) => (
                <li key={v.clinicId}>
                  <button type="button" disabled={trocando !== null}
                    onClick={() => { setTrocando(v.clinicId); void trocarUnidade(v.clinicId).finally(() => setTrocando(null)); }}
                    className="w-full rounded-lg border border-line bg-surface px-4 py-3 text-left text-sm transition hover:border-accent hover:bg-surface-2 disabled:opacity-50">
                    <span className="block font-medium">{v.clinicNome}</span>
                    <span className="block text-xs text-text-muted">{v.tenantNome} · {rotulo(v.role)}</span>
                    {trocando === v.clinicId && <span className="text-xs text-accent">Trocando…</span>}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section>
        <Botao variante="perigo" iconeEsquerda={SignOut} carregando={saindo}
          onClick={() => { setSaindo(true); void sair(); }}>
          Sair da sessao
        </Botao>
      </section>
    </div>
  );
}
