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
 * A tela de glosas ja empurrava para `/convenios/recursos?glosas=...` — rota que
 * nao existia, entao selecionar glosas e clicar em recorrer dava 404. Glosa nao
 * recorrida dentro do prazo da operadora vira perda definitiva, e o formulario
 * estava pronto e testado esperando esta pagina.
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
          // Codigo sem texto acontece: nem toda operadora manda a descricao.
          // Mostrar o codigo cru e melhor que uma linha vazia.
          descricaoGlosa: g.descricaoGlosa ?? `codigo ${g.codigoGlosa}`,
          valorGlosadoCentavos: g.valorGlosadoCents,
        })));
      })
      .catch(() => { if (vivo) setErro('Nao foi possivel carregar as glosas.'); });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.get('glosas'), clinicId, csrfToken]);

  const submeter = useCallback(async (dados: {
    glosas: { glosaId: string; justificativa: string }[];
    justificativaGeral: string;
  }) => {
    const primeira = brutas[0];
    if (primeira === undefined) { setErro('Nenhuma glosa carregada.'); return; }

    // Um recurso e de UMA operadora e de UMA versao de atendimento. Misturar
    // operadoras num recurso so faria o XML sair para a operadora errada.
    if (brutas.some((g) => g.operadoraId !== primeira.operadoraId)) {
      setErro('As glosas selecionadas sao de operadoras diferentes. '
        + 'Abra um recurso por operadora.');
      return;
    }
    if (primeira.encounterVersionId === null) {
      // Sem versao de atendimento nao ha o que anexar como prova. Recorrer assim
      // seria mandar contestacao sem o registro que a sustenta.
      setErro('Esta glosa nao esta ligada a um atendimento finalizado. '
        + 'Sem isso nao ha registro clinico para sustentar o recurso.');
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

      // Os itens entram um a um, com a justificativa especifica de cada glosa.
      // O valor recursado e o valor glosado: recorrer de menos do que foi
      // glosado deixa dinheiro na mesa sem ninguem perceber.
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
      setErro('Nao foi possivel abrir o recurso.');
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
