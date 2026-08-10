'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  LayoutDoProntuario, type ItemSalvo, type SecaoDoLayout,
} from '../../../src/ui/LayoutDoProntuario';
import { PageHeader } from '../../../src/ui/PageHeader';
import { apiFetch, ApiError } from '../../../src/api';
import { useSessao } from '../../../src/sessao';

/**
 * O layout do prontuario DO PROFISSIONAL logado.
 *
 * Pagina separada de `/configuracoes`, que e da clinica: ali um administrador
 * muda nome, fuso e equipe para todo mundo; aqui cada medico arruma a propria
 * tela. Misturar as duas faria parecer que reordenar secao afeta os colegas.
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
        // A rota exige `encounter.read`. Quem nao atende nao tem prontuario
        // para arrumar — e dizer isso e melhor que uma tela vazia.
        ? 'So quem atende tem prontuario para arrumar.'
        : 'Nao foi possivel carregar o layout.');
    });
  }, [carregar]);

  if (erro !== null) {
    return (
      <div className="cadencia-page grid min-h-[40vh] place-items-center">
        <p className="max-w-md text-center text-sm text-text-muted">{erro}</p>
      </div>
    );
  }

  return (
    <div className="cadencia-page grid gap-5">
      <PageHeader
        titulo="Meu prontuario"
        subtitulo="A ordem das secoes na tela de atendimento, e o que voce quer ver. Vale so para voce — os colegas continuam com a ordem deles."
      />

      {aviso !== null && <p className="text-sm text-ok">{aviso}</p>}

      {secoes === null ? (
        <p className="text-sm text-text-muted">Carregando…</p>
      ) : (
        <LayoutDoProntuario
          // `key` remonta o componente quando a lista do servidor muda: sem
          // isso, o estado interno (a ordem em edicao) sobreviveria ao salvar e
          // a tela mostraria a ordem antiga como se nada tivesse acontecido.
          key={secoes.map((s) => `${s.sectionId}${s.ordinal}${s.visible}`).join('|')}
          secoes={secoes}
          aoSalvar={async (itens: readonly ItemSalvo[]) => {
            // Lista vazia chega aqui quando o medico clica em "voltar ao
            // padrao". A rota entende isso como apagar a personalizacao.
            await apiFetch('/v1/configuracoes/prontuario/layout', {
              method: 'PUT', body: { itens }, clinicId, csrfToken });
            setAviso('Ordem salva. Vale a partir do proximo atendimento que voce abrir.');
            await carregar();
          }}
        />
      )}
    </div>
  );
}
