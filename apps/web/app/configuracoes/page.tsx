'use client';

import { useEffect, useState } from 'react';
import { apiFetch, ApiError } from '../../src/api';
import { useSessao } from '../../src/sessao';

interface Clinica {
  clinicId: string;
  nome: string;
  cnpj: string | null;
  cnes: string | null;
  timezone: string;
  tenantNome: string;
}

/**
 * Fusos que cobrem o Brasil. A lista curta e deliberada: o servidor valida
 * contra `pg_timezone_names` (a fonte que `app.local_date` vai usar depois), e
 * um combo com 600 zonas do mundo so aumenta a chance de alguem escolher errado
 * o campo que decide a data de todo evento do sistema.
 */
const FUSOS = [
  ['America/Sao_Paulo', 'Brasilia (UTC-3)'],
  ['America/Manaus', 'Manaus (UTC-4)'],
  ['America/Cuiaba', 'Cuiaba (UTC-4)'],
  ['America/Belem', 'Belem (UTC-3)'],
  ['America/Fortaleza', 'Fortaleza (UTC-3)'],
  ['America/Recife', 'Recife (UTC-3)'],
  ['America/Rio_Branco', 'Rio Branco (UTC-5)'],
  ['America/Noronha', 'Fernando de Noronha (UTC-2)'],
] as const;

export default function PaginaConfiguracoes() {
  const { clinicId, csrfToken, vinculoAtivo } = useSessao();
  const podeEditar = vinculoAtivo.role === 'admin_clinico'
    || vinculoAtivo.role === 'diretor_tecnico';

  const [clinica, setClinica] = useState<Clinica | null>(null);
  const [nome, setNome] = useState('');
  const [timezone, setTimezone] = useState('America/Sao_Paulo');
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      const c = await apiFetch<Clinica>(
        '/v1/configuracoes/clinica', { clinicId, csrfToken });
      if (!vivo) return;
      setClinica(c); setNome(c.nome); setTimezone(c.timezone);
    })();
    return () => { vivo = false; };
  }, [clinicId, csrfToken]);

  async function salvar(evento: React.FormEvent) {
    evento.preventDefault();
    setAviso(null);
    setSalvando(true);
    try {
      const c = await apiFetch<Clinica>('/v1/configuracoes/clinica', {
        method: 'PUT', body: { nome, timezone }, clinicId, csrfToken });
      setClinica(c);
      setAviso({ tipo: 'ok', texto: 'Configuracoes salvas.' });
    } catch (e) {
      setAviso({
        tipo: 'erro',
        texto: e instanceof ApiError && e.codigo === 'fuso_invalido'
          ? 'Fuso horario invalido.'
          : 'Nao foi possivel salvar.',
      });
    } finally {
      setSalvando(false);
    }
  }

  if (clinica === null) {
    return (
      <div className="grid min-h-[50vh] place-items-center">
        <p className="text-sm text-text-muted">Carregando…</p>
      </div>
    );
  }

  return (
    <div className="grid gap-8">
      <section className="grid gap-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">
          Unidade
        </h2>

        <form onSubmit={(e) => { void salvar(e); }} className="grid max-w-lg gap-4">
          <label className="grid gap-1.5">
            <span className="text-sm font-medium">Nome da unidade</span>
            <input
              value={nome} onChange={(e) => setNome(e.target.value)}
              disabled={!podeEditar} required minLength={2}
              className="h-10 rounded-[var(--r-md)] border border-line bg-surface px-3 text-sm outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:opacity-60"
            />
          </label>

          <label className="grid gap-1.5">
            <span className="text-sm font-medium">Fuso horario</span>
            <select
              value={timezone} onChange={(e) => setTimezone(e.target.value)}
              disabled={!podeEditar}
              className="h-10 rounded-[var(--r-md)] border border-line bg-surface px-3 text-sm outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:opacity-60"
            >
              {FUSOS.map(([valor, texto]) => (
                <option key={valor} value={valor}>{texto}</option>
              ))}
            </select>
            <span className="text-xs text-text-muted">
              Decide a data de todo agendamento, recibo e lote. Mudar aqui muda
              como o dia e fechado.
            </span>
          </label>

          <dl className="grid grid-cols-2 gap-4 rounded-[var(--r-md)] border border-line bg-surface-2 p-4 text-sm">
            <div>
              <dt className="text-xs text-text-muted">CNES</dt>
              <dd className="font-mono">{clinica.cnes ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-text-muted">CNPJ</dt>
              <dd className="font-mono">{clinica.cnpj ?? '—'}</dd>
            </div>
          </dl>

          {podeEditar && (
            <button
              type="submit" disabled={salvando}
              className="h-10 w-fit rounded-[var(--r-md)] bg-accent px-5 text-sm font-medium text-accent-on transition hover:opacity-90 disabled:opacity-50"
            >
              {salvando ? 'Salvando…' : 'Salvar'}
            </button>
          )}

          {aviso !== null && (
            <p role="status"
               className={aviso.tipo === 'ok' ? 'text-sm text-success' : 'text-sm text-danger'}>
              {aviso.texto}
            </p>
          )}
        </form>
      </section>
    </div>
  );
}
