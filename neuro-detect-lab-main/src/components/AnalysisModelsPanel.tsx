import { BrainCircuit, Cpu, Layers3, ScanSearch } from "lucide-react";

// Only models that passed the measured evaluation (ml_service/eval/model_metrics.json).
// EfficientNet-B0 is disabled (collapsed to one class); B3/B4 stay disabled until evaluated.
const ANALYSIS_MODELS = [
  {
    name: "ResNet50",
    label: "Modele principal",
    description: "ResNet-50 pre-entraine (ImageNet) puis affine. Choisi a l'avance : meilleur macro-F1 mesure.",
  },
  {
    name: "CustomCNN",
    label: "Comparaison",
    description: "CNN convolutionnel compact. Affiche pour comparaison (split d'entrainement inconnu).",
  },
];

const AnalysisModelsPanel = () => {
  return (
    <section className="mx-auto mb-6 w-full max-w-5xl rounded-3xl border border-border/70 bg-card/95 p-5 shadow-card">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-2xl">
          <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
            <Cpu className="h-3.5 w-3.5" />
            Modeles d'analyse du scan
          </div>
          <h2 className="mt-3 font-display text-xl font-bold text-foreground">
            Cette IRM est analysee par {ANALYSIS_MODELS.length} modeles IA evalues
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Le verdict vient du modele principal, choisi a l'avance sur des mesures (macro-F1 sans fuite de
            donnees). Prototype de recherche : pas un dispositif medical.
          </p>
        </div>

        <div className="grid min-w-[240px] gap-3 rounded-2xl border border-primary/15 bg-primary/5 p-4 text-sm text-muted-foreground sm:grid-cols-3 lg:w-[320px] lg:grid-cols-1">
          <div className="flex items-center gap-2">
            <Layers3 className="h-4 w-4 text-primary" />
            <span>{ANALYSIS_MODELS.length} modeles compares</span>
          </div>
          <div className="flex items-center gap-2">
            <ScanSearch className="h-4 w-4 text-primary" />
            <span>Ordre fixe par mesure</span>
          </div>
          <div className="flex items-center gap-2">
            <BrainCircuit className="h-4 w-4 text-primary" />
            <span>Desaccords signales</span>
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {ANALYSIS_MODELS.map((model) => (
          <article
            key={model.name}
            className="rounded-2xl border border-border/70 bg-background/70 p-4 transition-colors hover:border-primary/30 hover:bg-primary/5"
          >
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-foreground">{model.name}</h3>
              <span className="rounded-full bg-muted px-2 py-1 text-[11px] font-medium text-muted-foreground">
                {model.label}
              </span>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{model.description}</p>
          </article>
        ))}
      </div>
    </section>
  );
};

export default AnalysisModelsPanel;
