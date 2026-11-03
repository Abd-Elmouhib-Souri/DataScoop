import { motion } from "framer-motion";
import {
  ShieldCheck,
  AlertTriangle,
  AlertCircle,
  Activity,
  Trophy,
  Cpu,
  Clock,
  CheckCircle2,
  Zap,
  ChevronDown,
  ChevronUp,
  Brain,
  Moon,
  Apple,
  HeartPulse,
  BookOpen,
  Home,
  ClipboardList,
} from "lucide-react";
import { useState } from "react";
import type { ReactNode } from "react";
import type { PredictionResponse, ModelResult, StageRecommendations } from "@/lib/api";

const STAGE_CONFIG: Record<
  string,
  {
    color: string;
    bg: string;
    border: string;
    icon: ReactNode;
    text: string;
  }
> = {
  "Non Demented": {
    color: "text-severity-healthy",
    bg: "bg-severity-healthy/10",
    border: "border-severity-healthy/30",
    icon: <ShieldCheck className="h-7 w-7" />,
    text: "Aucune anomalie detectee. Structures cerebrales stables.",
  },
  "Very Mild Demented": {
    color: "text-severity-mild",
    bg: "bg-severity-mild/10",
    border: "border-severity-mild/30",
    icon: <Activity className="h-7 w-7" />,
    text: "Declin cognitif tres leger avec changements subtils.",
  },
  "Mild Demented": {
    color: "text-severity-moderate",
    bg: "bg-severity-moderate/10",
    border: "border-severity-moderate/30",
    icon: <AlertTriangle className="h-7 w-7" />,
    text: "Demence legere avec signes compatibles a surveiller de pres.",
  },
  "Moderate Demented": {
    color: "text-severity-severe",
    bg: "bg-severity-severe/10",
    border: "border-severity-severe/30",
    icon: <AlertCircle className="h-7 w-7" />,
    text: "Demence moderee avec atrophie visible. Evaluation medicale rapide conseillee.",
  },
  "Severe Demented": {
    color: "text-severity-severe",
    bg: "bg-severity-severe/10",
    border: "border-severity-severe/30",
    icon: <AlertCircle className="h-7 w-7" />,
    text: "Atteinte cognitive severe detectee. Prise en charge medicale specialisee urgente recommandee.",
  },
};

const BAR_COLORS: Record<string, string> = {
  "Non Demented": "bg-severity-healthy",
  "Very Mild Demented": "bg-severity-mild",
  "Mild Demented": "bg-severity-moderate",
  "Moderate Demented": "bg-severity-severe",
  "Severe Demented": "bg-severity-severe",
};

const MODEL_BADGES: Record<string, string> = {
  BestModel: "BEST",
  EfficientNetB0: "B0",
  EfficientNetB3: "B3",
  EfficientNetB4: "B4",
  AlzheimerCNN: "CNN",
  UltraBestModel: "ULTRA",
  ResNet50: "RESNET",
  CustomCNN: "CNN",
};

const RANK_LABELS = ["1", "2", "3", "4", "5"];

const RECOMMENDATION_SECTIONS: Array<{
  key: keyof StageRecommendations;
  label: string;
  icon: ReactNode;
}> = [
  {
    key: "cognitiveExercises",
    label: "Exercices cognitifs",
    icon: <Brain className="h-4 w-4" />,
  },
  {
    key: "dailyRoutine",
    label: "Routine quotidienne",
    icon: <ClipboardList className="h-4 w-4" />,
  },
  {
    key: "sleep",
    label: "Sommeil",
    icon: <Moon className="h-4 w-4" />,
  },
  {
    key: "nutrition",
    label: "Nutrition",
    icon: <Apple className="h-4 w-4" />,
  },
  {
    key: "physicalActivity",
    label: "Activite physique douce",
    icon: <HeartPulse className="h-4 w-4" />,
  },
  {
    key: "mentalStimulation",
    label: "Stimulation mentale",
    icon: <BookOpen className="h-4 w-4" />,
  },
  {
    key: "homeSupport",
    label: "Aide et environnement",
    icon: <Home className="h-4 w-4" />,
  },
];

