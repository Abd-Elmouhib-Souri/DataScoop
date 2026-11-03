import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { motion } from "framer-motion";
import AnalysisModelsPanel from "@/components/AnalysisModelsPanel";
import ImageUpload from "@/components/ImageUpload";
import Loader from "@/components/Loader";
import PredictionResult from "@/components/PredictionResult";
import { predictImage } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import type { PredictionResponse } from "@/lib/api";

const UserUpload = () => {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PredictionResponse | null>(null);

  const { user } = useAuth();
  const queryClient = useQueryClient();

  const handleAnalyze = async () => {
    if (!file) return;

    setLoading(true);
    try {
      const res: PredictionResponse = await predictImage(file, user?.token);
      setResult(res);
      await queryClient.invalidateQueries({ queryKey: ["history", user?.token] });
      toast.success("Analyse terminee.");
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
          Ajoutez une image IRM cerebrale pour une analyse Alzheimer assistee par IA.
        </p>
      </motion.div>

      {result ? (
        <div className="space-y-4">
          <PredictionResult data={result} />
          {result.sentToDoctor && (
            <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-sm text-primary">
              Analyse envoyee au medecin assigne.
            </div>
          )}
          <div className="flex justify-center">
            <button
              onClick={() => {
                setResult(null);
                setFile(null);
              }}
              className="text-sm text-primary hover:underline"
            >
              Analyser une autre IRM
            </button>
          </div>
        </div>
      ) : loading ? (
        <Loader />
      ) : (
        <div className="space-y-6">
          <AnalysisModelsPanel />
          <ImageUpload onFileSelect={setFile} isLoading={loading} onAnalyze={handleAnalyze} />
        </div>
      )}
    </div>
  );
};

export default UserUpload;
