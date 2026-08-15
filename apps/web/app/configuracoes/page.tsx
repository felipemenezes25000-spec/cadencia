'use client';

import { useEffect, useState } from 'react';
import { apiFetch, ApiError } from '../../src/api';
import { useSubmitUnico } from '../../src/lib/acao-unica';
import { useSessao } from '../../src/sessao';
import { ListaClinicas, type ClinicaResumo } from '../../src/telas/ListaClinicas';
import { CriarClinica, type DadosCriacaoClinica } from '../../src/telas/CriarClinica';

interface Clinica {
  clinicId: string;
  nome: string;
  cnpj: string | null;
  cnes: string | null;
  timezone: string;
  tenantNome: string;
}

const FUSOS = [
  ['America/Sao_Paulo', 'Brasília (UTC-3)'],
  ['America/Manaus', 'Manaus (UTC-4)'],
  ['America/Cuiaba', 'Cuiabá (UTC-4)'],
  ['America/Belem', 'Belém (UTC-3)'],
  ['America/Fortaleza', 'Fortaleza (UTC-3)'],
  ['America/Recife', 'Recife (UTC-3)'],
  ['America/Rio_Branco', 'Rio Branco (UTC-5)'],
  ['America/Noronha', 'Fernando de Noronha (UTC-2)'],
] as const;

export default function PaginaConfiguracoes() {
  const { clinicId, csrfToken, vinculoAtivo } = useSessao();
  const podeEditar = vinculoAtivo.role === 'admin_clinico'
    || vinculoAtivo.role === 'diretor_tecnico';
  const podeCriar = vinculoAtivo.role === 'admin_clinico';

  const [clinica, setClinica] = useState<Clinica | null>(null);
  const [nome, setNome] = useState('');
  const [timezone, setTimezone] = useState('America/Sao_Paulo');
  const [cnes, setCnes] = useState('');
  const [cnpj, setCnpj] = useState('');
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const [salvando, setSalvando] = useState(false);

  const [clinicas, setClinicas] = useState<ClinicaResumo[]>([]);
  const [modalAberto, setModalAberto] = useState(false);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      const [c, lista] = await Promise.all([
        apiFetch<Clinica>('/v1/configuracoes/clinica', { clinicId, csrfToken }),
        apiFetch<{ itens: ClinicaResumo[] }>('/v1/configuracoes/clinicas', { clinicId, csrfToken }),
      ]);
      if (!vivo) return;
      setClinica(c); setNome(c.nome); setTimezone(c.timezone);
      setCnes(c.cnes ?? ''); setCnpj(c.cnpj ?? '');
      setClinicas(lista.itens);
    })();
    return () => { vivo = false; };
  }, [clinicId, csrfToken]);

  async function salvar(evento: React.FormEvent) {
    evento.preventDefault();
    setAviso(null);
    setSalvando(true);
    try {
      const body: Record<string, string> = { nome, timezone };
      if (cnes) body['cnes'] = cnes;
      if (cnpj) body['cnpj'] = cnpj;
      const c = await apiFetch<Clinica>('/v1/configuracoes/clinica', {
        method: 'PUT', body, clinicId, csrfToken });
      setClinica(c);
      setCnes(c.cnes ?? ''); setCnpj(c.cnpj ?? '');
      setAviso({ tipo: 'ok', texto: 'Configurações salvas.' });
    } catch (e) {
      setAviso({
        tipo: 'erro',
        texto: e instanceof ApiError && e.codigo === 'fuso_invalido'
          ? 'Fuso horário inválido.'
          : 'Não foi possível salvar.',
      });
    } finally {
      setSalvando(false);
    }
  }

  async function criarClinica(dados: DadosCriacaoClinica) {
    await apiFetch('/v1/configuracoes/clinicas', {
      method: 'POST', body: dados, clinicId, csrfToken });
    const lista = await apiFetch<{ itens: ClinicaResumo[] }>(
      '/v1/configuracoes/clinicas', { clinicId, csrfToken });
    setClinicas(lista.itens);
  }

  const salvarUmaVez = useSubmitUnico(salvar);

  if (clinica === null) {
    return (
      <div className="grid min-h-[50vh] place-items-center">
        <p className="text-sm text-text-muted">Carregando…</p>
      </div>
    );
  }

  return (
    <div className="grid gap-8">
      <ListaClinicas
        clinicas={clinicas}
        clinicaAtivaId={clinicId}
        podeCriar={podeCriar}
        aoCriar={() => setModalAberto(true)}
      />

      <CriarClinica
        aberto={modalAberto}
        aoFechar={() => setModalAberto(false)}
        aoCriar={criarClinica}
      />

      <section className="grid gap-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">
          Unidade
        </h2>

        <form onSubmit={salvarUmaVez} className="grid max-w-lg gap-4">
          <label className="grid gap-1.5">
            <span className="text-sm font-medium">Nome da unidade</span>
            <input
              value={nome} onChange={(e) => setNome(e.target.value)}
              disabled={!podeEditar} required minLength={2}
              className="h-10 rounded-[var(--r-md)] border border-line bg-surface px-3 text-sm outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:opacity-60"
            />
          </label>

          <label className="grid gap-1.5">
            <span className="text-sm font-medium">Fuso horário</span>
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
              como o dia é fechado.
            </span>
          </label>

          {podeEditar ? (
            <div className="grid grid-cols-2 gap-4">
              <label className="grid gap-1.5">
                <span className="text-sm font-medium">CNES</span>
                <input
                  value={cnes} onChange={(e) => setCnes(e.target.value)}
                  placeholder="1234567" maxLength={7}
                  className="h-10 rounded-[var(--r-md)] border border-line bg-surface px-3 text-sm font-mono outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
                />
              </label>
              <label className="grid gap-1.5">
                <span className="text-sm font-medium">CNPJ</span>
                <input
                  value={cnpj} onChange={(e) => setCnpj(e.target.value)}
                  placeholder="12345678000190"
                  className="h-10 rounded-[var(--r-md)] border border-line bg-surface px-3 text-sm font-mono outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
                />
              </label>
            </div>
          ) : (
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
          )}

          {podeEditar && (
            <button
              type="submit" disabled={salvando}
              className="h-10 w-fit rounded-[var(--r-md)] bg-accent px-5 text-sm font-medium text-accent-on transition hover:opacity-90 disabled:opacity-50"
            >
              {salvando ? 'Salvando...' : 'Salvar'}
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
