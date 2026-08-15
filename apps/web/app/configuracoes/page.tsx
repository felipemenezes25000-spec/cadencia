'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  CaretRight,
  CheckCircle,
  Clock,
  FloppyDisk,
  ShieldCheck,
  Stethoscope,
  WarningCircle,
} from '@phosphor-icons/react';
import { apiFetch, ApiError } from '../../src/api';
import { useSubmitUnico } from '../../src/lib/acao-unica';
import { useSessao } from '../../src/sessao';
import { ListaClinicas, type ClinicaResumo } from '../../src/telas/ListaClinicas';
import { CriarClinica, type DadosCriacaoClinica } from '../../src/telas/CriarClinica';
import { Botao } from '../../src/ui/Botao';
import { Campo } from '../../src/ui/Campo';

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

function rotuloFuso(valor: string): string {
  return FUSOS.find(([fuso]) => fuso === valor)?.[1] ?? valor;
}

export default function PaginaConfiguracoes() {
  const { clinicId, csrfToken, vinculoAtivo } = useSessao();
  const podeEditar = vinculoAtivo.role === 'admin_clinico' || vinculoAtivo.role === 'diretor_tecnico';
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
      setClinica(c);
      setNome(c.nome);
      setTimezone(c.timezone);
      setCnes(c.cnes ?? '');
      setCnpj(c.cnpj ?? '');
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
        method: 'PUT', body, clinicId, csrfToken,
      });
      setClinica(c);
      setNome(c.nome);
      setTimezone(c.timezone);
      setCnes(c.cnes ?? '');
      setCnpj(c.cnpj ?? '');
      setAviso({ tipo: 'ok', texto: 'Alterações salvas com sucesso.' });
    } catch (e) {
      setAviso({
        tipo: 'erro',
        texto: e instanceof ApiError && e.codigo === 'fuso_invalido'
          ? 'O fuso horário informado é inválido.'
          : 'Não foi possível salvar as alterações.',
      });
    } finally {
      setSalvando(false);
    }
  }

  async function criarClinica(dados: DadosCriacaoClinica) {
    await apiFetch('/v1/configuracoes/clinicas', {
      method: 'POST', body: dados, clinicId, csrfToken,
    });
    const lista = await apiFetch<{ itens: ClinicaResumo[] }>('/v1/configuracoes/clinicas', { clinicId, csrfToken });
    setClinicas(lista.itens);
  }

  function restaurar() {
    if (!clinica) return;
    setNome(clinica.nome);
    setTimezone(clinica.timezone);
    setCnes(clinica.cnes ?? '');
    setCnpj(clinica.cnpj ?? '');
    setAviso(null);
  }

  const alterado = useMemo(() => clinica !== null && (
    nome !== clinica.nome
    || timezone !== clinica.timezone
    || cnes !== (clinica.cnes ?? '')
    || cnpj !== (clinica.cnpj ?? '')
  ), [clinica, nome, timezone, cnes, cnpj]);

  const salvarUmaVez = useSubmitUnico(salvar);

  if (clinica === null) {
    return (
      <div className="settings-clinic-page" aria-label="Carregando configurações da clínica">
        <div className="h-40 animate-pulse rounded-[18px] bg-surface-sunken" />
        <div className="h-80 animate-pulse rounded-[18px] bg-surface-sunken" />
      </div>
    );
  }

  return (
    <div className="settings-clinic-page">
      <section className="settings-clinic-summary" aria-labelledby="unidade-ativa-titulo">
        <div className="settings-clinic-summary-top">
          <div className="settings-clinic-title">
            <span className="settings-clinic-title-icon"><Stethoscope size={20} weight="duotone" aria-hidden /></span>
            <div className="min-w-0">
              <p>Unidade em uso nesta sessão</p>
              <h3 id="unidade-ativa-titulo">{clinica.nome}</h3>
              <span>{clinica.tenantNome}</span>
            </div>
          </div>
          <span className="settings-clinic-live">Operação ativa</span>
        </div>

        <div className="settings-clinic-facts">
          <div className="settings-clinic-fact"><span>Fuso horário</span><strong>{rotuloFuso(clinica.timezone)}</strong></div>
          <div className="settings-clinic-fact"><span>CNES</span><strong>{clinica.cnes ?? 'Não informado'}</strong></div>
          <div className="settings-clinic-fact"><span>CNPJ</span><strong>{clinica.cnpj ?? 'Não informado'}</strong></div>
        </div>
      </section>

      {!podeEditar ? (
        <div className="settings-readonly-note" role="note">
          <ShieldCheck size={18} weight="duotone" aria-hidden />
          <div><strong>Visualização somente</strong><span>Seu perfil pode consultar os dados da unidade, mas não alterá-los.</span></div>
        </div>
      ) : null}

      <form onSubmit={salvarUmaVez} className="settings-form-card">
        <header className="settings-form-card-header">
          <div>
            <h3>Dados da unidade</h3>
            <p>Informações que identificam a clínica e definem como a operação é registrada no sistema.</p>
          </div>
          {alterado ? <span className="settings-unsaved">Alterações não salvas</span> : null}
        </header>

        <div className="settings-form-card-body">
          <div className="settings-form-grid">
            <Campo
              className="settings-span-2"
              rotulo="Nome da unidade"
              ajuda="Use o nome que a equipe reconhece no dia a dia."
              value={nome}
              onChange={(evento) => setNome(evento.target.value)}
              disabled={!podeEditar}
              required
              minLength={2}
              autoComplete="organization"
            />

            <Campo
              rotulo="CNES"
              ajuda="Cadastro Nacional de Estabelecimentos de Saúde."
              value={cnes}
              onChange={(evento) => setCnes(evento.target.value.replace(/\D/g, '').slice(0, 7))}
              placeholder="1234567"
              inputMode="numeric"
              disabled={!podeEditar}
              maxLength={7}
            />

            <Campo
              rotulo="CNPJ"
              ajuda="Somente números; o valor é salvo sem formatação."
              value={cnpj}
              onChange={(evento) => setCnpj(evento.target.value.replace(/\D/g, '').slice(0, 14))}
              placeholder="12345678000190"
              inputMode="numeric"
              disabled={!podeEditar}
              maxLength={14}
            />

            <label className="settings-field-label settings-span-2">
              <span>Fuso horário da unidade</span>
              <span className="settings-select-field">
                <select value={timezone} onChange={(evento) => setTimezone(evento.target.value)} disabled={!podeEditar}>
                  {FUSOS.map(([valor, texto]) => <option key={valor} value={valor}>{texto}</option>)}
                </select>
                <CaretRight size={16} aria-hidden />
              </span>
              <p className="settings-field-help"><Clock size={12} className="mr-1 inline" aria-hidden />O fuso determina a data de agenda, recibos e fechamento do dia. Altere apenas quando a unidade realmente operar em outra região.</p>
            </label>
          </div>

          {aviso !== null ? (
            <div role="status" className={`settings-form-notice ${aviso.tipo}`}>
              {aviso.tipo === 'ok' ? <CheckCircle size={16} weight="fill" aria-hidden /> : <WarningCircle size={16} weight="fill" aria-hidden />}
              {aviso.texto}
            </div>
          ) : null}
        </div>

        {podeEditar ? (
          <footer className="settings-form-actions">
            <span className="text-[10px] text-text-faint">As mudanças valem para toda a unidade.</span>
            <div className="settings-form-actions-buttons">
              <Botao type="button" variante="fantasma" onClick={restaurar} disabled={!alterado || salvando}>Descartar</Botao>
              <Botao type="submit" variante="primario" iconeEsquerda={FloppyDisk} carregando={salvando} disabled={!alterado}>Salvar alterações</Botao>
            </div>
          </footer>
        ) : null}
      </form>

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
    </div>
  );
}
