import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, Calendar, User, Loader2, ShieldCheck, AlertTriangle, CheckCircle2, PencilLine } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getPatient, reviewScan } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

const CLASSES = ["Non Demented", "Very Mild Demented", "Mild Demented", "Moderate Demented"];

interface ModelResult { prediction: string; confidence: number }
interface HistoryEntry {
  _id: string;
  date: string;
  diagnosis: string;                                   // AI suggestion (primary model)
  probabilities?: Record<string, number>;
  allModels?: Record<string, ModelResult>;
  bestModel?: string | null;
  irmImage?: string | null;
  review?: { status: "pending" | "validated" | "corrected"; finalDiagnosis?: string; comment?: string; reviewedAt?: string; reviewedBy?: string };
}
interface PatientRecord {
  _id: string;
  name: string;
  age?: number;
  symptoms?: string[];
  medicalHistory?: HistoryEntry[];
}

const pct = (v?: number) => `${((v ?? 0) * 100).toFixed(1)}%`;

/** One scan: AI suggestion (for the doctor only) + the doctor's decision. */
const ScanReviewCard = ({ patientId, entry, token, currentUserId }: { patientId: string; entry: HistoryEntry; token: string; currentUserId?: string }) => {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<"idle" | "correct">("idle");
  // "Corriger" means choosing ANOTHER class than the AI: the AI's class is not offered (use "Valider" for it)
  const otherClasses = CLASSES.filter((c) => c !== entry.diagnosis);
  const [finalDiagnosis, setFinalDiagnosis] = useState(otherClasses[0]);
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);

  const status = entry.review?.status ?? "pending";        // old entries without review = pending
  const models = Object.entries(entry.allModels ?? {});
  const distinct = new Set(models.map(([, r]) => r?.prediction).filter(Boolean));
  const disagree = distinct.size > 1;                      // models predict different classes -> uncertain
  const topProbs = Object.entries(entry.probabilities ?? {}).sort((a, b) => b[1] - a[1]);

  const submit = async (decision: "validated" | "corrected") => {
    setSaving(true);
    try {
      await reviewScan(patientId, entry._id, { decision, finalDiagnosis: decision === "corrected" ? finalDiagnosis : undefined, comment }, token);
      toast.success(decision === "validated" ? "Résultat validé : le patient peut le consulter." : "Diagnostic corrigé : le patient voit votre diagnostic.");
      await queryClient.invalidateQueries({ queryKey: ["patient", patientId] });
      await queryClient.invalidateQueries({ queryKey: ["pending-reviews"] });
    } catch (err: any) {
      toast.error(err?.response?.data?.message ?? "Échec de l'enregistrement.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Calendar className="h-3 w-3" /> {new Date(entry.date).toLocaleString("fr-FR")}
        </div>
        {status === "pending" ? (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">À valider</span>
        ) : (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">
            {status === "validated" ? "Validé" : "Corrigé"} : {entry.review?.finalDiagnosis}
          </span>
        )}
      </div>

      <div className="mt-3 grid gap-4 md:grid-cols-[140px_1fr]">
        {entry.irmImage ? (
          <img src={entry.irmImage} alt="IRM" className="h-36 w-36 rounded-xl border border-border bg-black object-contain" />
        ) : (
          <div className="flex h-36 w-36 items-center justify-center rounded-xl border border-dashed border-border text-xs text-muted-foreground">Pas d'image</div>
        )}

        <div className="space-y-2 text-sm">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Suggestion IA (visible par vous seul)</p>
          <p className="font-semibold text-foreground">
            {entry.diagnosis} <span className="text-xs font-normal text-muted-foreground">via {entry.bestModel ?? "modèle principal"}</span>
          </p>
          {topProbs.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Probabilités (non calibrées) : {topProbs.map(([c, v]) => `${c} ${pct(v)}`).join(" · ")}
            </p>
          )}
          {models.length > 0 && (
            <p className="text-xs text-muted-foreground">Modèles : {models.map(([n, r]) => `${n} → ${r.prediction}`).join(", ")}</p>
          )}
          {disagree && (
            <p className="flex items-center gap-1 rounded-lg bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-800">
              <AlertTriangle className="h-3.5 w-3.5" /> Les modèles ne sont pas d'accord : suggestion incertaine.
            </p>
          )}
          {status !== "pending" && entry.review?.comment && (
            // After a change of doctor, past reviews were written by the PREVIOUS doctor: say so
            <p className="text-xs text-foreground">
              {entry.review.reviewedBy && currentUserId && String(entry.review.reviewedBy) !== String(currentUserId)
                ? "Commentaire du médecin précédent" : "Votre commentaire"} : « {entry.review.comment} »
            </p>
          )}
        </div>
      </div>

      {status === "pending" && (
        <div className="mt-4 space-y-3 border-t border-border pt-3">
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={2000}
            placeholder="Commentaire pour le patient (facultatif) : prochaines étapes, examens complémentaires..."
            className="w-full rounded-xl border border-border bg-background p-2 text-sm"
            rows={2}
          />
          {mode === "correct" && (
            <select
              value={finalDiagnosis}
              onChange={(e) => setFinalDiagnosis(e.target.value)}
              className="w-full rounded-xl border border-border bg-background p-2 text-sm"
            >
              {otherClasses.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          <div className="flex flex-wrap gap-2">
            {mode === "idle" ? (
              <>
                <Button size="sm" disabled={saving} onClick={() => submit("validated")}>
                  <CheckCircle2 className="mr-1 h-4 w-4" /> Valider la suggestion
                </Button>
                <Button size="sm" variant="outline" disabled={saving} onClick={() => setMode("correct")}>
                  <PencilLine className="mr-1 h-4 w-4" /> Corriger
                </Button>
              </>
            ) : (
              <>
                <Button size="sm" disabled={saving} onClick={() => submit("corrected")}>Enregistrer mon diagnostic</Button>
                <Button size="sm" variant="ghost" disabled={saving} onClick={() => setMode("idle")}>Annuler</Button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const PatientDetails = () => {
  const { id } = useParams();
  const { user } = useAuth();

  const { data: patient, isLoading, error } = useQuery<PatientRecord>({
    queryKey: ["patient", id, user?.token],
    queryFn: () => getPatient(id!, user?.token || ""),
    enabled: !!id && !!user?.token,
  });

  if (error) toast.error("Dossier inaccessible (ce patient ne vous a peut-être pas choisi).");

  if (isLoading) {
    return <div className="flex justify-center p-6"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  }

  if (!patient) {
    return (
      <div className="p-6 text-center">
        <p className="text-muted-foreground">Patient introuvable.</p>
        <Button asChild variant="outline" className="mt-4 rounded-xl">
          <Link to="/doctor/patients"><ArrowLeft className="mr-2 h-4 w-4" />Retour</Link>
        </Button>
      </div>
    );
  }

  const scans = [...(patient.medicalHistory ?? [])].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const pendingCount = scans.filter((s) => (s.review?.status ?? "pending") === "pending").length;

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon" className="rounded-xl">
          <Link to="/doctor/patients"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">{patient.name}</h1>
          <p className="text-sm text-muted-foreground">Dossier patient et IRM à examiner</p>
        </div>
      </div>

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
        className="max-w-lg rounded-2xl border border-border bg-card p-5 shadow-card">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex items-center gap-2 text-sm">
            <User className="h-4 w-4 text-muted-foreground" />
            <span className="text-muted-foreground">Âge :</span>
            <span className="font-medium text-foreground">{patient.age ?? "—"}</span>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Symptômes :</span>
            <span className="font-medium text-foreground">{patient.symptoms?.length ? patient.symptoms.join(", ") : "Aucun"}</span>
          </div>
        </div>
      </motion.div>

      <div className="flex items-start gap-2 rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs text-primary">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
        Le patient ne voit aucun résultat de l'IA. Il voit uniquement le diagnostic que vous validez ou corrigez, avec votre commentaire.
      </div>

      <div>
        <h2 className="mb-4 text-sm font-semibold text-foreground">
          IRM ({scans.length}) {pendingCount > 0 && <span className="text-amber-700">· {pendingCount} à valider</span>}
        </h2>
        {scans.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucune IRM pour ce patient.</p>
        ) : (
          <div className="space-y-4">
            {scans.map((entry) => (
              <ScanReviewCard key={entry._id} patientId={patient._id} entry={entry} token={user?.token || ""} currentUserId={user?.id} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default PatientDetails;
