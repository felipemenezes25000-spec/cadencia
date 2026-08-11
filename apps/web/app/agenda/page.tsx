'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQueryState, parseAsStringLiteral } from 'nuqs';
import { Agenda } from '../../src/telas/Agenda';
import {
  CompositorInline, type ConvenioOpcao, type ProcedimentoOpcao,
} from '../../src/telas/CompositorInline';
import type { LinhaDaFila } from '../../src/telas/Hoje';
import type { Visao } from '../../src/telas/grade';
import type { PacienteHit } from '../../src/ui/ComboboxDePaciente';
import type { PatientQuickSummary } from '../../src/components/patients/PatientQuickView';
import { PainelDeBloqueios, type Bloqueio } from '../../src/ui/PainelDeBloqueios';
import { Botao } from '../../src/ui/Botao';
import { ListBullets, Printer, Prohibit } from '@phosphor-icons/react';
import { apiFetch } from '../../src/api';
import { useSessao } from '../../src/sessao';
import { diaNaClinica } from '../../src/lib/fuso';

const CHAVES_VISAO = ['dia', 'semana', 'mes', 'profissional', 'sala'] as const;

interface ProcedimentoDaApi {
  procedureId: string;
  nome: string;
  duracaoMin: number;
  maisFrequente: boolean;
}

interface PacienteDaApi {
  readonly patientId: string;
  readonly displayName: string;
  readonly legalName: string;
  readonly hasSocialName: boolean;
  readonly birthDate: string | null;
  readonly phonePrimary: string | null;
  readonly email: string | null;
  readonly cadastroStatus: 'completo' | 'preliminar';
}

/** Hora de parede do dia selecionado, sem fuso. E o que o compositor exibe. */
function paredeDe(dia: string, minutoDoDia: number): string {
  const h = String(Math.floor(minutoDoDia / 60)).padStart(2, '0');
  const m = String(minutoDoDia % 60).padStart(2, '0');
  return `${dia}T${h}:${m}:00`;
}

/**
 * A mesma hora de parede, agora como instante absoluto no fuso da CLINICA.
 *
 * `POST /v1/agenda/agendamentos` exige ISO com fuso, e o fuso certo nao e o do
 * navegador: a recepcionista pode estar em casa, em outro estado, marcando na
 * agenda de Manaus. Quem define o instante e a unidade onde o paciente sera
 * atendido. O deslocamento e descoberto perguntando ao proprio Intl qual e o
 * offset daquele fuso naquela data — o que resolve horario de verao sozinho.
 */
function instanteNaClinica(dia: string, minutoDoDia: number, fuso: string): string {
  const parede = new Date(`${paredeDe(dia, minutoDoDia)}Z`);
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: fuso, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = Object.fromEntries(
    fmt.formatToParts(parede).filter((x) => x.type !== 'literal')
      .map((x) => [x.type, x.value]));
  const comoSeUtc = Date.UTC(
    Number(p['year']), Number(p['month']) - 1, Number(p['day']),
    Number(p['hour']), Number(p['minute']), Number(p['second']));
  return new Date(parede.getTime() * 2 - comoSeUtc).toISOString();
}

/** 'AAAA-MM-DDTHH:MM' -> minutos desde a meia-noite, sem tocar em fuso. */
function minutoDoDia(parede: string): number {
  return Number(parede.slice(11, 13)) * 60 + Number(parede.slice(14, 16));
}

function AgendaInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { clinicId, csrfToken, vinculoAtivo } = useSessao();
  const [visao, setVisao] = useQueryState('visao',
    parseAsStringLiteral(CHAVES_VISAO).withDefault('semana'));
  const [dia, setDia] = useQueryState('dia',
    { defaultValue: diaNaClinica(new Date().toISOString(), vinculoAtivo.timezone) });

  const [procedimentos, setProcedimentos] = useState<readonly ProcedimentoOpcao[]>([]);
  const [convenios, setConvenios] = useState<readonly ConvenioOpcao[]>([]);
  const [profissionais, setProfissionais] = useState<
    readonly { professionalId: string; nome: string }[]>([]);
  const [compositorEm, setCompositorEm] = useState<number | null>(null);
  const [recarga, setRecarga] = useState(0);
  const [bloqueando, setBloqueando] = useState(false);
  const [bloqueios, setBloqueios] = useState<readonly Bloqueio[]>([]);
  const [pacienteInicial, setPacienteInicial] = useState<PacienteHit | null>(null);

  // O fuso vem da UNIDADE ATIVA, nao de uma constante: uma rede com clinica em
  // Manaus e outra em Sao Paulo tem duas agendas com relogios diferentes, e
  // quem esta olhando pode nao estar em nenhuma das duas cidades.
  const FUSO = vinculoAtivo.timezone;

  useEffect(() => {
    const novo = searchParams.get('novo') === '1';
    const patientId = searchParams.get('patientId');
    if (!novo && !patientId) return;

    const partes = new Intl.DateTimeFormat('pt-BR', {
      timeZone: FUSO, hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date()).split(':').map(Number);
    const minutoAtual = (partes[0] ?? 8) * 60 + (partes[1] ?? 0);
    setCompositorEm(Math.min(19 * 60 + 45, Math.max(7 * 60, Math.ceil(minutoAtual / 15) * 15)));

    if (!patientId) return;
    let vivo = true;
    void apiFetch<PacienteHit>(`/v1/pacientes/${patientId}`, { clinicId, csrfToken })
      .then((paciente) => { if (vivo) setPacienteInicial(paciente); })
      .catch(() => { if (vivo) setPacienteInicial(null); });
    return () => { vivo = false; };
  }, [FUSO, clinicId, csrfToken, searchParams]);

  function fecharCompositor(): void {
    setCompositorEm(null);
    setPacienteInicial(null);
    const proxima = new URLSearchParams(searchParams.toString());
    proxima.delete('novo');
    proxima.delete('patientId');
    const query = proxima.toString();
    router.replace(query ? `/agenda?${query}` : '/agenda', { scroll: false });
  }

  const recarregarBloqueios = useCallback(async () => {
    const r = await apiFetch<{ itens: Bloqueio[] }>(
      `/v1/agenda/bloqueios?de=${dia}&ate=${dia}`, { clinicId, csrfToken })
      .catch(() => ({ itens: [] as Bloqueio[] }));
    setBloqueios(r.itens);
  }, [dia, clinicId, csrfToken]);

  // Reabrir a lista quando o dia muda: com o painel aberto, navegar para outro
  // dia mostrando os bloqueios do dia anterior faria a recepcao remover o
  // bloqueio errado.
  useEffect(() => {
    if (bloqueando) void recarregarBloqueios();
  }, [bloqueando, recarregarBloqueios]);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      const [p, o, prof] = await Promise.all([
        apiFetch<{ itens: ProcedimentoDaApi[] }>(
          '/v1/procedimentos', { clinicId, csrfToken }),
        apiFetch<{ itens: { nome: string }[] }>(
          '/v1/tiss/operadoras', { clinicId, csrfToken })
          .catch(() => ({ itens: [] as { nome: string }[] })),
        apiFetch<{ itens: { professionalId: string; nome: string }[] }>(
          '/v1/profissionais', { clinicId, csrfToken }),
      ]);
      if (!vivo) return;
      setProfissionais(prof.itens);
      setProcedimentos(p.itens.map((x) => ({
        id: x.procedureId, nome: x.nome,
        duracaoMin: x.duracaoMin, maisFrequente: x.maisFrequente,
      })));
      // Particular vem primeiro e sempre existe: e a opcao mais usada em
      // clinica de qualquer porte, e nao esta em tiss.operadora porque nao e
      // convenio nenhum.
      setConvenios([
        { nome: 'Particular', ultimoDoPaciente: false },
        ...o.itens.map((x) => ({ nome: x.nome, ultimoDoPaciente: false })),
      ]);
    })();
    return () => { vivo = false; };
  }, [clinicId, csrfToken]);

  const carregarDia = useCallback(
    (d: string) => apiFetch<{ fila: LinhaDaFila[] }>(
      `/v1/agenda/dia?dia=${d}&_r=${recarga}`, { clinicId, csrfToken })
      .then((r) => r.fila),
    [clinicId, csrfToken, recarga]);

  return (
    <>
      <Agenda
        dia={dia}
        visao={visao as Visao['chave']}
        timezone={FUSO}
        aoMudarVisao={(v) => { void setVisao(v); }}
        aoMudarDia={(d) => { void setDia(d); }}
        // /v1/agenda/dia devolve { contadores, fila }; a grade quer so a fila.
        // Passar o envelope inteiro rebenta em `itensColuna.map is not a function`.
        carregar={carregarDia}
        acoesExtras={<>
          <Botao variante="fantasma" tamanho="sm" iconeEsquerda={ListBullets} onClick={() => router.push('/agenda/lista-espera')}>Lista de espera</Botao>
          <Botao variante="fantasma" tamanho="sm" iconeEsquerda={Printer} onClick={() => router.push(`/agenda/imprimir?dia=${dia}`)}>Imprimir</Botao>
          <Botao variante="secundario" tamanho="sm" iconeEsquerda={Prohibit} onClick={() => setBloqueando(true)}>Bloquear</Botao>
        </>}
        aoAbrirCompositor={(inicioMin) => setCompositorEm(inicioMin)}
        aoMover={async (appointmentId, diaDoSlot, minuto) => {
          // A grade entrega dia + minuto de parede; o instante e montado aqui,
          // no fuso da unidade, como em toda outra escrita de agenda desta tela.
          await apiFetch(`/v1/agenda/agendamentos/${appointmentId}`, {
            method: 'PATCH',
            body: { startsAt: instanteNaClinica(diaDoSlot, minuto, FUSO) },
            clinicId, csrfToken });
          setRecarga((n) => n + 1);
        }}
        aoConfirmar={async (appointmentId) => {
          await apiFetch(`/v1/agenda/agendamentos/${appointmentId}/status`, {
            method: 'POST', body: { status: 'confirmado' }, clinicId, csrfToken });
          setRecarga((n) => n + 1);
        }}
        carregarResumoPaciente={async (patientId) => {
          const [paciente, pendencias] = await Promise.all([
            apiFetch<PacienteDaApi>(`/v1/pacientes/${patientId}`, { clinicId, csrfToken }),
            apiFetch<{ pendentes: string[] }>(`/v1/pacientes/${patientId}/pendencias`, { clinicId, csrfToken })
              .catch(() => ({ pendentes: [] as string[] })),
          ]);
          return { ...paciente, pendentes: pendencias.pendentes } satisfies PatientQuickSummary;
        }}
        aoAbrirPaciente={(patientId) => router.push(`/pacientes/${patientId}`)}
        aoAbrirAtendimento={(item) => {
          if (item.encounterId) router.push(`/atendimentos/${item.encounterId}`);
        }}
        aoCobrar={(item) => {
          router.push(`/financeiro/a-receber?patientId=${item.patientId}`);
        }}
      />

      {compositorEm !== null && (
        <CompositorInline
          aberto
          inicioIso={paredeDe(dia, compositorEm)}
          {...(pacienteInicial ? { pacienteInicial } : {})}
          procedimentos={procedimentos}
          convenios={convenios}
          buscarPacientes={(termo) => apiFetch<{ itens: PacienteHit[] }>(
            `/v1/pacientes?termo=${encodeURIComponent(termo)}`, { clinicId, csrfToken })
            .then((r) => r.itens)}
          aoCriarPaciente={async (nome) => {
            // Cadastro MINIMO: nome e o bastante para agendar. Exigir CPF e data
            // de nascimento na recepcao, com o paciente no balcao e fila atras,
            // e o que faz a recepcionista inventar dado — e cadastro inventado
            // depois vira paciente duplicado.
            const r = await apiFetch<{ patientId: string }>('/v1/pacientes', {
              method: 'POST', body: { fullName: nome }, clinicId, csrfToken });
            return { patientId: r.patientId, displayName: nome };
          }}
          aoAgendar={async (i) => {
            const r = await apiFetch<{ appointmentId: string }>(
              '/v1/agenda/agendamentos', {
                method: 'POST',
                body: {
                  patientId: i.patientId,
                  // Sem seletor de profissional no compositor: cai no primeiro
                  // que atende na unidade. Uma clinica com dois medicos precisa
                  // escolher, e isso e campo a acrescentar no componente — nao
                  // um palpite que a pagina deva esconder.
                  professionalId: profissionais[0]?.professionalId ?? '',
                  procedureId: i.procedureId,
                  // Dia e hora vem do FORMULARIO, nao do slot clicado. O slot
                  // so pre-preenche os campos; se o usuario corrigiu a data ou
                  // o horario, e a correcao que vale — antes ela era ignorada.
                  startsAt: instanteNaClinica(
                    i.data,
                    Number(i.horario.slice(0, 2)) * 60 + Number(i.horario.slice(3, 5)),
                    FUSO),
                  encaixe: i.encaixe,
                  ...(i.operadoraNome === 'Particular' || i.operadoraNome === ''
                    ? {} : { operadoraNome: i.operadoraNome }),
                },
                clinicId, csrfToken,
              });
            fecharCompositor();
            setRecarga((n) => n + 1);
            return { appointmentId: r.appointmentId };
          }}
          aoFechar={fecharCompositor}
        />
      )}

      <PainelDeBloqueios
        aberto={bloqueando}
        dia={dia}
        timezone={FUSO}
        bloqueios={bloqueios}
        profissionais={profissionais}
        aoCriar={async (b) => {
          // O painel entrega HORA DE PAREDE. A conversao para instante usa o
          // fuso da UNIDADE — a mesma funcao que o compositor ja usa — porque a
          // recepcionista pode estar em casa, em outro estado, marcando na
          // agenda de Manaus.
          await apiFetch('/v1/agenda/bloqueios', {
            method: 'POST',
            body: {
              startsAt: instanteNaClinica(dia, minutoDoDia(b.inicioParede), FUSO),
              endsAt: instanteNaClinica(dia, minutoDoDia(b.fimParede), FUSO),
              kind: b.kind,
              motivo: b.motivo,
              ...(b.professionalId === null ? {} : { professionalId: b.professionalId }),
            },
            clinicId, csrfToken,
          });
          // Erro nao e tratado aqui de proposito: o painel distingue
          // `bloqueio_sobreposto` pelo `codigo` do ApiError e transforma em
          // frase. Engolir aqui viraria "nao foi possivel", sem dizer o motivo.
          await recarregarBloqueios();
          setRecarga((n) => n + 1);
        }}
        aoRemover={async (blockId) => {
          await apiFetch(`/v1/agenda/bloqueios/${blockId}`, {
            method: 'DELETE', clinicId, csrfToken });
          await recarregarBloqueios();
          setRecarga((n) => n + 1);
        }}
        aoFechar={() => setBloqueando(false)}
      />
    </>
  );
}

export default function PaginaAgenda() {
  return (
    <Suspense>
      <AgendaInner />
    </Suspense>
  );
}
