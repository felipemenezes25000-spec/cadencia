'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { apiFetch, ApiError } from '../../../src/api';

interface Vaga {
  professionalId: string;
  professionalNome: string;
  inicio: string;
  fim: string;
}

/**
 * A pagina que o PACIENTE ve.
 *
 * Unica tela do produto para quem nao tem conta, e a unica que roda fora do
 * contexto de sessao. Tudo aqui e otimizado para uma pessoa no celular, com
 * pressa, que nao conhece o sistema: tres passos, nenhum jargao, e nenhum campo
 * a mais do que o necessario para marcar.
 *
 * Nao ha CPF, nao ha data de nascimento, nao ha convenio. O cadastro nasce
 * preliminar e a recepcao completa depois — porque quem esta no celular ou
 * desiste, ou inventa, e cadastro inventado vira paciente duplicado.
 */

/**
 * Hora no fuso DA CLINICA, nunca no do aparelho.
 *
 * Sem `timeZone`, o Intl usa o fuso do navegador. O paciente que abre o link de
 * uma clinica de Sao Paulo estando em Portugal via 19:00 onde a agenda diz
 * 14:00 — e marcava confiando no numero errado. Quem manda e o relogio de onde
 * o atendimento acontece.
 */
function hora(iso: string, fuso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: fuso,
  }).format(new Date(iso));
}

function diaLegivel(d: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    weekday: 'short', day: '2-digit', month: '2-digit',
  }).format(new Date(`${d}T12:00:00`));
}

/** Os proximos 14 dias. Agenda aberta demais convida a marcar e esquecer. */
function proximosDias(): string[] {
  const hoje = new Date();
  return Array.from({ length: 14 }, (_, i) => {
    const d = new Date(hoje);
    d.setDate(d.getDate() + i);
    return d.toISOString().slice(0, 10);
  });
}

