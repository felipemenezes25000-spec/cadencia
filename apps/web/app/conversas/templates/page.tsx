'use client';

import { useCallback, useEffect, useState } from 'react';
import { TemplatesDeMensagem, type Template } from '../../../src/telas/TemplatesDeMensagem';
import { PageHeader } from '../../../src/ui/PageHeader';
import { apiFetch } from '../../../src/api';
import { useSessao } from '../../../src/sessao';

interface TemplateDaApi {
  templateId: string;
  name: string;
  bodyTemplate: string;
  category: string;
  channel: string;
  status?: string;
}

export default function PaginaTemplates() {
  const { clinicId, csrfToken } = useSessao();
  const [templates, setTemplates] = useState<readonly Template[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(async () => {
    try {
      const r = await apiFetch<{ itens: TemplateDaApi[] }>(
        '/v1/messaging/templates', { clinicId, csrfToken });
      setTemplates(r.itens.map((x) => ({
        id: x.templateId, titulo: x.name, conteudo: x.bodyTemplate,
      })));
    } catch {
      setErro('Nao foi possivel carregar os templates.');
    } finally {
      setCarregando(false);
    }
  }, [clinicId, csrfToken]);

  useEffect(() => { void carregar(); }, [carregar]);

  return (
    <div className="cadencia-page grid gap-6">
      <PageHeader
        titulo="Templates de mensagem"
        subtitulo={carregando ? 'Carregando…'
          : `${templates.length} ${templates.length === 1 ? 'template' : 'templates'} aprovados`}
      />

      {erro !== null && <p role="alert" className="text-sm text-danger">{erro}</p>}

      <TemplatesDeMensagem
        templates={templates}
        // Criar e editar exigem aprovacao da Meta antes de valer no WhatsApp, e
        // o fluxo de submissao ainda nao existe. Abrir um formulario que grava
        // um template que nunca sera aprovado faria a clinica montar campanha em
        // cima de mensagem que nao envia.
        aoCriar={() => setErro(
          'Criar template exige aprovacao da Meta. O fluxo de submissao ainda nao esta '
          + 'ligado — por enquanto os templates vem do painel do WhatsApp Business.')}
        aoEditar={() => setErro(
          'Editar template aprovado exige nova aprovacao da Meta. Ainda nao ligado.')}
        aoExcluir={() => setErro(
          'Excluir template no WhatsApp Business e feito no painel da Meta.')}
      />
    </div>
  );
}
