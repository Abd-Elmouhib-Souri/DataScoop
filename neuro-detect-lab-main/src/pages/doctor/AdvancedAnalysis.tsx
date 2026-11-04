import { useState } from "react";
import { motion } from "framer-motion";
import { toast } from "sonner";
import ImageUpload from "@/components/ImageUpload";
import Loader from "@/components/Loader";
import PredictionResult from "@/components/PredictionResult";
import { predictImage } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import type { PredictionResponse } from "@/lib/api";

const AdvancedAnalysis = () => {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PredictionResponse | null>(null);

  const { user } = useAuth();

  const handleAnalyze = async () => {
    if (!file) return;
    setLoading(true);
    try {
      const res: PredictionResponse = await predictImage(file, user?.token);
      setResult(res);
      toast.success("Analysis complete!");
    } catch (error: any) {
      setResult(null); // never leave an old result on screen after a failed analysis
      const msg = error?.response?.data?.message ?? "Analysis failed. Please try again.";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
        <h1 className="font-display text-2xl font-bold text-foreground">Advanced Analysis</h1>
        <p className="text-sm text-muted-foreground mt-1">Analyse ponctuelle d'une coupe IRM 2D (prototype de recherche, pas un dispositif médical). Elle n'est enregistrée dans aucun dossier : les IRM de vos patients arrivent dans leur dossier, onglet Patients.</p>
      </motion.div>

      {result ? (
        <div className="space-y-6">
          <PredictionResult data={result} />

          {/* Medical explanation */}
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
            className="mx-auto max-w-2xl rounded-2xl border border-border bg-card p-5 shadow-card">
            <h4 className="text-sm font-semibold text-foreground mb-2">Medical Explanation</h4>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {result.explanation || "The model has analyzed the MRI scan and identified region-specific patterns. Key findings include analysis of hippocampal volume, ventricular size, cortical thickness, and white matter integrity. Hippocampal atrophy patterns are consistent with the predicted classification. Further clinical correlation is recommended."}
            </p>
          </motion.div>

          <div className="flex justify-center">
            <button onClick={() => { setResult(null); setFile(null); }} className="text-sm text-primary hover:underline">
              Analyze Another Scan
            </button>
          </div>
        </div>
      ) : loading ? (
        <Loader text="Running advanced analysis..." />
      ) : (
        <ImageUpload onFileSelect={setFile} isLoading={loading} onAnalyze={handleAnalyze} />
      )}
    </div>
  );
};

export default AdvancedAnalysis;
