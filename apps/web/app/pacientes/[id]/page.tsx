import { PatientWorkspace } from '../../../src/components/patients/PatientWorkspace';

export default async function PatientPage({ params }: { readonly params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PatientWorkspace patientId={id} />;
}
