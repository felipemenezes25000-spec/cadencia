import Link from 'next/link';
import { MagnifyingGlass } from '@phosphor-icons/react/dist/ssr';

export default function NotFound() {
  return (
    <div className="cadencia-page grid min-h-[60vh] place-items-center">
      <section className="w-full max-w-lg rounded-2xl border border-line bg-surface p-6 text-center">
        <span className="mx-auto grid size-11 place-items-center rounded-xl bg-accent-soft text-accent"><MagnifyingGlass size={23} aria-hidden /></span>
        <h1 className="mt-4 text-xl font-bold text-text">Tela não encontrada</h1>
        <p className="mt-2 text-sm text-text-muted">O endereço pode ter mudado ou este registro não está disponível nesta unidade.</p>
        <Link href="/hoje" className="mt-5 inline-flex h-9 items-center justify-center rounded-lg bg-accent px-4 text-sm font-semibold text-white hover:bg-accent-hover">Voltar para Hoje</Link>
      </section>
    </div>
  );
}
