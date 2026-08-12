'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  FormRecursoGlosa, type GlosaParaRecurso,
} from '../../../../src/telas/FormRecursoGlosa';
import { PageHeader } from '../../../../src/ui/PageHeader';
import { apiFetch } from '../../../../src/api';
import { useSessao } from '../../../../src/sessao';

interface GlosaDaApi {
  glosaId: string;
  operadoraId: string;
  numeroGuiaPrestador: string;
  pacienteNome: string;
  codigoGlosa: string;
  descricaoGlosa: string | null;
  encounterVersionId: string | null;
  valorGlosadoCents: number;
}

/**
 * Abrir recurso a partir das glosas escolhidas na tela de glosas.
 *
 * A tela de glosas já empurrava para `/convenios/recursos?glosas=...` — rota que
 * não existia, então selecionar glosas e clicar em recorrer dava 404. Glosa não
 * recorrida dentro do prazo da operadora vira perda definitiva, e o formulário
 * estava pronto e testado esperando esta página.
 */
function NovoRecursoInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { clinicId, csrfToken } = useSessao();

  const ids = (params.get('glosas') ?? '').split(',').filter((x) => x !== '');
  const [glosas, setGlosas] = useState<readonly GlosaParaRecurso[]>([]);
  const [brutas, setBrutas] = useState<readonly GlosaDaApi[]>([]);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (ids.length === 0) { setErro('Nenhuma glosa selecionada.'); return undefined; }
    let vivo = true;
    void Promise.all(ids.map((id) => apiFetch<GlosaDaApi>(
      `/v1/tiss/glosas/${id}`, { clinicId, csrfToken })))
      .then((rs) => {
        if (!vivo) return;
        setBrutas(rs);
        setGlosas(rs.map((g) => ({
          id: g.glosaId,
          guiaNumero: g.numeroGuiaPrestador,
          pacienteNome: g.pacienteNome,
          codigoGlosa: g.codigoGlosa,
          // Código sem texto acontece: nem toda operadora manda a descrição.
          // Mostrar o código cru é melhor que uma linha vazia.
          descricaoGlosa: g.descricaoGlosa ?? `código ${g.codigoGlosa}`,
          valorGlosadoCentavos: g.valorGlosadoCents,
        })));
      })
      .catch(() => { if (vivo) setErro('Não foi possível carregar as glosas.'); });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.get('glosas'), clinicId, csrfToken]);

  const submeter = useCallback(async (dados: {
    glosas: { glosaId: string; justificativa: string }[];
    justificativaGeral: string;
  }) => {
    const primeira = brutas[0];
    if (primeira === undefined) { setErro('Nenhuma glosa carregada.'); return; }

    // Um recurso é de UMA operadora e de UMA versão de atendimento. Misturar
    // operadoras num recurso só faria o XML sair para a operadora errada.
    if (brutas.some((g) => g.operadoraId !== primeira.operadoraId)) {
      setErro('As glosas selecionadas são de operadoras diferentes. '
        + 'Abra um recurso por operadora.');
      return;
    }
    if (primeira.encounterVersionId === null) {
      // Sem versão de atendimento não há o que anexar como prova. Recorrer assim
      // seria mandar contestação sem o registro que a sustenta.
      setErro('Esta glosa não está ligada a um atendimento finalizado. '
        + 'Sem isso não há registro clínico para sustentar o recurso.');
      return;
    }

    try {
      const criado = await apiFetch<{ recursoId: string }>('/v1/tiss/recursos', {
        method: 'POST',
        body: {
          operadoraId: primeira.operadoraId,
          encounterVersionId: primeira.encounterVersionId,
          justificativaGeral: dados.justificativaGeral,
        },
        clinicId, csrfToken,
      });

      // Os itens entram um a um, com a justificativa específica de cada glosa.
      // O valor recursado é o valor glosado: recorrer de menos do que foi
      // glosado deixa dinheiro na mesa sem ninguém perceber.
      for (const item of dados.glosas) {
        const g = brutas.find((x) => x.glosaId === item.glosaId);
        if (g === undefined) continue;
        await apiFetch(`/v1/tiss/recursos/${criado.recursoId}/itens`, {
          method: 'POST',
          body: {
            glosaId: item.glosaId,
            justificativaItem: item.justificativa,
            valorRecursadoCents: g.valorGlosadoCents,
          },
          clinicId, csrfToken,
        });
      }

      router.push(`/convenios/recursos/${criado.recursoId}`);
    } catch {
      setErro('Não foi possível abrir o recurso.');
    }
  }, [brutas, clinicId, csrfToken, router]);

  return (
    <div className="cadencia-page grid gap-6">
      <PageHeader
        titulo="Novo recurso de glosa"
        subtitulo={`${glosas.length} ${glosas.length === 1 ? 'glosa' : 'glosas'} selecionadas`}
      />

      {erro !== null && <p role="alert" className="text-sm text-danger">{erro}</p>}

      {glosas.length > 0 && (
        <FormRecursoGlosa
          glosas={glosas}
          aoSubmeter={submeter}
          aoCancelar={() => router.push('/convenios/glosas')}
        />
      )}
    </div>
  );
}

export default function PaginaNovoRecurso() {
  return (
    <Suspense>
      <NovoRecursoInner />
    </Suspense>
  );
}
