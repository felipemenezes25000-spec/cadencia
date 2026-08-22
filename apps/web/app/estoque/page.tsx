'use client';

import { FinanceiroEstoque, type EstoqueDados } from '../../src/telas/FinanceiroEstoque';
import { apiFetch } from '../../src/api';
import { useSessao } from '../../src/sessao';

interface ProdutoDaApi {
  productId: string;
  name: string;
  sku: string | null;
  unit: string;
  minStock: number;
  currentStock: number;
  active: boolean;
  createdAt: string;
}

export default function PaginaEstoque() {
  const { clinicId, csrfToken } = useSessao();
  return (
    <FinanceiroEstoque
      carregarDados={async () => {
        const r = await apiFetch<{ itens: ProdutoDaApi[] }>('/v1/products?active=true', { clinicId, csrfToken });
        const dados: EstoqueDados = {
          produtos: r.itens.map((p) => ({
            id: p.productId, nome: p.name, quantidade: p.currentStock, minimo: p.minStock,
            unidade: p.unit, ultimaMovimentacao: p.createdAt,
            alertaBaixo: p.currentStock <= p.minStock,
            ...(p.sku === null ? {} : { categoria: p.sku }),
          })),
          movimentacoes: [],
        };
        return dados;
      }}
      aoRegistrarMovimentacao={async () => { /* usa POST /v1/stock-movements */ }}
    />
  );
}
