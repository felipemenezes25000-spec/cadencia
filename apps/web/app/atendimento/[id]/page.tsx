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
import type { GuiaSadtEmitida, NovaGuiaSadt } from '../../../src/ui/PainelDeSadt';
import { criarEmissorDeSadt } from '../../../src/lib/emissao-sadt';

interface Contexto {
  encounterId: string;
  status: 'rascunho' | 'finalizado' | 'anulado';
  inicio: string;
  paciente: {
    patientId: string; nome: string; nascimento: string | null;
    sexo: string | null; convenio: string | null; cadastroPreliminar: boolean;
  };
  alergias: string[];
  medicamentos: { nome: string; posologia: string; prescritoEm: string }[];
  ultimosAtendimentos: { encounterId: string; data: string; procedimento: string | null }[];
  procedimentoNome: string | null;
  valorSugeridoCentavos: number | null;
}

interface ConfigDoProntuario { secoes: SecaoDaFicha[] }

/**
 * O painel de cobranca fala `credito`/`debito`; `fin.payment_method_kind` fala
 * `cartao_credito`/`cartao_debito`. Sao vocabularios diferentes de propósito —
 * um e rotulo de tela, o outro e dominio contabil — e a traducao mora aqui, na
 * borda. `boleto` nao tem par: fica de fora e o painel diz que nao suporta, em
 * vez de virar dinheiro no fechamento do caixa.
 */
const METODO_DA_API: Record<string, string | undefined> = {
  pix: 'pix',
  dinheiro: 'dinheiro',
  credito: 'cartao_credito',
  debito: 'cartao_debito',
};

const QUEBRA = String.fromCharCode(10);

/** Doc do TipTap: arvore de nos com `text` nas folhas. */
interface NoDoEditor { type?: string; text?: string; content?: NoDoEditor[] }

/**
 * Extrai o texto do documento do editor, um bloco por linha.
 *
 * O rascunho guarda a arvore do TipTap, que e o formato de EDICAO. A versao
 * selada guarda TEXTO, que e o formato de LEITURA: ela e o registro que sai em
 * requisicao judicial, em transferencia para outra clinica e em auditoria do
 * CFM. Um JSON de editor num anexo pericial e ilegivel para quem precisa ler.
 */
function textoDoDocumento(doc: unknown): string {
  const linhas: string[] = [];
  const visitar = (no: NoDoEditor, raiz: boolean): void => {
    if (typeof no.text === 'string') { linhas.push(no.text); return; }
    const filhos = no.content ?? [];
    if (raiz) { for (const f of filhos) visitarBloco(f); return; }
    for (const f of filhos) visitar(f, false);
  };
  const visitarBloco = (bloco: NoDoEditor): void => {
    const antes = linhas.length;
    visitar(bloco, false);
    // Junta as folhas do bloco numa linha so; separa blocos por quebra. Sem
    // isso, "Paciente refere " e "dor" viram duas linhas por causa de um negrito.
    const partes = linhas.splice(antes);
    linhas.push(partes.join(''));
  };
  if (typeof doc === 'object' && doc !== null) visitar(doc as NoDoEditor, true);
  return linhas.join('\n').trim();
}

