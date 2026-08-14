'use client';

import { useEffect, useState, useMemo } from 'react';
import { Buildings, Check, X, ShieldCheck, FloppyDisk } from '@phosphor-icons/react';
import { ACTIONS, ROLES, type ActionDef, type Role } from '@cadencia/authz';
import { apiFetch, ApiError } from '../api';
import { useSessao } from '../sessao';
import { Botao } from '../ui/Botao';

const ROTULO_ROLE: Record<Role, string> = {
  admin_clinico: 'Administração',
  diretor_tecnico: 'Direção técnica',
  profissional: 'Profissional',
  recepcao: 'Recepção',
  financeiro: 'Financeiro',
};

interface Override {
  action: string;
  role: string;
  permitido: boolean;
}

interface Clinica {
  id: string;
  nome: string;
}

/**
 * O agrupamento da matriz sai de `action.key` — 'patient.read' vira o grupo
 * 'patient'. A chave e identificador de codigo e nunca foi traduzida, entao a
 * tela de Permissoes exibia 'patient', 'encounter', 'messaging', 'drug' como
 * titulo de secao: o unico lugar do produto onde o usuario final lia ingles.
 * A traducao mora aqui e nao em `@cadencia/authz` de proposito — a chave e
 * contrato de autorizacao (vai para o banco, para o seed e para o audit) e
 * traduzi-la la seria misturar identidade com apresentacao.
 */
const ROTULO_DOMINIO: Record<string, string> = {
  ai: 'Inteligência artificial',
  appointment: 'Agendamentos',
  attachment: 'Anexos',
  audit: 'Auditoria',
  bank_account: 'Contas bancárias',
  billing: 'Assinatura e faturamento',
  catalog: 'Catálogos',
  channel: 'Canais de mensagem',
  clinic: 'Unidades',
  data: 'Dados e portabilidade',
  document: 'Documentos',
  document_template: 'Modelos de documento',
  drug: 'Bulário',
  encounter: 'Atendimentos',
  /* Não "Financeiro": esse é o nome de um dos papéis e vira coluna da matriz.
     Ler "Financeiro" como título de linha E como cabeçalho de coluna, na mesma
     tabela, com sentidos diferentes, é ambíguo para quem configura acesso. */
  finance: 'Operação financeira',
  inventory: 'Estoque',
  lgpd: 'LGPD',
  membership: 'Equipe e vínculos',
  messaging: 'Mensagens',
  mfa: 'Autenticação em duas etapas',
  notification: 'Notificações',
  patient: 'Pacientes',
  payment: 'Pagamentos',
  prescription: 'Prescrições',
  record: 'Prontuário',
  report: 'Relatórios',
  teleconsult: 'Teleconsulta',
  tenant: 'Organização',
  tiss: 'Convênios (TISS)',
  waitlist: 'Lista de espera',
};

/** Um domínio novo em `@cadencia/authz` não pode derrubar a tela: sem rótulo
 *  cadastrado, mostra a própria chave em vez de `undefined`. */
function rotuloDominio(dominio: string): string {
  return ROTULO_DOMINIO[dominio] ?? dominio;
}

function agrupar(actions: readonly ActionDef[]): Map<string, ActionDef[]> {
  const grupos = new Map<string, ActionDef[]>();
  for (const a of actions) {
    const dominio = a.key.split('.')[0]!;
    const lista = grupos.get(dominio) ?? [];
    lista.push(a);
    grupos.set(dominio, lista);
  }
  return grupos;
}

