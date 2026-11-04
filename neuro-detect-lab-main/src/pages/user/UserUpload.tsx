import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { Clock, ShieldCheck } from "lucide-react";
import ImageUpload from "@/components/ImageUpload";
import Loader from "@/components/Loader";
import { predictImage } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import type { PendingReviewResponse } from "@/lib/api";

const UserUpload = () => {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PendingReviewResponse | null>(null);

  const { user } = useAuth();
  const queryClient = useQueryClient();

  const handleAnalyze = async () => {
    if (!file) return;

    setLoading(true);
    try {
      // The patient receives NO AI output: only "received, waiting for your doctor" (human-in-the-loop)
      const res = (await predictImage(file, user?.token)) as unknown as PendingReviewResponse;
      setResult(res);
      await queryClient.invalidateQueries({ queryKey: ["history", user?.token] });
      toast.success("IRM reçue.");
    } catch (error: any) {
      setResult(null); // never leave an old result on screen after a failed analysis
      const msg = error?.response?.data?.message ?? "Echec de l'analyse. Veuillez reessayer.";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
        <h1 className="font-display text-2xl font-bold text-foreground">Televerser une IRM</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Envoyez une coupe IRM cérébrale à votre médecin. Une IA l'aide à l'examiner ; le résultat vous est
          communiqué après sa validation.
        </p>
      </motion.div>

      {result ? (
        <div className="mx-auto max-w-xl space-y-4">
          <div className="rounded-2xl border border-primary/20 bg-primary/5 p-6 text-center">
            <Clock className="mx-auto mb-3 h-10 w-10 text-primary" />
            <h2 className="font-display text-lg font-bold text-foreground">IRM reçue, en attente de l'avis de votre médecin</h2>
            <p className="mt-2 text-sm text-muted-foreground">{result.message}</p>
            {!result.sentToDoctor && (
              <Link to="/patient/conversations" className="mt-3 inline-block text-sm font-semibold text-primary hover:underline">
                Choisir mon médecin
              </Link>
            )}
          </div>
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
            Aucun résultat automatique ne vous est affiché : une IA peut se tromper, c'est votre médecin qui interprète l'IRM.
          </p>
          <div className="flex justify-center">
            <button
              onClick={() => {
                setResult(null);
                setFile(null);
              }}
              className="text-sm text-primary hover:underline"
            >
              Envoyer une autre IRM
            </button>
          </div>
        </div>
      ) : loading ? (
        <Loader />
      ) : (
        <div className="space-y-6">
          <ImageUpload onFileSelect={setFile} isLoading={loading} onAnalyze={handleAnalyze}
            actionLabel="Envoyer à mon médecin" loadingLabel="Envoi…" />
        </div>
      )}
    </div>
  );
};

export default UserUpload;