const ProbBars = ({ probs, compact = false }: { probs: Record<string, number>; compact?: boolean }) => (
  <div className={`space-y-${compact ? "1.5" : "2"}`}>
    {Object.entries(probs)
      .sort((a, b) => b[1] - a[1])
      .map(([label, value]) => (
        <div key={label}>
          <div className="mb-0.5 flex justify-between text-xs">
            <span className="max-w-[160px] truncate text-muted-foreground">{label}</span>
            <span className="ml-2 font-semibold text-foreground">{(value * 100).toFixed(1)}%</span>
          </div>
          <div className={`${compact ? "h-1.5" : "h-2"} overflow-hidden rounded-full bg-muted`}>
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${value * 100}%` }}
              transition={{ duration: 0.7, ease: "easeOut" }}
              className={`h-full rounded-full ${BAR_COLORS[label] ?? "bg-primary"}`}
            />
          </div>
        </div>
      ))}
  </div>
);

const BestModelHighlight = ({
  modelName,
  result,
}: {
  modelName: string;
  result: ModelResult;
}) => {
  const cfg = STAGE_CONFIG[result.prediction] ?? STAGE_CONFIG["Non Demented"];

  return (
    <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-primary px-2.5 py-1 text-xs font-bold text-primary-foreground">
            <Trophy className="h-3.5 w-3.5" />
            Modele le plus performant
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-base font-semibold text-foreground">{modelName}</span>
            <span className="rounded-md border border-border bg-background px-2 py-1 text-xs font-semibold text-foreground">
              {MODEL_BADGES[modelName] ?? modelName}
            </span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${cfg.bg} ${cfg.color}`}>
              {result.prediction}
            </span>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">{result.description}</p>
        </div>

        <div className="text-right">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Confiance</div>
          <div className={`text-2xl font-bold ${cfg.color}`}>{(result.confidence * 100).toFixed(1)}%</div>
          <div className="mt-1 text-xs text-muted-foreground">{result.inference_time_ms} ms</div>
        </div>
      </div>
    </div>
  );
};

const ModelSummaryTable = ({
  rankedNames,
  allModels,
  bestModel,
}: {
  rankedNames: string[];
  allModels: Record<string, ModelResult>;
  bestModel: string | null;
}) => (
  <div className="space-y-3 rounded-2xl border border-border bg-card p-5 shadow-card">
    <div className="flex items-center justify-between gap-3">
      <h4 className="text-sm font-semibold text-foreground">Predictions et pourcentages de tous les modeles</h4>
      <span className="text-xs text-muted-foreground">Classement compare sur cette IRM</span>
    </div>

    <div className="overflow-hidden rounded-xl border border-border/70">
      <div className="grid grid-cols-[0.55fr_0.2fr_0.25fr] bg-muted/40 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <span>Modele</span>
        <span>Score</span>
        <span>Prediction</span>
      </div>

      {rankedNames.map((name, index) => {
        const result = allModels[name];
        if (!result) return null;

        return (
          <div
            key={name}
            className={`grid grid-cols-[0.55fr_0.2fr_0.25fr] items-center gap-3 border-t border-border/60 px-4 py-3 text-sm ${
              name === bestModel ? "bg-primary/5" : "bg-background"
            }`}
          >
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs font-bold text-foreground">
              {index + 1}
            </span>
            <div className="min-w-0">
              <p className="font-medium text-foreground">{name}</p>
              <p className="truncate text-xs text-muted-foreground">{result.prediction}</p>
            </div>
            {name === bestModel && (
              <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold text-primary-foreground">
                BEST
              </span>
              )}
            </div>
            <span className="font-semibold text-foreground">{(result.confidence * 100).toFixed(1)}%</span>
            <span className="text-muted-foreground">{result.prediction}</span>
          </div>
        );
      })}
    </div>
  </div>
);

const ModelCard = ({
  name,
  result,
  rank,
  isBest,
  isExpanded,
  onToggle,
}: {
  name: string;
  result: ModelResult;
  rank: number;
  isBest: boolean;
  isExpanded: boolean;
  onToggle: () => void;
}) => {
  const cfg = STAGE_CONFIG[result.prediction] ?? STAGE_CONFIG["Non Demented"];

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: rank * 0.07 }}
      className={`overflow-hidden rounded-2xl border ${
        isBest ? "border-primary bg-primary/5 shadow-md ring-1 ring-primary/20" : "border-border bg-card"
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-muted/20"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-sm font-semibold text-foreground">
          {RANK_LABELS[rank] ?? rank + 1}
        </span>
        <span className="rounded-md border border-border px-2 py-1 text-xs font-semibold text-foreground">
          {MODEL_BADGES[name] ?? name}
        </span>
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-foreground">{name}</span>
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${cfg.bg} ${cfg.color}`}>
              {result.prediction}
            </span>
            {isBest && (
              <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-xs font-bold text-primary-foreground">
                <Trophy className="h-3 w-3" /> Meilleur score
              </span>
            )}
            {result.mode === "real" ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-1.5 py-0.5 text-xs text-green-700 dark:bg-green-900/30 dark:text-green-400">
                <CheckCircle2 className="h-3 w-3" /> Modele reel
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                <Zap className="h-3 w-3" /> Simulation
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{result.description}</p>
        </div>
        <div className="shrink-0 text-right">
          <div className={`text-sm font-bold ${cfg.color}`}>{(result.confidence * 100).toFixed(1)}%</div>
          <div className="flex items-center justify-end gap-1 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" /> {result.inference_time_ms} ms
          </div>
        </div>
        {isExpanded ? (
          <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
      </button>

      {isExpanded && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          className="space-y-3 border-t border-border px-4 pb-4 pt-1"
        >
          <div className={`inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 ${cfg.bg} ${cfg.border}`}>
            <span className={cfg.color}>{cfg.icon}</span>
            <span className={`text-sm font-semibold ${cfg.color}`}>{result.prediction}</span>
          </div>
          <ProbBars probs={result.probabilities} compact />
        </motion.div>
      )}
    </motion.div>
  );
};

