'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { TelaDeAtendimento } from '../../../src/telas/TelaDeAtendimento';
import { apiFetch, apiFetchBlobUrl, ApiError } from '../../../src/api';
import { useSessao } from '../../../src/sessao';
import type { SecaoDaFicha } from '../../../src/ui/FichaClinica';
import { montarPayloadClinico } from '../../../src/lib/payload-clinico';
import type { Anexo } from '../../../src/ui/PainelDeAnexos';
import type { SugestaoDaIA } from '../../../src/ui/PainelDeTranscricao';

interface Contexto {
  encounterId: string;
  status: 'rascunho' | 'finalizado' | 'anulado';
  inicio: string;
  paciente: {
    patientId: string;
    nome: string;
    nascimento: string | null;
    sexo: string | null;
    cadastroPreliminar: boolean;
  };
  alergias: string[];
  medicamentos: { nome: string; posologia: string; prescritoEm: string }[];
  ultimosAtendimentos: { encounterId: string; data: string; procedimento: string | null }[];
  procedimentoNome: string | null;
}

interface ConfigDoProntuario {
  secoes: SecaoDaFicha[];
}

interface NoDoEditor {
  type?: string;
  text?: string;
  content?: NoDoEditor[];
}

const QUEBRA = String.fromCharCode(10);