export function MatrizPermissoes() {
  const { clinicId, csrfToken, vinculoAtivo } = useSessao();
  const podeEditar = vinculoAtivo.role === 'admin_clinico';

  const [clinicas, setClinicas] = useState<Clinica[]>([]);
  const [clinicaSelecionada, setClinicaSelecionada] = useState<string>(clinicId);
  const [overrides, setOverrides] = useState<Override[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [mensagem, setMensagem] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);

  // Estado local para edição
  const [estadoEdicao, setEstadoEdicao] = useState<Record<string, boolean | null>>({});
  const [temAlteracoes, setTemAlteracoes] = useState(false);

  useEffect(() => {
    if (!temAlteracoes) return;

    function avisarAlteracoesNaoSalvas(evento: BeforeUnloadEvent) {
      evento.preventDefault();
      evento.returnValue = '';
    }

    window.addEventListener('beforeunload', avisarAlteracoesNaoSalvas);
    return () => window.removeEventListener('beforeunload', avisarAlteracoesNaoSalvas);
  }, [temAlteracoes]);

  // Carregar clínicas
  useEffect(() => {
    void carregarClinicas();
  }, [csrfToken, clinicId]);

  // Carregar permissões quando mudar a clínica selecionada
  useEffect(() => {
    if (clinicaSelecionada) {
      void carregarPermissoes();
    }
  }, [clinicaSelecionada, csrfToken]);

  async function carregarClinicas() {
    try {
      const r = await apiFetch<{ itens: Clinica[] }>('/v1/clinics', {
        clinicId, csrfToken,
      });
      setClinicas(r.itens);
    } catch {
      setClinicas([]);
    }
  }

  async function carregarPermissoes() {
    setCarregando(true);
    setTemAlteracoes(false);
    setEstadoEdicao({});
    setMensagem(null);
    try {
      const r = await apiFetch<{
        overrides: Record<string, Override[]>;
      }>(`/v1/permissions?clinicId=${clinicaSelecionada}`, {
        clinicId, csrfToken,
      });

      // Converter overrides para array plano
      const overridesPlano: Override[] = [];
      for (const role of Object.keys(r.overrides)) {
        const items = r.overrides[role];
        if (items) overridesPlano.push(...items);
      }
      setOverrides(overridesPlano);

      // Inicializar estado de edição com null (default)
      const estado: Record<string, boolean | null> = {};
      for (const a of ACTIONS) {
        for (const role of ROLES) {
          estado[`${a.key}:${role}`] = null;
        }
      }
      // Aplicar overrides
      for (const o of overridesPlano) {
        estado[`${o.action}:${o.role}`] = o.permitido;
      }
      setEstadoEdicao(estado);
    } catch {
      setOverrides([]);
    } finally {
      setCarregando(false);
    }
  }

  function togglePermissao(action: string, role: Role) {
    if (!podeEditar) return;
    const chave = `${action}:${role}`;
    setEstadoEdicao((prev) => {
      const atual = prev[chave];
      // Ciclo: null -> true -> false -> null
      const proximo: boolean | null = atual === null ? true : atual === true ? false : null;
      return { ...prev, [chave]: proximo };
    });
    setTemAlteracoes(true);
    setMensagem(null);
  }

  async function salvar() {
    if (!podeEditar || salvando) return;
    setSalvando(true);
    setMensagem(null);

    try {
      // Coletar only changes (não-null values)
      const novosOverrides: Override[] = [];
      for (const [chave, valor] of Object.entries(estadoEdicao)) {
        if (valor !== null) {
          const [action, role] = chave.split(':') as [string, Role];
          novosOverrides.push({ action, role, permitido: valor });
        }
      }

      await apiFetch(`/v1/clinics/${clinicaSelecionada}/permissions`, {
        method: 'PUT',
        body: { overrides: novosOverrides },
        clinicId,
        csrfToken,
      });

      setOverrides(novosOverrides);
      setTemAlteracoes(false);
      setMensagem({ tipo: 'ok', texto: 'Permissões salvas com sucesso.' });
    } catch (e) {
      if (e instanceof ApiError) {
        setMensagem({ tipo: 'erro', texto: 'Erro ao salvar permissões.' });
      } else {
        setMensagem({ tipo: 'erro', texto: 'Erro inesperado.' });
      }
    } finally {
      setSalvando(false);
    }
  }

  function cancelar() {
    // Recarregar do estado salvo
    const estado: Record<string, boolean | null> = {};
    for (const a of ACTIONS) {
      for (const role of ROLES) {
        estado[`${a.key}:${role}`] = null;
      }
    }
    for (const o of overrides) {
      estado[`${o.action}:${o.role}`] = o.permitido;
    }
    setEstadoEdicao(estado);
    setTemAlteracoes(false);
    setMensagem(null);
  }

  const grupos = useMemo(() => agrupar(ACTIONS), []);

  return (
    <div className="grid gap-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">
          Matriz de permissões
        </h2>
        {temAlteracoes && (
          <div className="flex gap-2">
            <Botao
              variante="secundario" tamanho="sm"
              onClick={cancelar}
            >
              Cancelar
            </Botao>
            <Botao
              variante="primario" tamanho="sm"
              iconeEsquerda={FloppyDisk}
              carregando={salvando}
              onClick={() => { void salvar(); }}
            >
              Salvar alterações
            </Botao>
          </div>
        )}
      </div>

      {/* Seletor de clínica */}
      {clinicas.length > 1 && (
        <div className="flex items-center gap-3 rounded-lg border border-line bg-surface-2 p-3">
          <Buildings size={18} className="text-text-muted" />
          <label className="flex items-center gap-2 text-sm">
            <span className="text-text-muted">Clínica:</span>
            <select
              value={clinicaSelecionada}
              onChange={(e) => setClinicaSelecionada(e.target.value)}
              className="rounded border border-line bg-surface px-2 py-1 text-sm"
            >
              {clinicas.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                  {c.id === clinicId ? ' (principal)' : ''}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {podeEditar && (
        <p className="text-xs text-text-faint">
          Clique em uma célula para alternar entre permitido (verde),
          negado (vermelho) ou padrão (cinza).
        </p>
      )}

      {mensagem && (
        <p className={`rounded-lg p-3 text-sm ${
          mensagem.tipo === 'ok'
            ? 'bg-success/10 text-success'
            : 'bg-danger/10 text-danger'
        }`}>
          {mensagem.texto}
        </p>
      )}

      {carregando ? (
        <div className="grid min-h-[200px] place-items-center">
          <p className="text-sm text-text-muted">Carregando permissões…</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-surface-2 text-left text-xs uppercase text-text-muted">
              <tr>
                <th className="w-72 px-4 py-2.5 font-medium">Ação</th>
                {ROLES.map((r) => (
                  <th key={r} className="px-3 py-2.5 text-center font-medium">
                    {ROTULO_ROLE[r]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...grupos.entries()].map(([dominio, acoes]) => (
                <GroupFragment
                  key={dominio}
                  dominio={dominio}
                  acoes={acoes}
                  estadoEdicao={estadoEdicao}
                  podeEditar={podeEditar}
                  aoToggle={togglePermissao}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Legenda */}
      <div className="flex items-center gap-6 text-xs text-text-muted">
        <span className="flex items-center gap-1.5">
          <span className="size-3 rounded bg-ok/20" />
          Permitido
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-3 rounded bg-danger/20" />
          Negado
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-3 rounded bg-text-faint/20" />
          Padrão (herdado)
        </span>
        {podeEditar && (
          <span className="ml-auto flex items-center gap-1.5 text-text-faint">
            <ShieldCheck size={14} />
            Exceção ativa
          </span>
        )}
      </div>
    </div>
  );
}

function GroupFragment({
  dominio,
  acoes,
  estadoEdicao,
  podeEditar,
  aoToggle,
}: {
  readonly dominio: string;
  readonly acoes: readonly ActionDef[];
  readonly estadoEdicao: Record<string, boolean | null>;
  readonly podeEditar: boolean;
  readonly aoToggle: (action: string, role: Role) => void;
}) {
  return (
    <>
      <tr className="bg-surface/80">
        <td colSpan={ROLES.length + 1} className="px-4 py-2 text-[10px] font-bold uppercase tracking-widest text-text-faint">
          {rotuloDominio(dominio)}
        </td>
      </tr>
      {acoes.map((a) => (
        <tr key={a.key} className="border-t border-line">
          <td className="px-4 py-2.5">
            <span className="flex items-center gap-2">
              <span className="font-medium">{a.description}</span>
              {a.requiresMfa && (
                <span className="flex items-center gap-0.5 rounded bg-warning-soft px-1.5 py-0.5 text-[10px] font-bold text-warning">
                  <ShieldCheck size={12} /> MFA
                </span>
              )}
            </span>
            <span className="block font-mono text-[11px] text-text-faint">{a.key}</span>
          </td>
          {ROLES.map((role) => {
            const chave = `${a.key}:${role}`;
            const valor = estadoEdicao[chave];
            const defaultPermitido = a.roles.includes(role);

            let corClasse = '';
            let icone = null;
            let label = '';

            if (valor === null) {
              // Padrão
              corClasse = defaultPermitido
                ? 'text-text-muted'
                : 'text-text-faint';
              icone = defaultPermitido
                ? <Check size={16} weight="bold" className="mx-auto text-text-muted/40" />
                : <span className="text-text-faint/40">--</span>;
              label = defaultPermitido ? 'Permitido (padrão)' : 'Negado (padrão)';
            } else if (valor) {
              corClasse = 'bg-ok/10';
              icone = <Check size={16} weight="bold" className="mx-auto text-ok" />;
              label = 'Permitido (exceção)';
            } else {
              corClasse = 'bg-danger/10';
              icone = <X size={16} weight="bold" className="mx-auto text-danger" />;
              label = 'Negado (exceção)';
            }

            return (
              <td
                key={role}
                className={`px-3 py-2.5 text-center ${corClasse} ${
                  podeEditar ? 'cursor-pointer hover:bg-accent/5' : ''
                }`}
                onClick={() => aoToggle(a.key, role)}
                title={label}
              >
                {podeEditar ? (
                  <button
                    type="button"
                    className="mx-auto focus:outline-none focus:ring-2 focus:ring-accent/50"
                    aria-label={label}
                  >
                    {icone}
                  </button>
                ) : (
                  <span className="mx-auto">{icone}</span>
                )}
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}