const PredictionResult = ({ data }: { data: PredictionResponse }) => {
  const [expandedModel, setExpandedModel] = useState<string | null>(null);
  const cfg = STAGE_CONFIG[data.prediction] ?? STAGE_CONFIG["Non Demented"];

  const allModels = data.all_models ?? (data as PredictionResponse & { allModels?: Record<string, ModelResult> }).allModels ?? {};
  const rankedNames =
    data.ranked_models ??
    (data as PredictionResponse & { rankedModels?: string[] }).rankedModels ??
    Object.keys(allModels).sort((a, b) => (allModels[b]?.confidence ?? 0) - (allModels[a]?.confidence ?? 0));
  const bestModel =
    data.best_model ??
    (data as PredictionResponse & { bestModel?: string | null }).bestModel ??
    rankedNames[0] ??
    null;
  const hasModels = Object.keys(allModels).length > 0 && rankedNames.length > 0;
  const totalModels =
    data.total_models ??
    (data as PredictionResponse & { totalModels?: number }).totalModels ??
    rankedNames.length ??
    0;
  const bestResult = bestModel ? allModels[bestModel] : undefined;
  const bestConfidence = bestResult ? (bestResult.confidence * 100).toFixed(1) : null;
  const summaryText = bestResult?.description ?? cfg.text;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-auto w-full max-w-2xl space-y-5"
    >
      <div className={`rounded-2xl border-2 p-5 ${cfg.border} ${cfg.bg}`}>
        <div className="flex items-start gap-4">
          <div className={`${cfg.color} mt-0.5 shrink-0`}>{cfg.icon}</div>
          <div className="flex-1">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <h3 className={`font-display text-xl font-bold ${cfg.color}`}>{data.prediction}</h3>
              {bestModel && (
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                  via {bestModel}
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground">{summaryText}</p>
            {bestModel && bestConfidence && (
              <p className="mt-2 rounded-xl border border-primary/20 bg-primary/5 px-3 py-2 text-xs font-medium text-primary">
                Pour cette IRM, tous les modeles sont testes puis compares. Le resultat final retenu vient de{" "}
                <span className="font-semibold">{bestModel}</span>, qui a obtenu la meilleure performance sur
                cette image avec <span className="font-semibold">{bestConfidence}%</span> de confiance.
              </p>
            )}
            {data.explanation && (
              <p className="mt-2 border-t border-border/50 pt-2 text-xs italic text-muted-foreground">
                {data.explanation}
              </p>
            )}
          </div>
        </div>

        {hasModels && (
          <div className="mt-4 flex flex-wrap gap-3 border-t border-border/40 pt-4">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Cpu className="h-3.5 w-3.5" />
              <span>{totalModels} modeles analyses</span>
            </div>
            {data.total_time_ms != null && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                <span>Temps total : {data.total_time_ms} ms</span>
              </div>
            )}
          </div>
        )}
      </div>

      {bestModel && bestResult && <BestModelHighlight modelName={bestModel} result={bestResult} />}

      <div className="space-y-3 rounded-2xl border border-border bg-card p-5 shadow-card">
        <h4 className="text-sm font-semibold text-foreground">
          Scores de probabilite - {bestModel ?? "Analyse IA"}
        </h4>
        <ProbBars probs={data.probabilities} />
      </div>

      {hasModels && (
        <ModelSummaryTable rankedNames={rankedNames} allModels={allModels} bestModel={bestModel} />
      )}

      {data.recommendations && (
        <div className="space-y-4 rounded-2xl border border-border bg-card p-5 shadow-card">
          <div className="flex items-start gap-3">
            <div className={`mt-0.5 rounded-xl p-2 ${cfg.bg} ${cfg.color}`}>
              <ClipboardList className="h-5 w-5" />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-foreground">Recommandations personnalisees</h4>
              <p className="mt-1 text-sm text-muted-foreground">{data.recommendations.summary}</p>
            </div>
          </div>

          {data.recommendations.lifestyle.length > 0 && (
            <div className={`rounded-2xl border p-4 ${cfg.border} ${cfg.bg}`}>
              <p className={`text-sm font-semibold ${cfg.color}`}>{data.recommendations.title}</p>
              <ul className="mt-2 space-y-2 text-sm text-foreground">
                {data.recommendations.lifestyle.map((item) => (
                  <li key={item} className="flex gap-2">
                    <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${BAR_COLORS[data.prediction] ?? "bg-primary"}`} />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-2">
            {RECOMMENDATION_SECTIONS.map((section) => {
              const items = data.recommendations?.[section.key];
              if (!Array.isArray(items) || items.length === 0) return null;

              return (
                <div key={section.key} className="rounded-2xl border border-border/70 bg-background/70 p-4">
                  <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <span className="text-primary">{section.icon}</span>
                    <span>{section.label}</span>
                  </div>
                  <ul className="mt-3 space-y-2 text-sm text-muted-foreground">
                    {items.map((item) => (
                      <li key={item} className="flex gap-2">
                        <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {hasModels && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Trophy className="h-4 w-4 text-primary" />
              Classement des modeles IA
            </h4>
            <span className="text-xs text-muted-foreground">Tries par confiance decroissante</span>
          </div>

          {rankedNames.map((name, idx) => {
            const result = allModels[name];
            if (!result) return null;

            return (
              <ModelCard
                key={name}
                name={name}
                result={result}
                rank={idx}
                isBest={name === bestModel}
                isExpanded={expandedModel === name}
                onToggle={() => setExpandedModel(expandedModel === name ? null : name)}
              />
            );
          })}

          <p className="pt-1 text-center text-xs text-muted-foreground">
            Cliquez sur un modele pour afficher ses probabilites detaillees.
          </p>
        </div>
      )}

      {data.heatmap_url && (
        <div className="space-y-3 rounded-2xl border border-border bg-card p-5 shadow-card">
          <h4 className="text-sm font-semibold text-foreground">Carte de chaleur Grad-CAM</h4>
          <p className="text-xs text-muted-foreground">
            Les zones surlignees indiquent les regions cerebrales sur lesquelles l'IA s'est concentree.
          </p>
          <img src={data.heatmap_url} alt="Grad-CAM heatmap" className="w-full rounded-xl border border-border" />
        </div>
      )}
    </motion.div>
  );
};

export default PredictionResult;
