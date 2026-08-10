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
 * Pagina IRMA de `/financeiro/repasse`, nao aba dentro dela: aquela tela mostra
 * o RESULTADO do rateio e e consultada toda semana; esta define a conta e e
 * mexida raramente. Misturar as duas poria um formulario de configuracao na
 * frente de quem so quer conferir quanto recebeu.
 */
export default function PaginaRegrasDeRepasse() {
  const { clinicId, csrfToken, vinculoAtivo } = useSessao();
  const [regras, setRegras] = useState<readonly RegraDeRepasse[]>([]);
  const [profissionais, setProfissionais] = useState<
    readonly { professionalId: string; nome: string }[]>([]);
  const [erro, setErro] = useState<string | null>(null);

  // `finance.settings` e permissao de quem define a conta, nao de quem a le. O
  // profissional ve o proprio repasse e nao muda o percentual dele.
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
    void carregar().catch(() => setErro('Nao foi possivel carregar as regras.'));
  }, [carregar]);

  if (!podeEditar) {
    return (
      <div className="cadencia-page grid min-h-[50vh] place-items-center">
        <div className="max-w-md text-center">
          <h1 className="text-lg font-semibold text-text">Regras sao da gestao</h1>
          <p className="mt-2 text-sm text-text-muted">
            Seu perfil ve o proprio repasse, mas nao define o percentual dele.
            Peca a quem administra a clinica.
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
