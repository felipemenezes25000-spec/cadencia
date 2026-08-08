/**
 * Re-exporta useToast do ToastProvider para conveniencia de importacao.
 *
 * Uso:
 *   import { useToast } from "@/ui/useToast";
 *   const { toast } = useToast();
 *   toast({ tipo: "sucesso", mensagem: "Salvo!" });
 */
export { useToast } from "./ToastProvider";
