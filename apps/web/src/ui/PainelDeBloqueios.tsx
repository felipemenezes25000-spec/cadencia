// apps/web/src/ui/PainelDeBloqueios.tsx
'use client';

import { useState } from 'react';
import { Prohibit, Trash } from '@phosphor-icons/react';
import { PainelLateral } from './PainelLateral';
import { Botao } from './Botao';

export interface Bloqueio {
  readonly blockId: string;
  readonly kind: string;
  readonly motivo: string;
  /** Instante absoluto. O deslocamento e o da sessao do Postgres, nao o da unidade. */
  readonly startsAt: string;
  readonly endsAt: string;
  readonly professionalId: string | null;
  readonly professionalNome: string | null;
}

export interface NovoBloqueio {
  /** 'AAAA-MM-DDTHH:MM' sem fuso. Quem converte e a pagina. */
  readonly inicioParede: string;
  readonly fimParede: string;
  readonly kind: string;
  readonly motivo: string;
  readonly professionalId: string | null;
}

export interface PainelDeBloqueiosProps {
  readonly aberto: boolean;
  /** Dia exibido, 'AAAA-MM-DD'. */
  readonly dia: string;
  /** Fuso da unidade (`vinculoAtivo.timezone`). Define o relogio exibido. */
  readonly timezone: string;
  readonly bloqueios: readonly Bloqueio[];
  readonly profissionais: readonly { professionalId: string; nome: string }[];
  readonly aoCriar: (b: NovoBloqueio) => Promise<void>;
  readonly aoRemover: (blockId: string) => Promise<void>;
  readonly aoFechar: () => void;
}

const TIPOS: readonly { id: string; rotulo: string }[] = [
  { id: 'almoco', rotulo: 'Almoco' },
  { id: 'ausencia', rotulo: 'Ausencia' },
  { id: 'feriado', rotulo: 'Feriado' },
  { id: 'manutencao', rotulo: 'Manutencao' },
  { id: 'bloqueio', rotulo: 'Outro bloqueio' },
];

const ROTULO_KIND = Object.fromEntries(TIPOS.map((t) => [t.id, t.rotulo]));

/**
 * O relogio da CLINICA para um instante absoluto.
 *
 * `to_char(..., 'OF:00')` na rota formata no fuso da SESSAO do Postgres — que e
 * UTC —, e nao no da unidade: o fuso da clinica so entra no `WHERE`, para
 * filtrar o intervalo. Entao o ISO que chega diz 15:00+00 para o almoco das
 * 12:00 em Sao Paulo. Ler os caracteres 11..16 mostraria o relogio de Greenwich
 * para quem esta na clinica, e a recepcao marcaria consulta em cima do almoco.
 *
 * Recortar tambem nao serviria para o fuso do navegador: quem olha pode estar em
 * casa, em outro estado. O unico relogio certo aqui e o da unidade.
 */
function horaNaClinica(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(iso));
}

/**
 * Bloqueios da agenda: almoco, ausencia, feriado, manutencao de sala.
 *
 * O painel NAO calcula instante nenhum: entrega hora de parede e deixa a pagina,
 * que sabe o fuso da unidade, converter. A recepcionista pode estar em casa, em
 * outro estado, bloqueando o almoco de uma clinica em Manaus — usar o fuso do
 * navegador poria o bloqueio na hora errada e ninguem perceberia ate a consulta
 * cair em cima.
 */
