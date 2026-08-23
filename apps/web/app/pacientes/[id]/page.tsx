'use client';

import { use } from 'react';
import { useRouter } from 'next/navigation';
import {
  FichaDoPaciente, type AtendimentoResumo, type LancamentoResumo,
  type MensagemResumo, type PapelNaTela,
} from '../../../src/telas/FichaDoPaciente';
import type { ContatoPayload } from '../../../src/telas/SecaoContato';
import type { PacienteHit } from '../../../src/ui/ComboboxDePaciente';
import {
  PainelDeCompartilhamento, type Compartilhamento,
} from '../../../src/ui/PainelDeCompartilhamento';
import { Botao } from '../../../src/ui/Botao';
import {
  PainelDeRecorrencia, type ProcedimentoOpcao, type ResultadoDaSerie,
} from '../../../src/ui/PainelDeRecorrencia';
import { ShareNetwork, ArrowsClockwise, FileArrowDown } from '@phosphor-icons/react';
import { apiFetch, apiFetchBlobUrl, ApiError } from '../../../src/api';
import { useSessao } from '../../../src/sessao';
import { useToast } from '../../../src/ui/useToast';
import { useCallback, useEffect, useState } from 'react';
import { carregarDocumentosDoPaciente } from '../../../src/telas/documentos-do-paciente';

interface PacienteDaApi extends PacienteHit {
  email: string | null;
  phoneSecondary: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  inativoEm: string | null;
  obitoEm: string | null;
}

interface EncontroDaApi {
  encounterId: string;
  occurredDate: string;
  status: 'rascunho' | 'finalizado' | 'anulado';
  profissionalNome: string;
  procedimentoNome: string | null;
  versionCount: number;
  resumoClinico: string | null;
  diagnosticos: string[];
  sinaisVitais: string[];
  achados: string[];
  prescricoes: number;
  documentos: number;
  examesSolicitados: number;
  resultadosExames: number;
}

function resumoDoAtendimento(x: EncontroDaApi): string {
  if (x.status === 'rascunho') return 'Rascunho em andamento — conteúdo ainda não selado.';
  if (x.status === 'anulado') return 'Atendimento anulado; as versões e a trilha permanecem preservadas.';

  const partes: string[] = [];
  const narrativa = x.resumoClinico?.replace(/\s+/g, ' ').trim();
  if (narrativa) partes.push(narrativa);
  if (x.diagnosticos.length > 0) partes.push(`Diagnósticos: ${x.diagnosticos.slice(0, 3).join('; ')}`);
  if (x.sinaisVitais.length > 0) partes.push(`Sinais vitais: ${x.sinaisVitais.slice(0, 4).join(' · ')}`);
  if (x.achados.length > 0) partes.push(`Achados: ${x.achados.slice(0, 4).join(', ')}`);

  const artefatos: string[] = [];
  if (x.prescricoes > 0) artefatos.push(`${x.prescricoes} prescriç${x.prescricoes === 1 ? 'ão' : 'ões'}`);
  if (x.examesSolicitados > 0) artefatos.push(`${x.examesSolicitados} pedido${x.examesSolicitados === 1 ? '' : 's'} de exame`);
  if (x.resultadosExames > 0) artefatos.push(`${x.resultadosExames} resultado${x.resultadosExames === 1 ? '' : 's'} de exame`);
  const outrosDocumentos = Math.max(0, x.documentos - x.examesSolicitados);
  if (outrosDocumentos > 0) artefatos.push(`${outrosDocumentos} outro${outrosDocumentos === 1 ? '' : 's'} documento${outrosDocumentos === 1 ? '' : 's'}`);
  if (artefatos.length > 0) partes.push(artefatos.join(' · '));
  if (x.versionCount > 1) partes.push(`${x.versionCount} versões preservadas`);

  return partes.join(' · ') || 'Registro clínico finalizado.';
}

/**
 * Amanhã no fuso da CLÍNICA, 'AAAA-MM-DD'.
 *
 * Não `new Date()` cru: quem olha pode estar em outro estado, e entre 21h e
 * meia-noite em São Paulo o dia do navegador já virou enquanto o da clínica
 * não. A série começaria um dia adiantada — e o paciente perderia a primeira
 * sessão sem ninguém entender por quê.
 */
