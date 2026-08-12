import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { NextConfig } from 'next';
import withBundleAnalyzer from '@next/bundle-analyzer';

/**
 * Raiz do workspace, cravada.
 *
 * Sem isto o Next INFERE a raiz procurando lockfile para cima e, numa maquina
 * que tenha um `package-lock.json` no diretorio do usuario, ele elege a HOME
 * como raiz do projeto. O build passa a enxergar `node_modules` e configuracao
 * que nao pertencem ao repositorio, e o resultado deixa de ser reproduzivel:
 * verde no CI, vermelho na maquina de quem programa, por motivo nenhum do codigo.
 */
const RAIZ_DO_WORKSPACE = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * A API atende em outra porta, mas o navegador precisa ver UMA origem so.
 *
 * O cookie de sessao usa o prefixo `__Host-`, que o navegador so aceita com
 * Secure, Path=/ e SEM Domain — ou seja, ele e cravado na origem exata. Servir
 * front e API em origens diferentes exigiria CORS com credenciais e ainda
 * assim deixaria o cookie fora do alcance em produção. O rewrite resolve na
 * raiz: para o navegador, /v1/* e a mesma origem do app.
 */
const ALVO_API = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://127.0.0.1:3001';
// Em produção, a API está no mesmo domínio via rewrite do Vercel
// Para desenvolvimento local, usa localhost:3001
// A variável de ambiente NEXT_PUBLIC_API_URL é configurada no Vercel

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  outputFileTracingRoot: RAIZ_DO_WORKSPACE,
  /**
   * Lazy loading de componentes pesados para reduzir first load JS.
   *
   * Estes módulos são carregados sob demanda:
   * - Tiptap: editor clínico rico
   * - Visx: gráficos de relatórios
   * - dnd-kit: drag-and-drop da agenda
   * - Phosphor Icons: ícones (parcial)
   */
  experimental: {
    optimizePackageImports: ['@phosphor-icons/react', '@visx/axis', '@visx/shape', '@visx/grid'],
  },
  /**
   * Lazy loading explícito para componentes grandes.
   */
  modularizeImports: {
    '@tiptap/react': {
      transform: '{{module}}',
    },
  },
  /**
   * Este repositorio nao usa ESLint: a rede de seguranca e `tsc` em strict, os
   * lints proprios em `tools/check-*.ts` e o `arch:check` do dependency-cruiser.
   *
   * Sem esta linha o `next build` procura configuracao de ESLint subindo a
   * arvore de diretorios e adota a primeira que encontrar FORA do repositorio —
   * na pratica, o `eslint.config.js` que sobrou de outro projeto na HOME de quem
   * programa. O build entao reprova por regra que este projeto nunca adotou, e
   * reprova so nessa maquina. Se um dia o ESLint entrar aqui de verdade, ele
   * entra com config propria na raiz e esta linha sai junto.
   */
  eslint: { ignoreDuringBuilds: true },
  async rewrites() {
    return [{ source: '/v1/:caminho*', destination: `${ALVO_API}/v1/:caminho*` }];
  },
};

/**
 * Bundle Analyzer - habilitado via ANALYZE=true pnpm build
 *
 * Gera relatório HTML em .next/analyze/
 * Usa '@next/bundle-analyzer' para visualização interativa
 */
const nextConfig = process.env.ANALYZE === 'true'
  ? withBundleAnalyzer({ enabled: true })(config)
  : config;

export default nextConfig;