export function PainelDeBloqueios(p: PainelDeBloqueiosProps) {
  // Um profissional so na unidade nao e palpite: e o unico possivel. Com dois ou
  // mais, o padrao e a unidade inteira — escolher um por conta seria adivinhar.
  const unico = p.profissionais.length === 1 ? p.profissionais[0]!.professionalId : '';

  const [kind, setKind] = useState(TIPOS[0]!.id);
  const [profissionalId, setProfissionalId] = useState(unico);
  const [inicio, setInicio] = useState('');
  const [fim, setFim] = useState('');
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [confirmando, setConfirmando] = useState<string | null>(null);

  const incompleto = motivo.trim() === '' || inicio === '' || fim === '';

  async function criar(): Promise<void> {
    setErro(null);
    // Comparacao de texto resolve: 'HH:MM' com zero a esquerda ordena igual ao
    // relogio, e nao envolve fuso nenhum.
    if (fim <= inicio) {
      setErro('O bloqueio termina antes de comecar. Confira os horarios.');
      return;
    }
    setSalvando(true);
    try {
      await p.aoCriar({
        inicioParede: `${p.dia}T${inicio}`,
        fimParede: `${p.dia}T${fim}`,
        kind,
        motivo: motivo.trim(),
        professionalId: profissionalId === '' ? null : profissionalId,
      });
      setMotivo('');
      setInicio('');
      setFim('');
    } catch (e) {
      // 409 vem da constraint de exclusao no banco. "bloqueio_sobreposto" e a
      // verdade tecnica; a recepcao precisa da frase que diz o que fazer.
      const codigo = (e as { codigo?: string }).codigo;
      setErro(codigo === 'bloqueio_sobreposto'
        ? 'Ja existe um bloqueio nesse horario. Ajuste o intervalo ou remova o outro.'
        : 'Nao foi possivel bloquear. Tente de novo.');
    } finally {
      setSalvando(false);
    }
  }

  async function remover(blockId: string): Promise<void> {
    setErro(null);
    try {
      await p.aoRemover(blockId);
      setConfirmando(null);
    } catch {
      setErro('Nao foi possivel remover o bloqueio.');
    }
  }

  return (
    <PainelLateral aberto={p.aberto} titulo="Bloqueios da agenda" aoFechar={p.aoFechar}>
      <div className="grid gap-5">
        <section className="grid gap-3">
          <label className="grid gap-1.5 text-sm">
            <span className="font-medium text-text">Tipo</span>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value)}
              className="rounded-[var(--r-sm)] border border-line bg-surface px-3 py-2 text-sm text-text"
            >
              {TIPOS.map((t) => <option key={t.id} value={t.id}>{t.rotulo}</option>)}
            </select>
          </label>

          <label className="grid gap-1.5 text-sm">
            <span className="font-medium text-text">Profissional</span>
            <select
              value={profissionalId}
              onChange={(e) => setProfissionalId(e.target.value)}
              className="rounded-[var(--r-sm)] border border-line bg-surface px-3 py-2 text-sm text-text"
            >
              <option value="">Toda a unidade</option>
              {p.profissionais.map((x) => (
                <option key={x.professionalId} value={x.professionalId}>{x.nome}</option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium text-text">Das</span>
              <input
                type="time"
                value={inicio}
                onChange={(e) => setInicio(e.target.value)}
                className="rounded-[var(--r-sm)] border border-line bg-surface px-3 py-2 text-sm text-text"
              />
            </label>
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium text-text">Ate</span>
              <input
                type="time"
                value={fim}
                onChange={(e) => setFim(e.target.value)}
                className="rounded-[var(--r-sm)] border border-line bg-surface px-3 py-2 text-sm text-text"
              />
            </label>
          </div>

          <label className="grid gap-1.5 text-sm">
            <span className="font-medium text-text">Motivo</span>
            <input
              type="text"
              maxLength={200}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Almoco, congresso, manutencao do ar…"
              className="rounded-[var(--r-sm)] border border-line bg-surface px-3 py-2 text-sm text-text"
            />
            <span className="text-xs text-text-muted">
              Obrigatorio. Sem motivo o bloqueio vira um buraco que ninguem sabe
              explicar — e alguem acaba removendo por engano.
            </span>
          </label>

          {erro !== null && <p role="alert" className="text-sm text-danger">{erro}</p>}

          <Botao
            iconeEsquerda={Prohibit}
            disabled={incompleto}
            carregando={salvando}
            onClick={() => { void criar(); }}
          >
            Bloquear
          </Botao>
        </section>

        <section className="grid gap-1.5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-text-muted">
            Bloqueios do dia
          </h3>
          {p.bloqueios.length === 0 ? (
            <p className="text-sm text-text-muted">
              Nenhum bloqueio neste dia. A agenda esta livre no horario de
              funcionamento.
            </p>
          ) : (
            <ul className="grid gap-1.5">
              {p.bloqueios.map((b) => (
                <li key={b.blockId}
                  className="rounded-[var(--r-sm)] border border-line bg-surface p-3 text-sm">
                  <p className="flex flex-wrap items-baseline gap-x-2 text-text">
                    <span className="font-semibold tabular-nums">
                      {horaNaClinica(b.startsAt, p.timezone)}
                      –{horaNaClinica(b.endsAt, p.timezone)}
                    </span>
                    <span className="text-xs uppercase tracking-wide text-text-muted">
                      {ROTULO_KIND[b.kind] ?? b.kind}
                    </span>
                  </p>
                  <p className="text-text">{b.motivo}</p>
                  {/* Sem o dono, "12:00–13:00 bloqueado" nao diz a recepcao se
                      ela ainda pode marcar com o OUTRO medico nesse horario. */}
                  <p className="text-xs text-text-muted">
                    {b.professionalNome ?? 'Toda a unidade'}
                  </p>

                  {confirmando === b.blockId ? (
                    <div className="mt-2 flex gap-2">
                      <Botao
                        variante="perigo"
                        tamanho="sm"
                        onClick={() => { void remover(b.blockId); }}
                      >
                        Confirmar remocao
                      </Botao>
                      <Botao
                        variante="fantasma"
                        tamanho="sm"
                        onClick={() => setConfirmando(null)}
                      >
                        Cancelar
                      </Botao>
                    </div>
                  ) : (
                    <Botao
                      className="mt-2"
                      variante="secundario"
                      tamanho="sm"
                      iconeEsquerda={Trash}
                      onClick={() => setConfirmando(b.blockId)}
                    >
                      Remover
                    </Botao>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </PainelLateral>
  );
}