function ehRegistro(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

function fichaDoPayload(payload: Record<string, unknown>): Record<string, string> {
  const ficha = payload['ficha'];
  if (!ehRegistro(ficha)) return {};
  const resultado: Record<string, string> = {};
  for (const [chave, valor] of Object.entries(ficha)) {
    if (typeof valor === 'string') resultado[chave] = valor;
  }
  return resultado;
}

/**
 * O rascunho é um agregado: editor, ficha e metadados terminológicos precisam
 * viajar juntos. Patch raso em `ficha` apagaria campos salvos por outra origem;
 * por isso ela é mesclada chave a chave e o restante preserva extensões futuras.
 */
function mesclarRascunho(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const proximo: Record<string, unknown> = { ...base, ...patch };
  if (ehRegistro(base['ficha']) || ehRegistro(patch['ficha'])) {
    proximo['ficha'] = {
      ...(ehRegistro(base['ficha']) ? base['ficha'] : {}),
      ...(ehRegistro(patch['ficha']) ? patch['ficha'] : {}),
    };
  }
  return proximo;
}

function escaparHtml(texto: string): string {
  return texto
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function htmlDoTexto(texto: string): string {
  return texto.split(QUEBRA).map((linha) => `<p>${escaparHtml(linha)}</p>`).join('');
}

function textoDoDocumento(doc: unknown): string {
  const linhas: string[] = [];
  const visitar = (no: NoDoEditor, raiz: boolean): void => {
    if (typeof no.text === 'string') {
      linhas.push(no.text);
      return;
    }
    const filhos = no.content ?? [];
    if (raiz) {
      for (const filho of filhos) visitarBloco(filho);
      return;
    }
    for (const filho of filhos) visitar(filho, false);
  };
  const visitarBloco = (bloco: NoDoEditor): void => {
    const antes = linhas.length;
    visitar(bloco, false);
    const partes = linhas.splice(antes);
    linhas.push(partes.join(''));
  };
  if (typeof doc === 'object' && doc !== null) visitar(doc as NoDoEditor, true);
  return linhas.join(QUEBRA).trim();
}

export default function PaginaAtendimento() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { clinicId, csrfToken } = useSessao();

  const [ctx, setCtx] = useState<Contexto | null>(null);
  const [conteudoInicial, setConteudoInicial] = useState<string | undefined>();
  const [erro, setErro] = useState<string | null>(null);
  const [secoes, setSecoes] = useState<readonly SecaoDaFicha[]>([]);
  const [anexos, setAnexos] = useState<readonly Anexo[]>([]);
  const [valoresDaFicha, setValoresDaFicha] = useState<Record<string, string>>({});

  const rev = useRef(1);
  const ultimoDoc = useRef<Record<string, unknown> | null>(null);
  const competenciaCid = useRef('');
  const payloadRascunho = useRef<Record<string, unknown>>({});
  const valoresDaFichaRef = useRef<Record<string, string>>({});
  const filaDeSalvamento = useRef<Promise<void>>(Promise.resolve());
  const fichaAlterada = useRef(false);
  const rascunhoCarregado = useRef(false);

  const recarregarAnexos = useCallback(async (patientId: string) => {
    const r = await apiFetch<{ itens: Anexo[] }>(
      `/v1/pacientes/${patientId}/anexos`, { clinicId, csrfToken },
    ).catch(() => ({ itens: [] as Anexo[] }));
    setAnexos(r.itens);
  }, [clinicId, csrfToken]);

  /**
   * Serializa PUTs do rascunho. Editor e ficha têm debounces independentes e,
   * sem fila, os dois poderiam enviar o mesmo expectedRev e transformar digitação
   * normal em 409. Em conflito real, mescla o payload do servidor com o estado
   * local e tenta novamente sem descartar extensões desconhecidas do rascunho.
   */
  const persistirRascunho = useCallback((patch: Record<string, unknown>): Promise<void> => {
    payloadRascunho.current = mesclarRascunho(payloadRascunho.current, patch);

    const executar = async (): Promise<void> => {
      for (let tentativa = 0; tentativa < 4; tentativa += 1) {
        const snapshot = payloadRascunho.current;
        try {
          const r = await apiFetch<{ rev: number }>(`/v1/atendimentos/${id}/rascunho`, {
            method: 'PUT',
            body: { expectedRev: rev.current, payload: snapshot },
            clinicId,
            csrfToken,
          });
          rev.current = r.rev;
          if (snapshot === payloadRascunho.current) return;
        } catch (e) {
          if (!(e instanceof ApiError) || e.status !== 409) throw e;

          const atual = e.dados['currentRev'];
          if (typeof atual === 'number') rev.current = atual;

          const remoto = e.dados['currentPayload'];
          if (ehRegistro(remoto)) {
            payloadRascunho.current = mesclarRascunho(remoto, payloadRascunho.current);
          }
        }
      }
      throw new Error('conflito_de_revisao_persistente');
    };

    const tarefa = filaDeSalvamento.current.then(executar, executar);
    filaDeSalvamento.current = tarefa.catch(() => undefined);
    return tarefa;
  }, [id, clinicId, csrfToken]);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      try {
        const [contexto, rascunho, config] = await Promise.all([
          apiFetch<Contexto>(`/v1/atendimentos/${id}/contexto`, { clinicId, csrfToken }),
          apiFetch<{ rev: number; payload: Record<string, unknown> }>(
            `/v1/atendimentos/${id}/rascunho`, { clinicId, csrfToken },
          ),
          apiFetch<ConfigDoProntuario>('/v1/configuracoes/prontuario', { clinicId, csrfToken }),
        ]);
        if (!vivo) return;

        rev.current = rascunho.rev;
        payloadRascunho.current = rascunho.payload;

        const ficha = fichaDoPayload(rascunho.payload);
        valoresDaFichaRef.current = ficha;
        setValoresDaFicha(ficha);

        const competencia = rascunho.payload['competenciaCid'];
        if (typeof competencia === 'string') competenciaCid.current = competencia;

        const doc = rascunho.payload['doc'];
        if (ehRegistro(doc)) {
          ultimoDoc.current = doc;
          setConteudoInicial(htmlDoTexto(textoDoDocumento(doc)));
        }

        setSecoes(config.secoes);
        setCtx(contexto);
        rascunhoCarregado.current = true;
        void recarregarAnexos(contexto.paciente.patientId);
      } catch (e) {
        if (vivo) setErro(e instanceof ApiError ? e.codigo : 'falha_ao_carregar');
      }
    })();
    return () => { vivo = false; };
  }, [id, clinicId, csrfToken, recarregarAnexos]);

  const salvarEditor = useCallback(async (conteudo: Record<string, unknown>) => {
    ultimoDoc.current = conteudo;
    await persistirRascunho({ doc: conteudo });
  }, [persistirRascunho]);

  const mudarFicha = useCallback((chave: string, valor: string) => {
    fichaAlterada.current = true;
    setValoresDaFicha((anterior) => {
      const proximo = { ...anterior, [chave]: valor };
      valoresDaFichaRef.current = proximo;
      payloadRascunho.current = mesclarRascunho(payloadRascunho.current, {
        ficha: proximo,
        competenciaCid: competenciaCid.current,
      });
      return proximo;
    });
  }, []);

  useEffect(() => {
    if (!rascunhoCarregado.current || !fichaAlterada.current) return undefined;
    const timer = setTimeout(() => {
      fichaAlterada.current = false;
      void persistirRascunho({
        ficha: valoresDaFicha,
        competenciaCid: competenciaCid.current,
      }).catch(() => {
        fichaAlterada.current = true;
      });
    }, 800);
    return () => clearTimeout(timer);
  }, [valoresDaFicha, persistirRascunho]);

  if (erro) {
    return (
      <div className="cadencia-page">
        <p className="text-sm text-danger">Não foi possível abrir o atendimento ({erro}).</p>
      </div>
    );
  }
  if (!ctx) {
    return (
      <div className="cadencia-page">
        <p className="text-sm text-text-muted">Carregando…</p>
      </div>
    );
  }

  return (
    <TelaDeAtendimento
      encounterId={id}
      pacienteNome={ctx.paciente.nome}
      {...(ctx.procedimentoNome ? { procedimentoNome: ctx.procedimentoNome } : {})}
      inicio={new Date(ctx.inicio)}
      paciente={{
        nome: ctx.paciente.nome,
        ...(ctx.paciente.nascimento ? { nascimento: ctx.paciente.nascimento } : {}),
        ...(ctx.paciente.sexo ? { sexo: ctx.paciente.sexo } : {}),
        alergias: ctx.alergias,
        medicamentos: ctx.medicamentos.map((m) => `${m.nome} — ${m.posologia}`),
        ultimosAtendimentos: ctx.ultimosAtendimentos.map((a) => ({
          data: a.data,
          procedimento: a.procedimento ?? 'Atendimento',
        })),
      }}
      {...(conteudoInicial === undefined ? {} : { conteudoInicial })}
      onSalvar={salvarEditor}
      aoVoltar={() => router.push('/hoje')}
      abrirSessaoDoPrescritor={async () => {
        try {
          return await apiFetch<{
            mode: string;
            scriptUrl: string;
            token: string;
            patientPayload: Record<string, string>;
          }>('/v1/prescricoes/sessao', {
            method: 'POST',
            body: { encounterId: id, patientId: ctx.paciente.patientId },
            clinicId,
            csrfToken,
          });
        } catch {
          return { mode: 'indisponivel' };
        }
      }}
      buscarCodigo={async (termo) => {
        if (termo.trim().length < 2) return [];
        const usaCid11 = secoes.some((s) => s.campos.some((c) => c.refSource === 'CID11'));
        const rota = usaCid11 ? 'cid11' : 'cid';
        const r = await apiFetch<{
          itens: { codigo: string; descricao: string; competencia: string }[];
        }>(
          `/v1/catalogos/${rota}?termo=${encodeURIComponent(termo)}&data=${ctx.inicio.slice(0, 10)}`,
          { clinicId, csrfToken },
        );
        const competencia = r.itens[0]?.competencia;
        if (competencia !== undefined) {
          competenciaCid.current = competencia;
          payloadRascunho.current = mesclarRascunho(payloadRascunho.current, {
            competenciaCid: competencia,
          });
        }
        return r.itens.map((x) => ({ code: x.codigo, display: x.descricao }));
      }}
      aoConfirmarPrescricao={async ({ providerPrescriptionId }) => apiFetch<{ prescriptionId: string }>(
        '/v1/prescricoes', {
          method: 'POST',
          body: {
            providerPrescriptionId,
            encounterId: id,
            patientId: ctx.paciente.patientId,
          },
          clinicId,
          csrfToken,
        },
      )}
      aoEmitirDocumento={async ({ kind, corpo }) => {
        const r = await apiFetch<{
          documentId: string;
          assinatura: { estado: 'assinado' | 'pendente'; motivo?: string };
        }>('/v1/documentos', {
          method: 'POST',
          body: {
            kind,
            patientId: ctx.paciente.patientId,
            encounterId: id,
            payload: { corpo },
          },
          clinicId,
          csrfToken,
        });
        return {
          documentId: r.documentId,
          assinado: r.assinatura.estado === 'assinado',
          ...(r.assinatura.motivo === undefined ? {} : { motivo: r.assinatura.motivo }),
          urlPdf: await apiFetchBlobUrl(`/v1/documentos/${r.documentId}/pdf`, { clinicId, csrfToken }),
        };
      }}
      anexos={anexos}
      aoEnviarAnexo={async ({ arquivo, kind }) => {
        const bytes = new Uint8Array(await arquivo.arrayBuffer());
        let bin = '';
        for (const b of bytes) bin += String.fromCharCode(b);
        await apiFetch('/v1/anexos', {
          method: 'POST',
          body: {
            patientId: ctx.paciente.patientId,
            encounterId: id,
            kind,
            originalName: arquivo.name,
            contentType: arquivo.type || 'application/octet-stream',
            conteudoBase64: btoa(bin),
          },
          clinicId,
          csrfToken,
        });
        await recarregarAnexos(ctx.paciente.patientId);
      }}
      aoAbrirAnexo={async (attachmentId) => {
        const url = await apiFetchBlobUrl(
          `/v1/anexos/${attachmentId}/conteudo`, { clinicId, csrfToken },
        );
        window.open(url, '_blank', 'noopener');
      }}
      aoTranscrever={async (audio) => {
        const bytes = new Uint8Array(await audio.arrayBuffer());
        let bin = '';
        for (const b of bytes) bin += String.fromCharCode(b);
        const r = await apiFetch<{ sugestao: SugestaoDaIA }>(
          `/v1/atendimentos/${id}/transcricao`, {
            method: 'POST',
            body: {
              audioBase64: btoa(bin),
              contentType: audio.type || 'audio/webm',
            },
            clinicId,
            csrfToken,
          },
        );
        return r.sugestao;
      }}
      aoAceitarSugestao={(sug, campos) => {
        const porCode = new Map(secoes.flatMap((s) => s.campos).map((c) => [c.code, c]));
        const aplicar = (code: string, valor: string | null): void => {
          const campo = porCode.get(code);
          if (campo && valor !== null) mudarFicha(campo.fieldId, valor);
        };
        if (campos.has('alergias')) aplicar('alergias', sug.alergias);
        if (campos.has('pesoKg')) aplicar('peso', sug.pesoKg);
        if (campos.has('alturaCm')) aplicar('altura', sug.alturaCm);
        if (campos.has('cid') && sug.cid) aplicar('cid', `${sug.cid.codigo}|${sug.cid.descricao}`);
        if (campos.has('evolucao') && sug.evolucao) setConteudoInicial(htmlDoTexto(sug.evolucao));
      }}
      secoesDaFicha={secoes}
      valoresDaFicha={valoresDaFicha}
      aoMudarFicha={mudarFicha}
      aoFinalizar={async () => {
        await persistirRascunho({
          ficha: valoresDaFichaRef.current,
          competenciaCid: competenciaCid.current,
        });
        const corpo = montarPayloadClinico({
          secoes,
          valores: valoresDaFichaRef.current,
          evolucao: textoDoDocumento(ultimoDoc.current),
          competenciaCid: competenciaCid.current,
        });
        return apiFetch<{ versionId: string; versionNo: number }>(
          `/v1/atendimentos/${id}/finalizar`, {
            method: 'POST',
            body: corpo,
            clinicId,
            csrfToken,
          },
        );
      }}
    />
  );
}
