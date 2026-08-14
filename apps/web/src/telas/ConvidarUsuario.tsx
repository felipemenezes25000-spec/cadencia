'use client';

import { useState, type FormEvent } from 'react';
import { Botao } from '../ui/Botao';
import { Modal } from '../ui/Modal';

const UFS = [
  'AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT',
  'PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO',
] as const;

const CONSELHOS = [
  { valor: '01', rotulo: 'CRBio' },
  { valor: '02', rotulo: 'CREF' },
  { valor: '03', rotulo: 'CREFITO' },
  { valor: '04', rotulo: 'CRF' },
  { valor: '05', rotulo: 'CRFA' },
  { valor: '06', rotulo: 'CRM' },
  { valor: '07', rotulo: 'CRMV' },
  { valor: '08', rotulo: 'CRN' },
  { valor: '09', rotulo: 'CRO' },
  { valor: '10', rotulo: 'CRP' },
  { valor: '11', rotulo: 'CRESS' },
  { valor: '12', rotulo: 'CRF (Física)' },
  { valor: '13', rotulo: 'COREN' },
] as const;

const ROLES_PROFISSIONAIS = ['profissional', 'diretor_tecnico'] as const;

export interface DadosConvite {
  readonly email: string;
  readonly nome: string;
  readonly role: string;
  readonly senhaTemporaria: string;
  readonly cpf?: string;
  readonly conselho?: string;
  readonly numeroConselho?: string;
  readonly ufConselho?: string;
  readonly cbos?: string;
}

export interface ConvidarUsuarioProps {
  readonly aberto: boolean;
  readonly aoFechar: () => void;
  readonly aoConvidar: (dados: DadosConvite) => Promise<void>;
}

export function ConvidarUsuario({ aberto, aoFechar, aoConvidar }: ConvidarUsuarioProps) {
  const [email, setEmail] = useState('');
  const [nome, setNome] = useState('');
  const [role, setRole] = useState('recepcao');
  const [senhaTemporaria, setSenhaTemporaria] = useState('');
  const [conselho, setConselho] = useState('06');
  const [numeroConselho, setNumeroConselho] = useState('');
  const [ufConselho, setUfConselho] = useState('SP');
  const [cbos, setCbos] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const ehProfissional = (ROLES_PROFISSIONAIS as readonly string[]).includes(role);

  const valida =
    email.includes('@')
    && nome.length >= 2
    && senhaTemporaria.length >= 8
    && (!ehProfissional || (numeroConselho.length > 0 && ufConselho.length > 0));

  function resetar() {
    setEmail(''); setNome(''); setRole('recepcao');
    setSenhaTemporaria(''); setConselho('06');
    setNumeroConselho(''); setUfConselho('SP');
    setCbos(''); setErro(null);
  }

  async function submeter(ev: FormEvent) {
    ev.preventDefault();
    if (!valida || enviando) return;
    setErro(null);
    setEnviando(true);
    try {
      const dados: DadosConvite = {
        email, nome, role, senhaTemporaria,
        ...(ehProfissional ? {
          conselho, numeroConselho, ufConselho,
          ...(cbos ? { cbos } : {}),
        } : {}),
      };
      await aoConvidar(dados);
      resetar();
      aoFechar();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Erro ao convidar';
      setErro(
        msg === 'vinculo_duplicado'
          ? 'Este usuário já tem esse papel nesta unidade.'
          : 'Não foi possível convidar.',
      );
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Modal
      aberto={aberto}
      titulo="Convidar usuário"
      descricao="A pessoa recebe acesso à unidade atual com o papel escolhido."
      ocupado={enviando}
      aoFechar={() => { resetar(); aoFechar(); }}
      rodape={
        <>
          <Botao type="button" variante="secundario" tamanho="md"
            disabled={enviando}
            onClick={() => { resetar(); aoFechar(); }}>
            Cancelar
          </Botao>
          {/* `form` liga o submit ao formulário que ficou no corpo rolável —
              sem isso a ação principal sumiria ao rolar um convite de
              profissional, que tem quatro campos a mais. */}
          <Botao type="submit" form="form-convidar-usuario" variante="primario" tamanho="md"
            disabled={!valida} carregando={enviando}>
            Convidar
          </Botao>
        </>
      }
    >
        <form id="form-convidar-usuario" onSubmit={(ev) => { void submeter(ev); }} className="grid gap-4">
          <label className="grid gap-1">
            <span className="text-xs text-text-muted">E-mail</span>
            <input type="email" required
              value={email} onChange={(e) => setEmail(e.target.value)}
              className="rounded-lg border border-line bg-surface px-3 py-2 text-sm" />
          </label>

          <label className="grid gap-1">
            <span className="text-xs text-text-muted">Nome completo</span>
            <input type="text" required minLength={2}
              value={nome} onChange={(e) => setNome(e.target.value)}
              className="rounded-lg border border-line bg-surface px-3 py-2 text-sm" />
          </label>

          <label className="grid gap-1">
            <span className="text-xs text-text-muted">Papel</span>
            <select value={role} onChange={(e) => setRole(e.target.value)}
              className="rounded-lg border border-line bg-surface px-3 py-2 text-sm">
              <option value="admin_clinico">Administração</option>
              <option value="diretor_tecnico">Direção técnica</option>
              <option value="profissional">Profissional de saúde</option>
              <option value="recepcao">Recepção</option>
              <option value="financeiro">Financeiro</option>
            </select>
          </label>

          <label className="grid gap-1">
            <span className="text-xs text-text-muted">Senha temporária</span>
            <input type="text" required minLength={8}
              value={senhaTemporaria} onChange={(e) => setSenhaTemporaria(e.target.value)}
              className="rounded-lg border border-line bg-surface px-3 py-2 text-sm" />
            {senhaTemporaria.length > 0 && senhaTemporaria.length < 8 && (
              <span className="text-xs text-danger">Mínimo 8 caracteres</span>
            )}
          </label>

          {ehProfissional && (
            <>
              <label className="grid gap-1">
                <span className="text-xs text-text-muted">Conselho</span>
                <select value={conselho} onChange={(e) => setConselho(e.target.value)}
                  className="rounded-lg border border-line bg-surface px-3 py-2 text-sm">
                  {CONSELHOS.map((c) => (
                    <option key={c.valor} value={c.valor}>{c.rotulo}</option>
                  ))}
                </select>
              </label>

              <label className="grid gap-1">
                <span className="text-xs text-text-muted">Número do conselho</span>
                <input type="text" required
                  value={numeroConselho} onChange={(e) => setNumeroConselho(e.target.value)}
                  className="rounded-lg border border-line bg-surface px-3 py-2 text-sm" />
              </label>

              <label className="grid gap-1">
                <span className="text-xs text-text-muted">UF do conselho</span>
                <select value={ufConselho} onChange={(e) => setUfConselho(e.target.value)}
                  className="rounded-lg border border-line bg-surface px-3 py-2 text-sm">
                  {UFS.map((uf) => (
                    <option key={uf} value={uf}>{uf}</option>
                  ))}
                </select>
              </label>

              <label className="grid gap-1">
                <span className="text-xs text-text-muted">CBOS (opcional)</span>
                <input type="text"
                  value={cbos} onChange={(e) => setCbos(e.target.value)}
                  className="rounded-lg border border-line bg-surface px-3 py-2 text-sm" />
              </label>
            </>
          )}

          {erro !== null && <p role="alert" className="text-sm text-danger">{erro}</p>}
        </form>
    </Modal>
  );
}