function amanhaNaClinica(timezone: string): string {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(Date.now() + 86_400_000));
  const pega = (t: string): string =>
    partes.find((x) => x.type === t)?.value ?? '';
  return `${pega('year')}-${pega('month')}-${pega('day')}`;
}

export default function PaginaFichaDoPaciente(
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = use(params);
  const router = useRouter();
  const { clinicId, csrfToken, vinculoAtivo } = useSessao();
  const { toast } = useToast();

  const [paciente, setPaciente] = useState<PacienteDaApi | null>(null);
  const [pendentes, setPendentes] = useState<readonly string[]>([]);
  const [atendimentos, setAtendimentos] = useState<readonly AtendimentoResumo[]>([]);
  const [semAcesso, setSemAcesso] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [compartilhando, setCompartilhando] = useState(false);
  const [repetindo, setRepetindo] = useState(false);
  const [exportando, setExportando] = useState(false);
  const [procedimentos, setProcedimentos] = useState<readonly ProcedimentoOpcao[]>([]);
  const [compartilhamentos, setCompartilhamentos] =
    useState<readonly Compartilhamento[]>([]);
  const [profissionais, setProfissionais] = useState<
    readonly { professionalId: string; nome: string }[]>([]);

  const podeCompartilhar = vinculoAtivo.role === 'profissional'
    || vinculoAtivo.role === 'diretor_tecnico'
    || vinculoAtivo.role === 'admin_clinico';

  const recarregarCompartilhamentos = useCallback(async () => {
    const r = await apiFetch<{ itens: Compartilhamento[] }>(
      `/v1/pacientes/${id}/compartilhamentos`, { clinicId, csrfToken })
      .catch(() => ({ itens: [] as Compartilhamento[] }));
    setCompartilhamentos(r.itens);
  }, [id, clinicId, csrfToken]);

  const podeVerProntuario = vinculoAtivo.role === 'profissional'
    || vinculoAtivo.role === 'diretor_tecnico'
    || vinculoAtivo.role === 'admin_clinico';

  useEffect(() => {
    let vivo = true;
    void (async () => {
      try {
        const [p, pend, hist] = await Promise.all([
          apiFetch<PacienteDaApi>(`/v1/pacientes/${id}`, { clinicId, csrfToken }),
          apiFetch<{ pendentes: string[] }>(
            `/v1/pacientes/${id}/pendencias`, { clinicId, csrfToken })
            .catch(() => ({ pendentes: [] as string[] })),
          apiFetch<{ itens: EncontroDaApi[] }>(
            `/v1/pacientes/${id}/prontuario-longitudinal`, { clinicId, csrfToken })
            .catch((e: unknown) => {
              if (e instanceof ApiError && e.status === 403 && vivo) setSemAcesso(true);
              return { itens: [] as EncontroDaApi[] };
            }),
        ]);
        if (!vivo) return;
        setPaciente(p);
        setPendentes(pend.pendentes);
        setAtendimentos(hist.itens.map((x) => ({
          id: x.encounterId,
          tipo: x.status === 'finalizado'
            ? (x.procedimentoNome ?? 'Atendimento')
            : x.status === 'anulado' ? 'Atendimento anulado' : 'Rascunho',
          data: x.occurredDate,
          resumo: resumoDoAtendimento(x),
          profissional: x.profissionalNome,
        })));
      } finally {
        if (vivo) setCarregando(false);
      }
    })();
    return () => { vivo = false; };
  }, [id, clinicId, csrfToken]);

  if (paciente === null) {
    return (
      <div className="cadencia-page grid min-h-[50vh] place-items-center">
        <p className="text-sm text-text-muted">
          {carregando ? 'Carregando…' : 'Paciente não encontrado nesta unidade.'}
        </p>
      </div>
    );
  }

  async function exportarProntuario(): Promise<void> {
    setExportando(true);
    try {
      const r = await apiFetch<{ exportId: string; pageCount: number }>(
        `/v1/pacientes/${id}/exportacoes`, {
          method: 'POST',
          body: { requesterKind: 'titular' },
          clinicId, csrfToken,
        });
      const url = await apiFetchBlobUrl(
        `/v1/exportacoes/${r.exportId}/pdf`, { clinicId, csrfToken });
      window.open(url, '_blank', 'noopener');
    } catch {
      toast({ tipo: 'erro', mensagem: 'Não foi possível gerar a exportação. Tente de novo.' });
    } finally {
      setExportando(false);
    }
  }

  async function abrirRecorrencia(): Promise<void> {
    setRepetindo(true);
    const [proc, prof] = await Promise.all([
      apiFetch<{ itens: { procedureId: string; nome: string; duracaoMin: number }[] }>(
        '/v1/procedimentos', { clinicId, csrfToken })
        .catch(() => ({ itens: [] as { procedureId: string; nome: string; duracaoMin: number }[] })),
      apiFetch<{ itens: { professionalId: string; nome: string }[] }>(
        '/v1/profissionais', { clinicId, csrfToken })
        .catch(() => ({ itens: [] as { professionalId: string; nome: string }[] })),
    ]);
    setProcedimentos(proc.itens.map(
      (x) => ({ id: x.procedureId, nome: x.nome, duracaoMin: x.duracaoMin })));
    setProfissionais(prof.itens);
  }

  async function abrirCompartilhamento(): Promise<void> {
    setCompartilhando(true);
    const prof = await apiFetch<{ itens: { professionalId: string; nome: string }[] }>(
      '/v1/profissionais', { clinicId, csrfToken })
      .catch(() => ({ itens: [] as { professionalId: string; nome: string }[] }));
    setProfissionais(prof.itens);
    await recarregarCompartilhamentos();
  }

  return (
    <>
    <FichaDoPaciente
      paciente={paciente}
      contato={{
        email: paciente.email,
        phoneSecondary: paciente.phoneSecondary,
        emergencyContactName: paciente.emergencyContactName,
        emergencyContactPhone: paciente.emergencyContactPhone,
      }}
      aoSalvarContato={async (dados: ContatoPayload) => {
        await apiFetch(`/v1/pacientes/${id}/contato`, {
          method: 'PATCH', body: dados, clinicId, csrfToken });
        const p = await apiFetch<PacienteDaApi>(
          `/v1/pacientes/${id}`, { clinicId, csrfToken });
        setPaciente(p);
      }}
      papel={vinculoAtivo.role as PapelNaTela}
      aoMensagem={() => router.push(`/conversas?patientId=${id}`)}
      aoNovoAtendimento={() => router.push(`/agenda?novo=1&patientId=${id}`)}
      acoesExtras={(
        <>
          <Botao
            variante="secundario"
            iconeEsquerda={ArrowsClockwise}
            onClick={() => abrirRecorrencia()}
          >
            Repetir consulta
          </Botao>
          {podeVerProntuario && (
            <Botao
              variante="secundario"
              iconeEsquerda={FileArrowDown}
              carregando={exportando}
              onClick={() => exportarProntuario()}
            >
              Exportar prontuário
            </Botao>
          )}
          {podeCompartilhar && (
            <Botao
              variante="secundario"
              iconeEsquerda={ShareNetwork}
              onClick={() => abrirCompartilhamento()}
            >
              Compartilhar
            </Botao>
          )}
        </>
      )}
      pendentes={pendentes}
      prontuarioAcessivel={podeVerProntuario && !semAcesso}
      existeMasSemAcesso={semAcesso}
      carregando={carregando}
      atendimentos={atendimentos}
      podeVerFinanceiro={vinculoAtivo.role !== 'recepcao'}
      carregarProntuario={async () => {
        const r = await apiFetch<{ itens: EncontroDaApi[] }>(
          `/v1/pacientes/${id}/prontuario-longitudinal`, { clinicId, csrfToken });
        return r.itens;
      }}
      carregarConversas={async () => {
        const r = await apiFetch<{
          itens: { conversationId: string; patientId: string | null;
                   lastMessageBody: string; lastMessageAt: string | null;
                   lastMessageDirection: 'inbound' | 'outbound' | null }[] }>(
          '/v1/conversations', { clinicId, csrfToken });
        const msgs: MensagemResumo[] = r.itens
          .filter((c) => c.patientId === id)
          .map((c) => ({
            messageId: c.conversationId,
            direction: c.lastMessageDirection ?? 'outbound',
            bodyPreview: c.lastMessageBody,
            sentAt: c.lastMessageAt ?? '',
            status: 'delivered' as const,
          }));
        return msgs;
      }}
      carregarFinanceiro={async () => {
        const r = await apiFetch<{
          entradas: { id: string; description: string; amountCents: number;
                      dueDate: string; daysPastDue: number }[] }>(
          `/v1/financeiro/a-receber?patientId=${id}`, { clinicId, csrfToken });
        const itens: LancamentoResumo[] = r.entradas.map((e) => ({
          entryId: e.id,
          description: e.description,
          amountCents: e.amountCents,
          status: e.daysPastDue > 0 ? 'overdue' as const : 'pending' as const,
          dueDate: e.dueDate,
          paidAt: null,
        }));
        return itens;
      }}
      carregarDocumentos={async () => {
        return carregarDocumentosDoPaciente(
          () => apiFetch<{
            itens: { documentId: string; kind: string; titulo: string;
                     issuedDate: string; createdAt: string; assinado: boolean }[];
          }>(`/v1/pacientes/${id}/documentos`, { clinicId, csrfToken }),
          () => apiFetch<{
            itens: { attachmentId: string; kind: string; originalName: string;
                     sizeBytes: number; criadoEm: string }[];
          }>(`/v1/pacientes/${id}/anexos`, { clinicId, csrfToken }),
        );
      }}
      aoAbrirDocumento={async (documento) => {
        try {
          const caminho = documento.origem === 'emitido'
            ? `/v1/documentos/${documento.id}/pdf`
            : `/v1/anexos/${documento.id}/conteudo`;
          const url = await apiFetchBlobUrl(caminho, { clinicId, csrfToken });
          window.open(url, '_blank', 'noopener');
        } catch {
          toast({ tipo: 'erro', mensagem: 'Não foi possível abrir o documento.' });
        }
      }}
      aoSolicitarAcesso={() => { /* pedido de compartilhamento entra depois */ }}
      aoQuebrarVidro={async (justificativa, horas) => {
        await apiFetch(`/v1/pacientes/${id}/quebra-vidro`, {
          method: 'POST', body: { justificativa, horas }, clinicId, csrfToken });
        setSemAcesso(false);
      }}
    />

    <PainelDeRecorrencia
      aberto={repetindo}
      dia={amanhaNaClinica(vinculoAtivo.timezone)}
      pacienteNome={paciente.displayName}
      procedimentos={procedimentos}
      aoCriar={async (r): Promise<ResultadoDaSerie> => {
        return await apiFetch<ResultadoDaSerie>('/v1/agenda/recorrencias', {
          method: 'POST',
          body: {
            patientId: id,
            professionalId: profissionais[0]?.professionalId ?? '',
            procedureId: r.procedureId,
            primeiraData: r.primeiraData,
            hora: r.hora,
            freq: r.freq,
            intervalo: r.intervalo,
            horizonteAte: r.horizonteAte,
          },
          clinicId, csrfToken,
        });
      }}
      aoFechar={() => setRepetindo(false)}
    />

    <PainelDeCompartilhamento
      aberto={compartilhando}
      paciente={paciente.displayName}
      timezone={vinculoAtivo.timezone}
      itens={compartilhamentos}
      profissionais={profissionais.filter(
        (x) => !compartilhamentos.some((c) => c.granteeProfessionalId === x.professionalId),
      )}
      aoCompartilhar={async (c) => {
        const expira = c.diasDeValidade === null
          ? {}
          : { expiraEm: new Date(Date.now() + c.diasDeValidade * 86_400_000).toISOString() };
        await apiFetch('/v1/compartilhamentos', {
          method: 'POST',
          body: {
            patientId: id,
            granteeProfessionalId: c.granteeProfessionalId,
            reason: c.reason,
            ...expira,
          },
          clinicId, csrfToken,
        });
        await recarregarCompartilhamentos();
      }}
      aoRevogar={async (shareId) => {
        await apiFetch(`/v1/compartilhamentos/${shareId}`, {
          method: 'DELETE', clinicId, csrfToken });
        await recarregarCompartilhamentos();
      }}
      aoFechar={() => setCompartilhando(false)}
    />
    </>
  );
}
