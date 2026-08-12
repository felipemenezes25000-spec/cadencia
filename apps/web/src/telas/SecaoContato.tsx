'use client';

import { useState } from 'react';
import { Campo } from '../ui/Campo';
import { Botao } from '../ui/Botao';

export interface ContatoPayload {
  readonly phonePrimary?: string | null;
  readonly phoneSecondary?: string | null;
  readonly email?: string | null;
  readonly emergencyContactName?: string | null;
  readonly emergencyContactPhone?: string | null;
}

export interface SecaoContatoProps {
  readonly phonePrimary: string | null;
  readonly phoneSecondary: string | null;
  readonly email: string | null;
  readonly emergencyContactName: string | null;
  readonly emergencyContactPhone: string | null;
  readonly aoSalvar: (dados: ContatoPayload) => Promise<void>;
  readonly editavel: boolean;
}

function formatarTelefone(tel: string | null): string {
  if (!tel) return '--';
  if (tel.length === 11) {
    return `(${tel.slice(0, 2)}) ${tel.slice(2, 7)}-${tel.slice(7)}`;
  }
  return tel;
}

export function SecaoContato(props: SecaoContatoProps) {
  const [editando, setEditando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [fone, setFone] = useState(props.phonePrimary ?? '');
  const [foneSec, setFoneSec] = useState(props.phoneSecondary ?? '');
  const [email, setEmail] = useState(props.email ?? '');
  const [emNome, setEmNome] = useState(props.emergencyContactName ?? '');
  const [emFone, setEmFone] = useState(props.emergencyContactPhone ?? '');

  const foneDigitos = fone.replace(/\D+/g, '');
  const foneSecDigitos = foneSec.replace(/\D+/g, '');
  const emFoneDigitos = emFone.replace(/\D+/g, '');

  const foneValido = fone === '' || foneDigitos.length >= 10;
  const foneSecValido = foneSec === '' || foneSecDigitos.length >= 10;
  const emFoneValido = emFone === '' || emFoneDigitos.length >= 10;
  const canalOk = foneDigitos.length >= 10 || email.trim().length > 0;

  const podeSalvar = foneValido && foneSecValido && emFoneValido && canalOk && !salvando;

  function iniciarEdicao() {
    setFone(props.phonePrimary ?? '');
    setFoneSec(props.phoneSecondary ?? '');
    setEmail(props.email ?? '');
    setEmNome(props.emergencyContactName ?? '');
    setEmFone(props.emergencyContactPhone ?? '');
    setEditando(true);
  }

  async function salvar() {
    setSalvando(true);
    try {
      await props.aoSalvar({
        phonePrimary: foneDigitos.length > 0 ? foneDigitos : null,
        phoneSecondary: foneSecDigitos.length > 0 ? foneSecDigitos : null,
        email: email.trim() || null,
        emergencyContactName: emNome.trim() || null,
        emergencyContactPhone: emFoneDigitos.length > 0 ? emFoneDigitos : null,
      });
      setEditando(false);
    } finally {
      setSalvando(false);
    }
  }

  if (!editando) {
    return (
      <section aria-label="Informações de contato" className="rounded-xl border border-line bg-surface shadow-elev-1 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-text">Contato</h2>
          {props.editavel && (
            <Botao variante="fantasma" tamanho="sm" onClick={iniciarEdicao}>
              Editar
            </Botao>
          )}
        </div>
        <dl className="grid gap-3 text-sm">
          <div>
            <dt className="text-text-muted">Telefone principal</dt>
            <dd className="m-0 font-medium text-text">{formatarTelefone(props.phonePrimary)}</dd>
          </div>
          <div>
            <dt className="text-text-muted">Telefone secundário</dt>
            <dd className="m-0 font-medium text-text">{formatarTelefone(props.phoneSecondary)}</dd>
          </div>
          <div>
            <dt className="text-text-muted">Email</dt>
            <dd className="m-0 font-medium text-text">{props.email ?? '--'}</dd>
          </div>
        </dl>

        {(props.emergencyContactName || props.emergencyContactPhone) && (
          <div className="mt-4 border-t border-line pt-3">
            <h3 className="mb-2 text-sm font-semibold text-text">Contato de emergência</h3>
            <dl className="grid gap-3 text-sm">
              <div>
                <dt className="text-text-muted">Nome</dt>
                <dd className="m-0 font-medium text-text">{props.emergencyContactName ?? '--'}</dd>
              </div>
              <div>
                <dt className="text-text-muted">Telefone</dt>
                <dd className="m-0 font-medium text-text">{formatarTelefone(props.emergencyContactPhone)}</dd>
              </div>
            </dl>
          </div>
        )}
      </section>
    );
  }

  return (
    <section aria-label="Editar contato" className="rounded-xl border border-line bg-surface shadow-elev-1 p-4">
      <h2 className="mb-3 text-sm font-semibold text-text">Editar contato</h2>
      <div className="grid gap-3">
        <Campo
          rotulo="Telefone principal"
          value={fone}
          onChange={(e) => setFone(e.target.value)}
          placeholder="(XX) XXXXX-XXXX"
          {...(!foneValido ? { erro: 'Mínimo 10 dígitos' } : {})}
        />
        <Campo
          rotulo="Telefone secundário"
          value={foneSec}
          onChange={(e) => setFoneSec(e.target.value)}
          placeholder="(XX) XXXXX-XXXX"
          {...(!foneSecValido ? { erro: 'Mínimo 10 dígitos' } : {})}
        />
        <Campo
          rotulo="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="email@exemplo.com"
        />
        <div className="border-t border-line pt-3 mt-1">
          <h3 className="mb-2 text-sm font-semibold text-text">Contato de emergência</h3>
          <div className="grid gap-3">
            <Campo
              rotulo="Nome"
              value={emNome}
              onChange={(e) => setEmNome(e.target.value)}
              placeholder="Nome do contato"
            />
            <Campo
              rotulo="Telefone"
              value={emFone}
              onChange={(e) => setEmFone(e.target.value)}
              placeholder="(XX) XXXXX-XXXX"
              {...(!emFoneValido ? { erro: 'Mínimo 10 dígitos' } : {})}
            />
          </div>
        </div>
        {!canalOk && (
          <p className="text-sm text-danger" role="alert">
            Informe ao menos um telefone principal ou email.
          </p>
        )}
        <div className="flex gap-2 justify-end mt-2">
          <Botao variante="fantasma" onClick={() => setEditando(false)} disabled={salvando}>
            Cancelar
          </Botao>
          <Botao onClick={salvar} disabled={!podeSalvar} carregando={salvando}>
            Salvar
          </Botao>
        </div>
      </div>
    </section>
  );
}
