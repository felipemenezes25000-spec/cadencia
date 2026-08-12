'use client';

import { use } from 'react';
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
import { useCallback, useEffect, useState } from 'react';

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
  status: string;
  profissionalNome: string;
  versionCount: number;
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
  const { clinicId, csrfToken, vinculoAtivo } = useSessao();

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

  // `record.share` é permissão de quem RESPONDE pelo prontuário. A recepção vê
  // o cadastro e não pode abrir o registro clínico para terceiros.
  const podeCompartilhar = vinculoAtivo.role === 'profissional'
    || vinculoAtivo.role === 'diretor_tecnico'
    || vinculoAtivo.role === 'admin_clinico';

  const recarregarCompartilhamentos = useCallback(async () => {
    const r = await apiFetch<{ itens: Compartilhamento[] }>(
      `/v1/pacientes/${id}/compartilhamentos`, { clinicId, csrfToken })
      .catch(() => ({ itens: [] as Compartilhamento[] }));
    setCompartilhamentos(r.itens);
  }, [id, clinicId, csrfToken]);

  // Prontuário é o único dado da tela com policy RESTRICTIVE própria (§10.18):
  // ver o cadastro não implica ver o registro clínico. A tela pergunta as duas
  // coisas separadamente, que é o que permite mostrar "existe, mas você não tem
  // acesso" em vez de fingir que o paciente não existe.
  const podeVerProntuario = vinculoAtivo.role === 'profissional'
    || vinculoAtivo.role === 'diretor_tecnico'
    || vinculoAtivo.role === 'admin_clinico';

  useEffect(() => {
    let vivo = true;
    void (async () => {
      try {
        const p = await apiFetch<PacienteDaApi>(
          `/v1/pacientes/${id}`, { clinicId, csrfToken });
        if (!vivo) return;
        setPaciente(p);

        const pend = await apiFetch<{ pendentes: string[] }>(
          `/v1/pacientes/${id}/pendencias`, { clinicId, csrfToken })
          .catch(() => ({ pendentes: [] as string[] }));
        if (vivo) setPendentes(pend.pendentes);

        const hist = await apiFetch<{ itens: EncontroDaApi[] }>(
          `/v1/pacientes/${id}/prontuario`, { clinicId, csrfToken })
          .catch((e: unknown) => {
            if (e instanceof ApiError && e.status === 403) setSemAcesso(true);
            return { itens: [] as EncontroDaApi[] };
          });
        if (vivo) {
          setAtendimentos(hist.itens.map((x) => ({
            id: x.encounterId,
            tipo: x.status === 'finalizado' ? 'Atendimento' : 'Rascunho',
            data: x.occurredDate,
            resumo: x.versionCount > 1
              ? `${x.versionCount} versões` : 'Registro finalizado',
            profissional: x.profissionalNome,
          })));
        }
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

  /**
   * Exporta o prontuário completo em PDF.
   *
   * Direito do titular (LGPD art. 18, V). A rota existia desde a Fase 3 e não
   * tinha botão: na prática o paciente pedia, e alguém precisava chamar a API
   * na mão — ou o pedido morria.
   *
   * `requesterKind: 'titular'` porque quem clica aqui está atendendo um pedido
   * do próprio paciente. Representante e ordem judicial têm tratamento
   * diferente na rota e merecem tela própria quando aparecerem.
   */
  async function exportarProntuario(): Promise<void> {
    setExportando(true);
    try {
      const r = await apiFetch<{ exportId: string; pageCount: number }>(
        `/v1/pacientes/${id}/exportacoes`, {
          method: 'POST',
          body: { requesterKind: 'titular' },
          clinicId, csrfToken,
        });
      // Blob e não `<a href>`: a navegação do navegador não carrega o cabeçalho
      // `x-clinic-id` e a API responderia 400.
      const url = await apiFetchBlobUrl(
        `/v1/exportacoes/${r.exportId}/pdf`, { clinicId, csrfToken });
      window.open(url, '_blank', 'noopener');
    } catch {
      // Falhar em silêncio num pedido de LGPD é o pior desfecho: o paciente
      // fica esperando um documento que ninguém sabe que não saiu.
      window.alert('Não foi possível gerar a exportação. Tente de novo.');
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
    // Carga preguiçosa: as duas listas só interessam a quem abriu o painel, e
    // pagar dois round trips em toda visita à ficha atrasaria o caso comum.
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
      acoesExtras={(
        <>
          <Botao
            variante="secundario"
            iconeEsquerda={ArrowsClockwise}
            onClick={() => { void abrirRecorrencia(); }}
          >
            Repetir consulta
          </Botao>
          {podeVerProntuario && (
            <Botao
              variante="secundario"
              iconeEsquerda={FileArrowDown}
              carregando={exportando}
              onClick={() => { void exportarProntuario(); }}
            >
              Exportar prontuário
            </Botao>
          )}
          {podeCompartilhar && (
            <Botao
              variante="secundario"
              iconeEsquerda={ShareNetwork}
              onClick={() => { void abrirCompartilhamento(); }}
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
          `/v1/pacientes/${id}/prontuario`, { clinicId, csrfToken });
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
          // DESTE paciente. Sem o filtro, a aba Financeiro da ficha listava os
          // recebíveis da clínica inteira sob o nome de quem estava aberto.
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
      aoSolicitarAcesso={() => { /* pedido de compartilhamento entra depois */ }}
      aoQuebrarVidro={async (justificativa, horas) => {
        // Quebra-vidro é caminho legítimo e AUDITADO: a função do banco registra
        // quem, quando, por que e por quanto tempo, e a clínica é notificada.
        await apiFetch(`/v1/pacientes/${id}/quebra-vidro`, {
          method: 'POST', body: { justificativa, horas }, clinicId, csrfToken });
        setSemAcesso(false);
      }}
    />

    <PainelDeRecorrencia
      aberto={repetindo}
      // A série começa AMANHÃ por padrão: marcar a primeira sessão para hoje,
      // com o paciente já atendido, é o engano mais fácil de cometer aqui.
      dia={amanhaNaClinica(vinculoAtivo.timezone)}
      pacienteNome={paciente.displayName}
      procedimentos={procedimentos}
      aoCriar={async (r): Promise<ResultadoDaSerie> => {
        return await apiFetch<ResultadoDaSerie>('/v1/agenda/recorrencias', {
          method: 'POST',
          body: {
            patientId: id,
            // Sem seletor de profissional nesta tela: cai no primeiro que
            // atende na unidade, como o compositor da agenda já faz. Clínica
            // com dois médicos precisa escolher — e isso é campo a acrescentar,
            // não um palpite que a tela deva esconder.
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
        // Compartilhar com quem já atende o paciente é ruído: o acesso dele
        // vem pela primeira porta da policy, não por esta.
        (x) => !compartilhamentos.some((c) => c.granteeProfessionalId === x.professionalId),
      )}
      aoCompartilhar={async (c) => {
        // O painel entrega PRAZO EM DIAS; virar instante é responsabilidade de
        // quem tem o relógio. Mantém o painel puro e testável sem fingir tempo.
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
