'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  LayoutDoProntuario, type ItemSalvo, type SecaoDoLayout,
} from '../../../src/ui/LayoutDoProntuario';
import { apiFetch, ApiError } from '../../../src/api';
import { useSessao } from '../../../src/sessao';

/**
 * O layout do prontuário DO PROFISSIONAL logado.
 *
 * Página separada de `/configuracoes`, que é da clínica: ali um administrador
 * muda nome, fuso e equipe para todo mundo; aqui cada médico arruma a própria
 * tela. Misturar as duas faria parecer que reordenar seção afeta os colegas.
 */
export default function PaginaLayoutDoProntuario() {
  const { clinicId, csrfToken } = useSessao();
  const [secoes, setSecoes] = useState<readonly SecaoDoLayout[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const r = await apiFetch<{ itens: SecaoDoLayout[] }>(
      '/v1/configuracoes/prontuario/layout', { clinicId, csrfToken });
    setSecoes(r.itens);
  }, [clinicId, csrfToken]);

  useEffect(() => {
    void carregar().catch((e: unknown) => {
      setErro(e instanceof ApiError && e.status === 403
        // A rota exige `encounter.read`. Quem não atende não tem prontuário
        // para organizar — e dizer isso é melhor que uma tela vazia.
        ? 'Só quem atende pacientes tem um prontuário para organizar.'
        : 'Não foi possível carregar o layout.');
    });
  }, [carregar]);

  if (erro !== null) {
    return (
      <div className="grid min-h-[36vh] place-items-center">
        <p className="max-w-md text-center text-sm text-text-muted">{erro}</p>
      </div>
    );
  }

  return (
    <section className="grid gap-5" aria-labelledby="titulo-meu-prontuario">
      <div>
        <h2 id="titulo-meu-prontuario" className="text-lg font-semibold tracking-[-0.02em] text-text">Meu prontuário</h2>
        <p className="mt-1 max-w-3xl text-sm text-text-muted">A ordem das seções na tela de atendimento e o que você quer ver. Vale só para você — os colegas continuam com a ordem deles.</p>
      </div>

      {aviso !== null && <p className="text-sm text-ok">{aviso}</p>}

      {secoes === null ? (
        <p className="text-sm text-text-muted">Carregando…</p>
      ) : (
        <LayoutDoProntuario
          key={secoes.map((s) => `${s.sectionId}${s.ordinal}${s.visible}`).join('|')}
          secoes={secoes}
          aoSalvar={async (itens: readonly ItemSalvo[]) => {
            await apiFetch('/v1/configuracoes/prontuario/layout', {
              method: 'PUT', body: { itens }, clinicId, csrfToken });
            setAviso('Ordem salva. Vale a partir do próximo atendimento que você abrir.');
            await carregar();
          }}
        />
      )}
    </section>
  );
}
