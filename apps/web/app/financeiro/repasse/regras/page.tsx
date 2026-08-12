'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { RegrasDeRepasse, type RegraDeRepasse } from '../../../../src/ui/RegrasDeRepasse';
import { PageHeader } from '../../../../src/ui/PageHeader';
import { apiFetch } from '../../../../src/api';
import { useSessao } from '../../../../src/sessao';

/**
 * Cadastro das regras de repasse.
 *
 * Página IRMÃ de `/financeiro/repasse`, não aba dentro dela: aquela tela mostra
 * o RESULTADO do rateio e é consultada toda semana; esta define a conta e é
 * mexida raramente. Misturar as duas poria um formulário de configuração na
 * frente de quem só quer conferir quanto recebeu.
 */
export default function PaginaRegrasDeRepasse() {
  const { clinicId, csrfToken, vinculoAtivo } = useSessao();
  const [regras, setRegras] = useState<readonly RegraDeRepasse[]>([]);
  const [profissionais, setProfissionais] = useState<
    readonly { professionalId: string; nome: string }[]>([]);
  const [erro, setErro] = useState<string | null>(null);

  // `finance.settings` é permissão de quem define a conta, não de quem a lê. O
  // profissional vê o próprio repasse e não muda o percentual dele.
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
      <div className="cadencia-page grid min-h-[50vh] place-items-center">
        <div className="max-w-md text-center">
          <h1 className="text-lg font-semibold text-text">Regras são da gestão</h1>
          <p className="mt-2 text-sm text-text-muted">
            Seu perfil vê o próprio repasse, mas não define o percentual dele.
            Peça a quem administra a clínica.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="cadencia-page grid gap-5">
      <PageHeader
        titulo="Regras de repasse"
        subtitulo="A conta que gera o rateio. Quando duas regras casam com o mesmo atendimento, vence a de menor prioridade."
        acoes={
          <Link href="/financeiro/repasse"
            className="text-sm text-accent underline-offset-4 hover:underline">
            Ver os repasses calculados →
          </Link>
        }
      />
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
    </div>
  );
}
