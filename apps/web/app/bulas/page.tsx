'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MagnifyingGlass, Pill, FileText, X } from '@phosphor-icons/react';

interface Drug {
  id: string;
  registroAnvisa: string;
  nome: string;
  principioAtivo: string;
  classeTerapeutica: string | null;
  concentracao: string | null;
  formaFarmaceutica: string | null;
  fabricante: string | null;
}

interface Leaflet {
  id: string;
  tipo: 'paciente' | 'profissional';
  conteudo: string;
  versao: string | null;
}

async function searchDrugs(query: string): Promise<Drug[]> {
  const res = await fetch(`/api/v1/drugs/search?q=${encodeURIComponent(query)}`);
  const data = await res.json();
  return data.itens ?? [];
}

async function getLeaflet(drugId: string, tipo: string): Promise<Leaflet | null> {
  const res = await fetch(`/api/v1/drugs/${drugId}/leaflet?tipo=${tipo}`);
  if (!res.ok) return null;
  const data = await res.json();
  return data.leaflet;
}

export default function BulasPage() {
  const [query, setQuery] = useState('');
  const [selectedDrug, setSelectedDrug] = useState<Drug | null>(null);
  const [leafletType, setLeafletType] = useState<'paciente' | 'profissional'>('paciente');

  const { data: results = [], isLoading } = useQuery({
    queryKey: ['drugs-search', query],
    queryFn: () => searchDrugs(query),
    enabled: query.length >= 3,
  });

  const { data: leaflet } = useQuery({
    queryKey: ['leaflet', selectedDrug?.id, leafletType],
    queryFn: () => selectedDrug ? getLeaflet(selectedDrug.id, leafletType) : null,
    enabled: !!selectedDrug,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Bulário de Medicamentos</h1>
        <p className="text-gray-500 mt-1">Busque medicamentos e consulte suas bulas.</p>
      </div>

      {/* Busca */}
      <div className="relative">
        <MagnifyingGlass size={20} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Busque por nome ou princípio ativo..."
          className="w-full pl-12 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        />
      </div>

      {/* Resultados */}
      {isLoading && (
        <div className="animate-pulse space-y-2">
          {[1, 2, 3].map((i) => <div key={i} className="h-16 bg-gray-200 rounded" />)}
        </div>
      )}

      {!isLoading && query.length >= 3 && results.length === 0 && (
        <div className="text-center py-12 text-gray-500">
          <Pill size={48} className="mx-auto text-gray-300" />
          <p className="mt-4">Nenhum medicamento encontrado.</p>
        </div>
      )}

      <div className="grid gap-4">
        {results.map((drug) => (
          <button
            key={drug.id}
            onClick={() => setSelectedDrug(drug)}
            className={`text-left p-4 border rounded-lg hover:border-blue-300 hover:bg-blue-50 transition-colors ${
              selectedDrug?.id === drug.id ? 'border-blue-500 bg-blue-50' : 'border-gray-200'
            }`}
          >
            <div className="flex items-start gap-3">
              <Pill size={24} className="text-blue-500 flex-shrink-0 mt-1" />
              <div className="flex-1">
                <h3 className="font-semibold">{drug.nome}</h3>
                <p className="text-sm text-gray-600">{drug.principioAtivo}</p>
                <div className="flex flex-wrap gap-2 mt-2 text-xs text-gray-500">
                  {drug.concentracao && <span>{drug.concentracao}</span>}
                  {drug.formaFarmaceutica && <span>{drug.formaFarmaceutica}</span>}
                  {drug.classeTerapeutica && <span className="bg-gray-100 px-2 py-0.5 rounded">{drug.classeTerapeutica}</span>}
                </div>
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Modal de Bula */}
      {selectedDrug && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-xl max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between p-4 border-b">
              <div>
                <h2 className="text-lg font-semibold">{selectedDrug.nome}</h2>
                <p className="text-sm text-gray-500">{selectedDrug.principioAtivo}</p>
              </div>
              <button onClick={() => setSelectedDrug(null)} className="p-2 hover:bg-gray-100 rounded-lg">
                <X size={20} />
              </button>
            </div>

            <div className="flex gap-2 p-4 border-b">
              <button
                onClick={() => setLeafletType('paciente')}
                className={`px-4 py-2 rounded-lg text-sm font-medium ${
                  leafletType === 'paciente' ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                Bula do Paciente
              </button>
              <button
                onClick={() => setLeafletType('profissional')}
                className={`px-4 py-2 rounded-lg text-sm font-medium ${
                  leafletType === 'profissional' ? 'bg-blue-100 text-blue-700' : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                Bula Profissional
              </button>
            </div>

            <div className="flex-1 overflow-auto p-6">
              {leaflet ? (
                <div className="prose prose-sm max-w-none whitespace-pre-wrap text-gray-700">
                  {leaflet.conteudo}
                </div>
              ) : (
                <div className="text-center py-12 text-gray-500">
                  <FileText size={48} className="mx-auto text-gray-300" />
                  <p className="mt-4">Bula não disponível.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
