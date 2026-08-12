'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { RegrasDeRepasse, type RegraDeRepasse } from '../../../../src/ui/RegrasDeRepasse';
import { apiFetch } from '../../../../src/api';
import { useSessao } from '../../../../src/sessao';

export default function PaginaRegrasDeRepasse() {
  const { clinicId, csrfToken, vinculoAtivo } = useSessao();
  const [regras, setRegras] = useState<readonly RegraDeRepasse[]>([]);
  const [profissionais, setProfissionais] = useState<
    readonly { professionalId: string; nome: string }[]>([]);
  const [erro, setErro] = useState<string | null>(null);

  const podeEditar = vinculoAtivo.role === 'admin_clinico'
    || vinculoAtivo.role === 'diretor_tecnico'
    || vinculoAtivo.role === 'financeiro';

  const carregar = useCallback(async () => {
    const [r, p] = await Promise.all([
      apiFetch<{ rules: RegraDeRepasse[] }>('/v1/split-rules', { clinicId, csrfToken })
        .catch(() => ({ rules: [] as RegraDeRepasse[] })),
      apiFetch<{ itens: { professionalId: string; nome: string }[] }>(
        '/v1/profissionais', { clinicId, csrfToken })
        .catch(() => ({ itens: [] as { professionalId: string; nome: string }[] })),
    ]);
    setRegras(r.rules);
    setProfissionais(p.itens);
  }, [clinicId, csrfToken]);

  useEffect(() => {
    void carregar().catch(() => setErro('Não foi possível carregar as regras.'));
  }, [carregar]);

  if (!podeEditar) {
    return (
      <div className="grid min-h-[40vh] place-items-center">
        <div className="max-w-md text-center">
          <h2 className="text-lg font-semibold text-text">Regras são da gestão</h2>
          <p className="mt-2 text-sm text-text-muted">
            Seu perfil vê o próprio repasse, mas não define o percentual dele.
            Peça a quem administra a clínica.
          </p>
        </div>
      </div>
    );
  }

  return (
    <section className="grid gap-5" aria-labelledby="titulo-regras-repasse">
      <div className="flex flex-col gap-3 border-b border-line pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="titulo-regras-repasse" className="text-lg font-semibold tracking-[-0.02em] text-text">Regras de repasse</h2>
          <p className="mt-1 max-w-3xl text-sm text-text-muted">A conta que gera o rateio. Quando duas regras casam com o mesmo atendimento, vence a de menor prioridade.</p>
        </div>
        <Link href="/financeiro/repasse" className="text-sm font-semibold text-accent underline-offset-4 hover:underline">
          Ver os repasses calculados →
        </Link>
      </div>
      {erro !== null && <p role="alert" className="text-sm text-danger">{erro}</p>}
      <RegrasDeRepasse
        regras={regras}
        profissionais={profissionais}
        aoCriar={async (r) => {
          await apiFetch('/v1/split-rules', {
            method: 'POST', body: r, clinicId, csrfToken });
          await carregar();
        }}
      />
    </section>
  );
}