export default function PaginaAgendarOnline() {
  const { clinicId } = useParams<{ clinicId: string }>();

  const dias = useMemo(proximosDias, []);
  const [procedimentos, setProcedimentos] = useState<
    readonly { procedureId: string; nome: string; duracaoMin: number }[]>([]);
  const [procedureId, setProcedureId] = useState('');
  const [dia, setDia] = useState(dias[0] ?? '');
  const [vagas, setVagas] = useState<readonly Vaga[]>([]);
  const [escolhida, setEscolhida] = useState<Vaga | null>(null);

  const [nome, setNome] = useState('');
  const [telefone, setTelefone] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [marcando, setMarcando] = useState(false);
  const [pronto, setPronto] = useState<Vaga | null>(null);
  // Ate a primeira busca responder nao ha horario na tela, entao o valor
  // inicial nunca chega a ser exibido.
  const [fuso, setFuso] = useState('America/Sao_Paulo');

  useEffect(() => {
    let vivo = true;
    void apiFetch<{ itens: { procedureId: string; nome: string; duracaoMin: number }[] }>(
      `/v1/publico/procedimentos?clinicId=${clinicId}`, { clinicId: '', csrfToken: '' })
      .then((r) => {
        if (!vivo) return;
        setProcedimentos(r.itens);
        // Ja seleciona o primeiro: uma tela que abre pedindo escolha antes de
        // mostrar qualquer horario parece formulario. Abrir com algo escolhido
        // e mostrando horarios parece agenda.
        setProcedureId((atual) => (atual === '' ? r.itens[0]?.procedureId ?? '' : atual));
      })
      .catch(() => { if (vivo) setErro('Nao foi possivel carregar os servicos.'); });
    return () => { vivo = false; };
  }, [clinicId]);

  const buscar = useCallback(async () => {
    if (procedureId === '' || dia === '') return;
    setBuscando(true);
    setErro(null);
    setEscolhida(null);
    try {
      const r = await apiFetch<{ timezone: string; itens: Vaga[] }>(
        `/v1/publico/horarios?clinicId=${clinicId}&dia=${dia}`
        + `&procedureId=${procedureId}`,
        { clinicId: '', csrfToken: '' });
      setVagas(r.itens);
      setFuso(r.timezone);
    } catch {
      setErro('Nao foi possivel carregar os horarios. Tente de novo.');
    } finally {
      setBuscando(false);
    }
  }, [clinicId, dia, procedureId]);

  useEffect(() => { void buscar(); }, [buscar]);

  async function marcar(): Promise<void> {
    if (escolhida === null) return;
    if (nome.trim().length < 2 || telefone.trim().length < 8) {
      setErro('Preencha seu nome e um telefone com DDD.');
      return;
    }
    setMarcando(true);
    setErro(null);
    try {
      await apiFetch('/v1/publico/agendamentos', {
        method: 'POST',
        body: {
          clinicId, professionalId: escolhida.professionalId, procedureId,
          inicio: escolhida.inicio, nome: nome.trim(), telefone: telefone.trim(),
        },
        clinicId: '', csrfToken: '',
      });
      setPronto(escolhida);
    } catch (e) {
      // 409 e o caso comum aqui: alguem pegou a vaga no meio do preenchimento.
      // Dizer "erro" faria a pessoa achar que o sistema quebrou; o que ela
      // precisa e escolher outro horario, com a lista ja atualizada.
      if (e instanceof ApiError && e.status === 409) {
        setErro('Alguem acabou de marcar esse horario. Escolha outro.');
        void buscar();
      } else {
        setErro('Nao foi possivel marcar. Tente de novo.');
      }
    } finally {
      setMarcando(false);
    }
  }

  if (pronto !== null) {
    return (
      <main className="mx-auto max-w-md p-6">
        <div className="rounded-[var(--r-md)] border border-line bg-surface p-6 text-center">
          <h1 className="mb-2 text-lg font-semibold text-text">Consulta marcada</h1>
          <p className="text-sm text-text">
            {diaLegivel(dia)} as <strong>{hora(pronto.inicio, fuso)}</strong>
            <br />com {pronto.professionalNome}
          </p>
          <p className="mt-4 text-sm text-text-muted">
            Guarde este horario. A clinica pode entrar em contato pelo telefone
            que voce informou.
          </p>
        </div>
      </main>
    );
  }

  const entrada = 'w-full rounded-[var(--r-sm)] border border-line bg-surface px-3 py-2.5 text-base text-text focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]';

  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="mb-1 text-lg font-semibold text-text">Marcar consulta</h1>
      <p className="mb-6 text-sm text-text-muted">
        Escolha o dia e o horario. Leva menos de um minuto.
      </p>

      {procedimentos.length > 0 && (
        <label className="mb-4 grid gap-1.5">
          <span className="text-sm font-medium text-text">Servico</span>
          <select value={procedureId} onChange={(e) => setProcedureId(e.target.value)}
            className={entrada}>
            {procedimentos.map((p) => (
              <option key={p.procedureId} value={p.procedureId}>
                {p.nome} · {p.duracaoMin} min
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="mb-4 grid gap-1.5">
        <span className="text-sm font-medium text-text">Dia</span>
        <select value={dia} onChange={(e) => setDia(e.target.value)} className={entrada}>
          {dias.map((d) => (
            <option key={d} value={d}>{diaLegivel(d)}</option>
          ))}
        </select>
      </label>

      {erro !== null && (
        <p role="alert" className="mb-4 text-sm text-danger">{erro}</p>
      )}

      <section className="mb-6">
        <h2 className="mb-2 text-sm font-medium text-text">Horarios livres</h2>
        {buscando && <p className="text-sm text-text-muted">Buscando…</p>}
        {!buscando && vagas.length === 0 && (
          <p className="text-sm text-text-muted">
            Nenhum horario livre neste dia. Tente outro.
          </p>
        )}
        <div className="grid grid-cols-3 gap-2">
          {vagas.map((v) => (
            <button
              key={`${v.professionalId}-${v.inicio}`}
              type="button"
              onClick={() => { setEscolhida(v); setErro(null); }}
              aria-pressed={escolhida?.inicio === v.inicio
                && escolhida?.professionalId === v.professionalId}
              className={
                escolhida?.inicio === v.inicio
                && escolhida?.professionalId === v.professionalId
                  ? 'rounded-[var(--r-sm)] border border-accent bg-accent px-2 py-2.5 text-sm font-medium text-accent-on'
                  : 'rounded-[var(--r-sm)] border border-line px-2 py-2.5 text-sm text-text hover:bg-surface-hover'
              }
            >
              {hora(v.inicio, fuso)}
            </button>
          ))}
        </div>
        {escolhida !== null && (
          <p className="mt-2 text-xs text-text-muted">
            com {escolhida.professionalNome}
          </p>
        )}
      </section>

      {escolhida !== null && (
        <section className="grid gap-4">
          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-text">Seu nome</span>
            <input value={nome} onChange={(e) => setNome(e.target.value)}
              autoComplete="name" className={entrada} />
          </label>
          <label className="grid gap-1.5">
            <span className="text-sm font-medium text-text">Telefone com DDD</span>
            <input value={telefone} onChange={(e) => setTelefone(e.target.value)}
              inputMode="tel" autoComplete="tel" className={entrada} />
          </label>
          <button
            type="button"
            disabled={marcando}
            onClick={() => { void marcar(); }}
            className="rounded-[var(--r-sm)] bg-accent px-4 py-3 text-base font-medium text-accent-on disabled:opacity-60"
          >
            {marcando ? 'Marcando…' : `Marcar ${hora(escolhida.inicio, fuso)}`}
          </button>
          {/* Sem CPF, sem data de nascimento, sem convenio: o cadastro nasce
              preliminar e a recepcao completa. Pedir tudo aqui faz a pessoa
              desistir ou inventar — e dado inventado vira paciente duplicado. */}
          <p className="text-xs text-text-muted">
            Pedimos so o essencial. O resto a clinica confirma na recepcao.
          </p>
        </section>
      )}
    </main>
  );
}
