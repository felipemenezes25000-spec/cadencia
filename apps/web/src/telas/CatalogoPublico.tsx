'use client';

import { type FormEvent, useState } from 'react';
import { apiFetch, ApiError } from '../api';
import { useSessao } from '../sessao';

interface Item { codigo: string; descricao: string; competencia: string }

export function CatalogoPublico({ titulo, descricao, endpoint }: { titulo: string; descricao: string; endpoint: 'ciap2' | 'sigtap' }) {
  const { clinicId, csrfToken } = useSessao();
  const [termo,setTermo]=useState(''),[itens,setItens]=useState<Item[]>([]),[mensagem,setMensagem]=useState<string|null>(null),[carregando,setCarregando]=useState(false);
  async function buscar(e:FormEvent){e.preventDefault();if(!termo.trim())return;setCarregando(true);setMensagem(null);try{const data=new Date().toISOString().slice(0,10);const r=await apiFetch<{itens:Item[]}>(`/v1/catalogos/${endpoint}?termo=${encodeURIComponent(termo.trim())}&data=${data}`,{clinicId,csrfToken});setItens(r.itens);if(r.itens.length===0)setMensagem('Nenhum resultado encontrado.');}catch(err){setItens([]);setMensagem(err instanceof ApiError&&err.status===503?'Catálogo ainda não carregado com a base oficial.':'Não foi possível consultar o catálogo.');}finally{setCarregando(false);}}
  return <div className="cadencia-page max-w-4xl space-y-5"><header><p className="cadencia-kicker">Terminologia SUS</p><h1 className="text-2xl font-bold text-text">{titulo}</h1><p className="mt-1 text-sm text-text-muted">{descricao}</p></header><form onSubmit={buscar} className="flex gap-2"><input value={termo} onChange={(e)=>setTermo(e.target.value)} placeholder="Código ou descrição" className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm"/><button disabled={carregando} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{carregando?'Buscando…':'Buscar'}</button></form>{mensagem?<p className="rounded-lg bg-surface-subtle p-3 text-sm text-text-muted">{mensagem}</p>:null}<ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">{itens.map((x)=><li key={`${x.codigo}-${x.competencia}`} className="grid gap-1 p-4 sm:grid-cols-[120px_1fr_auto] sm:items-center"><code className="font-semibold text-accent">{x.codigo}</code><span className="text-sm text-text">{x.descricao}</span><span className="text-xs text-text-faint">{x.competencia}</span></li>)}</ul></div>;
}
