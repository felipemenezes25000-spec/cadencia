import { EncounterWorkspace } from '../../../src/components/clinical/EncounterWorkspace';

export default async function EncounterPage({ params }: { readonly params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EncounterWorkspace encounterId={id} />;
}
