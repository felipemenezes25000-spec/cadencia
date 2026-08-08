// apps/web/src/telas/ConveniosOperadoras.tsx
'use client';

import { useEffect, useState } from 'react';
import { Botao } from '../ui/Botao';
import { Campo } from '../ui/Campo';
import { PainelLateral } from '../ui/PainelLateral';

// ── Tipos ──────────────────────────────────────────────────────────────────

export interface Operadora {
  readonly id: string;
  readonly nome: string;
  readonly registroAns: string;
  readonly versaoTiss: string;
  readonly cnpj: string;
  readonly email: string | null;
  readonly telefone: string | null;
  readonly ativa: boolean;
  readonly totalPacientes: number;
}

export interface OperadorasDados {
  readonly operadoras: readonly Operadora[];
}

export interface ConveniosOperadorasProps {
  readonly carregarDados: () => Promise<OperadorasDados>;
  readonly aoSalvar: (op: Partial<Operadora> & { nome: string; registroAns: string }) => Promise<void>;
  readonly aoDesativar: (operadoraId: string) => Promise<void>;
}

// ── Componente ─────────────────────────────────────────────────────────────

export function ConveniosOperadoras(p: ConveniosOperadorasProps) {
  const [dados, setDados] = useState<OperadorasDados | null>(null);
  const [formAberto, setFormAberto] = useState(false);
  const [nome, setNome] = useState('');
  const [registroAns, setRegistroAns] = useState('');
  const [versaoTiss, setVersaoTiss] = useState('4.01.00');
  const [cnpj, setCnpj] = useState('');
  const [email, setEmail] = useState('');
  const [telefone, setTelefone] = useState('');

  useEffect(() => {
    void p.carregarDados().then(setDados);
  }, [p]);

  function limparForm(): void {
    setNome('');
    setRegistroAns('');
    setVersaoTiss('4.01.00');
    setCnpj('');
    setEmail('');
    setTelefone('');
  }

  function salvar(): void {
    void p.aoSalvar({
      nome, registroAns, versaoTiss, cnpj,
      email: email === '' ? null : email,
      telefone: telefone === '' ? null : telefone,
    }).then(() => {
      setFormAberto(false);
      limparForm();
    });
  }

  if (dados === null) return null;

  return (
    <div style={{ display: 'grid', gap: 'var(--s-6)' }}>
      {/* Cabecalho */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ fontSize: 'var(--fs-15)', fontWeight: 'var(--fw-semibold)', margin: 0 }}>
          Operadoras
        </h2>
        <Botao variante="primario" altura={32}
          onClick={() => { limparForm(); setFormAberto(true); }}>
          Nova operadora
        </Botao>
      </div>

      {/* Versoes TISS em uso */}
      <div style={{ display: 'flex', gap: 'var(--s-3)', alignItems: 'center' }}>
        <span style={{ fontSize: 'var(--fs-12)', color: 'var(--text-muted)' }}>
          Versoes TISS:
        </span>
        {[...new Set(dados.operadoras.map((op) => op.versaoTiss))].map((v) => (
          <span key={v} style={{
            fontSize: 'var(--fs-12)', fontFamily: 'var(--font-mono)',
            fontVariantNumeric: 'tabular-nums', padding: 'var(--s-1) var(--s-3)',
            borderRadius: 'var(--r-sm)', background: 'var(--surface-sunken)',
            color: 'var(--text-muted)',
          }}>
            {v}
          </span>
        ))}
      </div>

      {/* Lista de operadoras */}
      <section aria-label="Operadoras cadastradas">
        <ul style={{ listStyle: 'none', margin: 0, padding: 0,
                     border: 'var(--border)', borderRadius: 'var(--r-md)',
                     overflow: 'hidden', background: 'var(--surface)' }}>
          {dados.operadoras.map((op) => (
            <li key={op.id} style={{
              display: 'grid', gridTemplateColumns: '1fr auto',
              alignItems: 'center', gap: 'var(--s-4)',
              padding: 'var(--s-5) var(--s-5)',
              borderBottom: 'var(--border)', minHeight: 56,
            }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s-3)' }}>
                  <span style={{ fontWeight: 'var(--fw-medium)', fontSize: 'var(--fs-15)' }}>
                    {op.nome}
                  </span>
                  <span className="num" style={{
                    fontSize: 'var(--fs-12)', fontFamily: 'var(--font-mono)',
                    fontVariantNumeric: 'tabular-nums', color: 'var(--text-muted)',
                  }}>
                    {op.registroAns}
                  </span>
                  {!op.ativa ? (
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: 'var(--s-2)',
                      fontSize: 'var(--fs-11)', textTransform: 'uppercase', letterSpacing: '.04em',
                      fontWeight: 'var(--fw-medium)', padding: 'var(--s-1) var(--s-4)',
                      borderRadius: 'var(--r-full)',
                      color: 'var(--text-faint)', background: 'var(--surface-sunken)',
                    }}>
                      Inativa
                    </span>
                  ) : null}
                </div>
                <span style={{ display: 'block', fontSize: 'var(--fs-12)',
                               color: 'var(--text-muted)' }}>
                  TISS {op.versaoTiss} — {op.totalPacientes} paciente(s) vinculado(s)
                </span>
              </div>

              <div style={{ display: 'flex', gap: 'var(--s-2)' }}>
                {op.ativa ? (
                  <Botao variante="fantasma" altura={28}
                    onClick={() => { void p.aoDesativar(op.id); }}>
                    Desativar
                  </Botao>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* Formulario de nova operadora */}
      <PainelLateral
        aberto={formAberto}
        titulo="Nova operadora"
        aoFechar={() => setFormAberto(false)}
      >
        <div style={{ display: 'grid', gap: 'var(--s-5)', marginTop: 'var(--s-4)' }}>
          <Campo rotulo="Nome" value={nome}
            onChange={(e) => setNome(e.target.value)}
            aria-label="Nome" required />
          <Campo rotulo="Registro ANS" value={registroAns}
            onChange={(e) => setRegistroAns(e.target.value)}
            aria-label="Registro ANS" maxLength={6} required />
          <Campo rotulo="Versao TISS" value={versaoTiss}
            onChange={(e) => setVersaoTiss(e.target.value)}
            aria-label="Versao TISS" />
          <Campo rotulo="CNPJ" value={cnpj}
            onChange={(e) => setCnpj(e.target.value)}
            aria-label="CNPJ" maxLength={14} />
          <Campo rotulo="E-mail" type="email" value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-label="E-mail" />
          <Campo rotulo="Telefone" type="tel" value={telefone}
            onChange={(e) => setTelefone(e.target.value)}
            aria-label="Telefone" />
          <Botao variante="primario" altura={40} onClick={salvar}>
            Salvar
          </Botao>
        </div>
      </PainelLateral>
    </div>
  );
}