export default function PaginaAtendimento() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { clinicId, csrfToken } = useSessao();

  const [ctx, setCtx] = useState<Contexto | null>(null);
  const [conteudoInicial, setConteudoInicial] = useState<string | undefined>(undefined);
  const [erro, setErro] = useState<string | null>(null);

  // rev do rascunho: concorrencia otimista. Guardado em ref porque o autosave
  // dispara fora do ciclo de render e precisa do valor mais recente, nao do que
  // estava em escopo quando o efeito montou.
  const rev = useRef(1);
  const ultimoDoc = useRef<Record<string, unknown> | null>(null);
  const [secoes, setSecoes] = useState<readonly SecaoDaFicha[]>([]);
  const [anexos, setAnexos] = useState<readonly Anexo[]>([]);
  const [guiasSadt, setGuiasSadt] = useState<readonly GuiaSadtEmitida[]>([]);
  const [valoresDaFicha, setValoresDaFicha] = useState<Record<string, string>>({});
  // Competencia do CID vigente. Fica em ref porque so e usada no momento de
  // selar, e state aqui provocaria render a cada busca no catalogo.
  const competenciaCid = useRef('');
  /**
   * Quando a guia SP/SADT e emitida.
   *
   * A regra vive em `src/lib/emissao-sadt.ts`, pura e testada — enquanto morava
   * aqui dentro, so o typecheck a cobria. Em ref porque o emissor guarda estado
   * entre renders e recria-lo perderia a guia montada.
   */
  const emissorSadt = useRef(criarEmissorDeSadt({
    enviar: async (g: NovaGuiaSadt) => {
      await apiFetch('/v1/tiss/guias-sadt', {
        method: 'POST',
        body: {
          encounterId: id,
          caraterAtendimento: g.caraterAtendimento,
          tipoAtendimento: g.tipoAtendimento,
          ...(g.indicacaoClinica === null ? {} : { indicacaoClinica: g.indicacaoClinica }),
          procedimentos: g.procedimentos.map((x) => ({
            codigoTabela: x.codigoTabela,
            codigoProcedimento: x.codigoProcedimento,
            descricao: x.descricao,
            quantidade: x.quantidade,
            valorCentavos: x.valorCentavos,
          })),
        },
        clinicId, csrfToken,
      });
    },
    aoFalhar: (e) => {
      // eslint-disable-next-line no-console
      console.error('guia SP/SADT nao emitida ao finalizar', e);
    },
  }));

  useEffect(() => {
    let vivo = true;
    void (async () => {
      try {
        const [contexto, rascunho, config] = await Promise.all([
          apiFetch<Contexto>(`/v1/atendimentos/${id}/contexto`, { clinicId, csrfToken }),
          apiFetch<{ rev: number; payload: Record<string, unknown> }>(
            `/v1/atendimentos/${id}/rascunho`, { clinicId, csrfToken }),
          apiFetch<ConfigDoProntuario>(
            '/v1/configuracoes/prontuario', { clinicId, csrfToken }),
        ]);
        if (!vivo) return;

        rev.current = rascunho.rev;
        const doc = rascunho.payload['doc'];
        if (doc !== undefined && doc !== null) {
          ultimoDoc.current = rascunho.payload;
          setConteudoInicial(textoDoDocumento(doc)
            .split('\n').map((l) => `<p>${l}</p>`).join(''));
        }

        setSecoes(config.secoes);
        setCtx(contexto);
        void recarregarAnexos(contexto.paciente.patientId);
        void recarregarGuiasSadt();
      } catch (e) {
        if (vivo) setErro(e instanceof ApiError ? e.codigo : 'falha_ao_carregar');
      }
    })();
    return () => { vivo = false; };
  }, [id, clinicId, csrfToken]);

  const recarregarAnexos = useCallback(async (patientId: string) => {
    const r = await apiFetch<{ itens: Anexo[] }>(
      `/v1/pacientes/${patientId}/anexos`, { clinicId, csrfToken })
      .catch(() => ({ itens: [] as Anexo[] }));
    setAnexos(r.itens);
  }, [clinicId, csrfToken]);

  const recarregarGuiasSadt = useCallback(async () => {
    const r = await apiFetch<{ itens: GuiaSadtEmitida[] }>(
      `/v1/atendimentos/${id}/guias-sadt`, { clinicId, csrfToken })
      .catch(() => ({ itens: [] as GuiaSadtEmitida[] }));
    setGuiasSadt(r.itens);
  }, [id, clinicId, csrfToken]);

  const salvar = useCallback(async (conteudo: Record<string, unknown>) => {
    ultimoDoc.current = { doc: conteudo };
    try {
      const r = await apiFetch<{ rev: number }>(`/v1/atendimentos/${id}/rascunho`, {
        method: 'PUT',
        body: { expectedRev: rev.current, payload: { doc: conteudo } },
        clinicId, csrfToken,
      });
      rev.current = r.rev;
    } catch (e) {
      // 409 e o outro dispositivo do mesmo medico, ou a mesma aba aberta duas
      // vezes. Reaproveitar a revisao vigente e reenviar sobrescreveria o que o
      // outro lado escreveu; deixar estourar faz o editor mostrar "erro" e o
      // texto continua na tela, que e onde ele ainda pode ser salvo.
      if (e instanceof ApiError && e.status === 409) {
        const atual = e.dados['currentRev'];
        if (typeof atual === 'number') rev.current = atual;
      }
      throw e;
    }
  }, [id, clinicId, csrfToken]);

  if (erro !== null) {
    return (
      <div className="cadencia-page">
        <p className="text-sm text-danger">
          {erro === 'atendimento_nao_encontrado'
            ? 'Este atendimento nao existe nesta unidade.'
            : `Nao foi possivel abrir o atendimento (${erro}).`}
        </p>
      </div>
    );
  }
  if (ctx === null) {
    return <div className="cadencia-page"><p className="text-sm text-text-muted">Carregando…</p></div>;
  }

  return (
    <TelaDeAtendimento
      encounterId={id}
      pacienteNome={ctx.paciente.nome}
      {...(ctx.procedimentoNome === null ? {} : { procedimentoNome: ctx.procedimentoNome })}
      {...(ctx.valorSugeridoCentavos === null
        ? {} : { valorSugeridoCentavos: ctx.valorSugeridoCentavos })}
      inicio={new Date(ctx.inicio)}
      paciente={{
        nome: ctx.paciente.nome,
        ...(ctx.paciente.nascimento === null ? {} : { nascimento: ctx.paciente.nascimento }),
        ...(ctx.paciente.sexo === null ? {} : { sexo: ctx.paciente.sexo }),
        convenio: ctx.paciente.convenio,
        alergias: ctx.alergias,
        // Posologia junto do nome: "Losartana 50mg" sozinho nao diz se o
        // paciente toma um por dia ou tres. Quem checa interacao precisa da dose.
        medicamentos: ctx.medicamentos.map((m) => `${m.nome} — ${m.posologia}`),
        ultimosAtendimentos: ctx.ultimosAtendimentos.map((a) => ({
          data: a.data, procedimento: a.procedimento ?? 'Atendimento',
        })),
      }}
      {...(conteudoInicial === undefined ? {} : { conteudoInicial })}
      onSalvar={salvar}
      aoVoltar={() => router.push('/hoje')}

      abrirSessaoDoPrescritor={async () => {
        // A tela abre a sessao ao montar. Se a Memed estiver fora do ar a
        // CONSULTA continua: o medico examina, escreve e finaliza. So a receita
        // e que nao sai — e o painel diz isso, em vez de girar para sempre.
        try {
          return await apiFetch<{
            mode: string; scriptUrl: string; token: string;
            patientPayload: Record<string, string>;
          }>('/v1/prescricoes/sessao', {
            method: 'POST',
            body: { encounterId: id, patientId: ctx.paciente.patientId },
            clinicId, csrfToken,
          });
        } catch {
          return { mode: 'indisponivel' };
        }
      }}

      buscarCodigo={async (termo) => {
        if (termo.trim().length < 2) return [];
        // `data` e a data do EVENTO, nao hoje: o CID vigente e o da epoca do
        // atendimento (decisao irreversivel 10 — terminologia versionada por
        // daterange). Um atendimento retroativo nao pode receber codigo que so
        // passou a existir depois.
        // Qual catalogo consultar sai da FICHA, nao de uma constante: a mesma
        // clinica pode ter um modelo em CID-10 (faturamento de convenio, que o
        // TISS 4.03.00 ainda exige) e outro em CID-11 (vigilancia, a partir de
        // 2027). As duas terminologias convivem, entao a tela nao escolhe por
        // ninguem — ela pergunta ao campo.
        const usaCid11 = secoes.some(
          (s) => s.campos.some((c) => c.refSource === 'CID11'));
        const rota = usaCid11 ? 'cid11' : 'cid';
        const r = await apiFetch<{
          itens: { codigo: string; descricao: string; competencia: string }[] }>(
          `/v1/catalogos/${rota}?termo=${encodeURIComponent(termo)}&data=${ctx.inicio.slice(0, 10)}`,
          { clinicId, csrfToken });
        // A competencia vem do proprio catalogo, na data do EVENTO. E ela que
        // vai para `terminology_version` da versao selada e responde depois
        // "qual CID valia quando este diagnostico foi feito".
        competenciaCid.current = r.itens[0]?.competencia ?? competenciaCid.current;
        return r.itens.map((x) => ({ code: x.codigo, display: x.descricao }));
      }}

      // Os dois ganchos abaixo estao no contrato do editor mas ele ainda nao os
      // consome: nao ha painel de modelos nem de valor anterior montado. Devolver
      // vazio e honesto; inventar dado para preencher tela nao e.
      buscarModelo={async () => []}
      buscarValorAnterior={async () => null}

      aoConfirmarPrescricao={async ({ providerPrescriptionId }) => {
        // Disparado pelo evento `prescricaoImpressa`: a receita JA existe do lado
        // da Memed quando chegamos aqui. Buscamos os itens e registramos no
        // prontuario, amarrada a este atendimento.
        const r = await apiFetch<{ prescriptionId: string }>('/v1/prescricoes', {
          method: 'POST',
          body: {
            providerPrescriptionId,
            encounterId: id,
            patientId: ctx.paciente.patientId,
          },
          clinicId, csrfToken,
        });
        return r;
      }}

      aoEmitirDocumento={async ({ kind, corpo }) => {
        const r = await apiFetch<{
          documentId: string;
          assinatura: { estado: 'assinado' | 'pendente'; motivo?: string };
        }>('/v1/documentos', {
          method: 'POST',
          body: {
            kind,
            patientId: ctx.paciente.patientId,
            // Amarrado ao atendimento: atestado solto no cadastro do paciente
            // nao diz de qual consulta saiu, e e exatamente isso que a auditoria
            // do convenio pergunta.
            encounterId: id,
            payload: { corpo },
          },
          clinicId, csrfToken,
        });
        // O PDF vem por fetch com cabecalhos, nao por href direto: navegacao do
        // navegador nao manda `x-clinic-id` e a rota devolveria 400 no clique.
        //
        // `assinado` sai do que a API DEVOLVEU, e nao de um otimismo do front:
        // sem PSC ICP-Brasil contratado o documento e emitido e fica pendente, e
        // a tela precisa dizer isso enquanto o medico ainda esta com o paciente.
        return {
          documentId: r.documentId,
          assinado: r.assinatura.estado === 'assinado',
          ...(r.assinatura.motivo === undefined ? {} : { motivo: r.assinatura.motivo }),
          urlPdf: await apiFetchBlobUrl(
            `/v1/documentos/${r.documentId}/pdf`, { clinicId, csrfToken }),
        };
      }}

      convenioDoAtendimento={ctx.paciente.convenio}
      guiasSadt={guiasSadt}
      buscarProcedimentoTuss={async (termo) => {
        if (termo.trim().length < 2) return [];
        // Tabela 22 e a TUSS de procedimentos e eventos em saude — a que a
        // operadora espera numa guia de exame. A data e a do ATENDIMENTO:
        // codigo TUSS tambem tem vigencia, e o exame pedido em marco vale pela
        // tabela de marco, nao pela de hoje.
        const r = await apiFetch<{ itens: { codigo: string; termo: string; tabela: number }[] }>(
          `/v1/catalogos/tuss?tabela=22&termo=${encodeURIComponent(termo)}`
          + `&data=${ctx.inicio.slice(0, 10)}`,
          { clinicId, csrfToken });
        return r.itens;
      }}
      emitirAoFinalizar={ctx.status === 'rascunho'}
      aoEmitirGuiaSadt={async (g) => {
        await emissorSadt.current.compor(g, ctx.status);
        if (ctx.status !== 'rascunho') await recarregarGuiasSadt();
      }}
      anexos={anexos}
      aoEnviarAnexo={async ({ arquivo, kind }) => {
        // Base64 no corpo: o volume aqui e laudo e foto. FileReader em vez de
        // btoa porque btoa quebra em byte acima de 0xFF — e PDF tem muitos.
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
            contentType: arquivo.type === '' ? 'application/octet-stream' : arquivo.type,
            conteudoBase64: btoa(bin),
          },
          clinicId, csrfToken,
        });
        await recarregarAnexos(ctx.paciente.patientId);
      }}
      aoAbrirAnexo={async (attachmentId) => {
        const url = await apiFetchBlobUrl(
          `/v1/anexos/${attachmentId}/conteudo`, { clinicId, csrfToken });
        window.open(url, '_blank', 'noopener');
      }}

      aoTranscrever={async (audio) => {
        const bytes = new Uint8Array(await audio.arrayBuffer());
        let bin = '';
        for (const b of bytes) bin += String.fromCharCode(b);
        const r = await apiFetch<{ sugestao: SugestaoDaIA }>(
          `/v1/atendimentos/${id}/transcricao`, {
            method: 'POST',
            body: { audioBase64: btoa(bin), contentType: audio.type || 'audio/webm' },
            clinicId, csrfToken,
          });
        return r.sugestao;
      }}
      aoAceitarSugestao={(sug, campos) => {
        // A sugestao vira VALOR DE CAMPO da ficha, e nao gravacao direta: entra
        // no mesmo caminho que o medico usaria digitando, e so e selada quando
        // ele finalizar. Aceitar nao e assinar.
        const porCode = new Map(
          secoes.flatMap((sec) => sec.campos).map((c) => [c.code, c]));
        const aplicar = (code: string, valor: string | null): void => {
          const campo = porCode.get(code);
          if (campo === undefined || valor === null) return;
          setValoresDaFicha((v) => ({ ...v, [campo.fieldId]: valor }));
        };
        if (campos.has('alergias')) aplicar('alergias', sug.alergias);
        if (campos.has('pesoKg')) aplicar('peso', sug.pesoKg);
        if (campos.has('alturaCm')) aplicar('altura', sug.alturaCm);
        if (campos.has('pa')) {
          const pa = porCode.get('pa');
          if (pa !== undefined) {
            setValoresDaFicha((v) => ({
              ...v,
              [`${pa.fieldId}:PA_SIS`]: sug.paSistolica ?? '',
              [`${pa.fieldId}:PA_DIA`]: sug.paDiastolica ?? '',
            }));
          }
        }
        if (campos.has('cid') && sug.cid !== null) {
          aplicar('cid', `${sug.cid.codigo}|${sug.cid.descricao}`);
        }
        // A evolucao vai para o EDITOR, nao para a ficha. Ela e o texto narrativo
        // e o editor e quem o guarda.
        if (campos.has('evolucao') && sug.evolucao !== '') {
          setConteudoInicial(sug.evolucao.split(QUEBRA)
            .map((l) => `<p>${l}</p>`).join(''));
        }
      }}

      secoesDaFicha={secoes}
      valoresDaFicha={valoresDaFicha}
      aoMudarFicha={(chave, valor) => {
        setValoresDaFicha((v) => ({ ...v, [chave]: valor }));
      }}

      aoFinalizar={async () => {
        // Uma unica montagem cobre evolucao, alergias, sinais vitais e CID —
        // e ela lanca se nao houver campo de evolucao configurado, em vez de
        // selar uma versao vazia e perder o atendimento em silencio.
        const corpo = montarPayloadClinico({
          secoes,
          valores: valoresDaFicha,
          evolucao: textoDoDocumento(ultimoDoc.current?.['doc']),
          competenciaCid: competenciaCid.current,
        });
        const selada = await apiFetch<{ versionId: string; versionNo: number }>(
          `/v1/atendimentos/${id}/finalizar`,
          { method: 'POST', body: corpo, clinicId, csrfToken });

        // A guia SP/SADT sai AGORA: e neste instante que existe a versao
        // assinada para ela apontar. Mesmo momento em que a guia de consulta e
        // projetada — uma so verdade sobre quando o faturamento existe.
        const r = await emissorSadt.current.aoSelar();
        if (r.emitida) await recarregarGuiasSadt();

        return selada;
      }}

      aoRegistrarPagamento={async (dados) => {
        const metodo = METODO_DA_API[dados.method];
        if (metodo === undefined) {
          // `boleto` existe no painel e nao existe em fin.payment_method_kind.
          // Traduzir para um metodo parecido registraria a receita na forma
          // errada e o fechamento do dia nao bateria com o extrato.
          throw new ApiError('metodo_nao_suportado', 422);
        }
        const r = await apiFetch<{
          paymentId: string; status: string; receiptId: string;
        }>('/v1/payments', {
          method: 'POST',
          body: {
            patientId: ctx.paciente.patientId,
            encounterId: id,
            amountCents: dados.amountCents,
            method: metodo,
            description: ctx.procedimentoNome ?? 'Consulta',
          },
          clinicId, csrfToken,
        });
        // O painel pede um numero de recibo; a API devolve o id do recibo. O
        // numero sequencial e emitido na geracao do PDF, entao aqui vai 0 — que
        // e visivelmente "ainda nao numerado" e nao um numero falso que o
        // paciente anotaria e nao encontraria depois.
        return { entryId: r.paymentId, receiptNumber: 0 };
      }}

      aoCriarLinkPagamento={async (dados) => {
        const criado = await apiFetch<{ paymentLinkId: string }>('/v1/payment-links', {
          method: 'POST',
          body: {
            patientId: ctx.paciente.patientId,
            encounterId: id,
            amountCents: dados.amountCents,
            description: ctx.procedimentoNome ?? 'Consulta',
          },
          clinicId, csrfToken,
        });

        // A criacao no PSP e assincrona (outbox -> worker), entao o POST devolve
        // o lancamento e a URL chega depois. Perguntamos por ~12s: mais que isso
        // e o medico esperando de braco cruzado com o paciente na frente, e a
        // mensagem honesta de "ainda processando" serve melhor que um spinner
        // eterno.
        for (let tentativa = 0; tentativa < 12; tentativa += 1) {
          const st = await apiFetch<{ status: string; url: string | null }>(
            `/v1/payment-links/${criado.paymentLinkId}`, { clinicId, csrfToken });
          if (st.url !== null && st.url !== '') {
            return { linkUrl: st.url, linkId: criado.paymentLinkId };
          }
          await new Promise((r) => setTimeout(r, 1000));
        }
        throw new ApiError('link_ainda_processando', 202);
      }}
    />
  );
}
