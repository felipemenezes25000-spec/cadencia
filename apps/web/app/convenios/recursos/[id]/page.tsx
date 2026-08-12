'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Botao } from '../../../../src/ui/Botao';
import { apiFetch } from '../../../../src/api';
import { useSessao } from '../../../../src/sessao';

interface ItemDaApi {
  itemId: string;
  glosaId: string;
  justificativaItem: string;
  valorRecursadoCents: number;
  resultado: string | null;
}

interface RecursoDaApi {
  recursoId: string;
  operadoraNome: string;
  numeroRecurso: string;
  status: string;
  justificativaGeral: string | null;
  totalRecursadoCents: number;
  itens: ItemDaApi[];
}

function reais(centavos: number): string {
  return (centavos / 100).toLocaleString('pt-BR',
    { style: 'currency', currency: 'BRL' });
}

/**
 * O recurso de glosa aberto: item a item, com a justificativa de cada um.
 *
 * A lista de recursos já empurrava para esta URL, que não existia — tanto
 * "editar" quanto "ver resultado" davam 404. Recurso que não abre é recurso que
 * não se acompanha, e glosa não recorrida no prazo vira perda definitiva.
 */
export default function PaginaDetalheRecurso() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { clinicId, csrfToken } = useSessao();

  const [r, setR] = useState<RecursoDaApi | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const carregar = useCallback(async () => {
    try {
      setR(await apiFetch<RecursoDaApi>(
        `/v1/tiss/recursos/${id}`, { clinicId, csrfToken }));
    } catch {
      setErro('Não foi possível abrir o recurso.');
    }
  }, [id, clinicId, csrfToken]);

  useEffect(() => { void carregar(); }, [carregar]);

  if (erro !== null) {
    return <p role="alert" className="text-sm text-danger">{erro}</p>;
  }
  if (r === null) {
    return <p className="text-sm text-text-muted">Carregando…</p>;
  }

  const podeEnviar = r.status === 'pronto';

  return (
    <section className="grid gap-6" aria-labelledby="titulo-recurso">
      <div>
        <h2 id="titulo-recurso" className="text-lg font-semibold tracking-[-0.02em] text-text">Recurso {r.numeroRecurso}</h2>
        <p className="mt-1 text-sm text-text-muted">{r.operadoraNome} · {r.status} · {reais(r.totalRecursadoCents)} recursados</p>
      </div>

      {r.justificativaGeral !== null && r.justificativaGeral !== '' && (
        <section className="rounded-[var(--r-md)] border border-line bg-surface p-4">
          <h2 className="mb-1 text-sm font-semibold text-text">Justificativa geral</h2>
          <p className="text-sm text-text">{r.justificativaGeral}</p>
        </section>
      )}

      <section className="overflow-x-auto rounded-[var(--r-md)] border border-line bg-surface">
        <table className="w-full text-sm">
          <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-text-muted">
            <tr>
              <th className="px-4 py-2.5">Justificativa do item</th>
              <th className="px-4 py-2.5 text-right">Recursado</th>
              <th className="px-4 py-2.5">Resultado</th>
            </tr>
          </thead>
          <tbody>
            {r.itens.map((i) => (
              <tr key={i.itemId} className="border-b border-line last:border-b-0">
                <td className="px-4 py-2.5">{i.justificativaItem}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {reais(i.valorRecursadoCents)}
                </td>
                <td className="px-4 py-2.5">
                  {/* `null` é "a operadora ainda não respondeu", que é diferente
                      de indeferido. Mostrar vazio faria os dois parecerem iguais
                      e ninguém cobraria a resposta. */}
                  {i.resultado ?? <span className="text-text-muted">aguardando</span>}
                </td>
              </tr>
            ))}
            {r.itens.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-sm text-text-muted">
                  Nenhum item neste recurso.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <div className="flex gap-2">
        <Botao variante="fantasma" onClick={() => router.push('/convenios/recursos')}>
          Voltar
        </Botao>
        {podeEnviar && (
          <Botao
            disabled={enviando}
            onClick={() => {
              setEnviando(true);
              void apiFetch(`/v1/tiss/recursos/${id}/enviar`,
                { method: 'POST', clinicId, csrfToken })
                .then(carregar)
                .catch(() => setErro('Não foi possível enviar o recurso.'))
                .finally(() => setEnviando(false));
            }}
          >
            {enviando ? 'Enviando…' : 'Enviar à operadora'}
          </Botao>
        )}
      </div>
    </section>
  );
}
