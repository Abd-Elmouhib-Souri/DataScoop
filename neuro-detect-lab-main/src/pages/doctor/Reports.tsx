import { formatDoctorName } from "@/lib/utils";
import { useEffect, useState, useRef, useMemo } from "react";
import { motion } from "framer-motion";
import {
  FileText, Printer, Calendar, Loader2,
  Users, Brain, TrendingUp, AlertTriangle, Search,
  ChevronDown, ChevronUp, Activity, BarChart2, Filter,
  FileDown, Shield, Clock, ScanLine, ZoomIn, X, ImageOff, RefreshCw,
  Pill, Apple, Dumbbell, ShieldCheck, CalendarCheck, HeartHandshake, Lightbulb
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import MedicalChatbotPanel from "@/components/MedicalChatbotPanel";
import EmptyState from "@/components/ui/empty-state";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getDoctors, getPatientsByDoctor, getPatients, getPatientIrmImage, reanalyzePatientScan } from "@/lib/api";
import type { PatientIrmData } from "@/lib/api";
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend
} from "recharts";

interface Doctor {
  _id: string;
  username: string;
  email: string;
}

interface Patient {
  _id: string;
  name: string;
  age?: number;
  email: string;
  symptoms: string[];
  prediction?: string;
  probabilities?: Record<string, number>;
  bestModel?: string | null;
  allModels?: Record<string, {
    prediction: string;
    confidence: number;
    probabilities: Record<string, number>;
    inference_time_ms: number;
    mode: "real" | "simulated" | "error";
    description: string;
    error?: string;
  }>;
  rankedModels?: string[];
  totalModels?: number;
  explanation?: string;
  irmImage?: string | null;
  lastScanDate?: string | null;
  assignedDoctor?: {
    _id: string;
    username: string;
    email: string;
  };
  medicalHistory?: Array<{
    date: Date;
    diagnosis: string;
    notes: string;
    probabilities?: Record<string, number>;
    bestModel?: string | null;
    allModels?: Record<string, {
      prediction: string;
      confidence: number;
      probabilities: Record<string, number>;
      inference_time_ms: number;
      mode: "real" | "simulated" | "error";
      description: string;
      error?: string;
    }>;
    rankedModels?: string[];
    totalModels?: number;
    irmImage?: string | null;
    doctor: {
      _id: string;
      username: string;
      email: string;
    };
  }>;
  createdAt: string;
}

type PatientModelResult = NonNullable<Patient["allModels"]>[string];

const getPatientBestModelSummary = (patient: Patient) => {
  const ranked = patient.rankedModels ?? [];
  const allModels = patient.allModels ?? {};
  const fallbackBest = Object.keys(allModels).sort(
    (a, b) => (allModels[b]?.confidence ?? 0) - (allModels[a]?.confidence ?? 0)
  )[0];
  const bestModel = patient.bestModel ?? ranked[0] ?? fallbackBest ?? null;
  const bestResult = bestModel ? allModels[bestModel] : undefined;

  return {
    bestModel,
    bestConfidence: bestResult?.confidence ?? null,
    totalModels: patient.totalModels ?? ranked.length ?? Object.keys(allModels).length,
  };
};

const getPatientRankedModelEntries = (
  patient: Pick<Patient, "allModels" | "rankedModels">
): Array<[string, PatientModelResult]> => {
  const allModels = patient.allModels ?? {};
  const ranked = patient.rankedModels?.length
    ? patient.rankedModels
    : Object.keys(allModels).sort(
        (a, b) => (allModels[b]?.confidence ?? 0) - (allModels[a]?.confidence ?? 0)
      );

  return ranked
    .map((modelName) => {
      const result = allModels[modelName];
      return result ? [modelName, result] as [string, PatientModelResult] : null;
    })
    .filter((entry): entry is [string, PatientModelResult] => entry !== null);
};

const getTopProbability = (probabilities?: Record<string, number>) => {
  if (!probabilities || Object.keys(probabilities).length === 0) return null;

  return Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0] ?? null;
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const DERIVED_MODEL_ORDER = [
  "EfficientNetB4",
  "UltraBestModel",
  "EfficientNetB3",
  "EfficientNetB0",
  "AlzheimerCNN",
] as const;

const deriveModelComparison = (
  prediction?: string | null,
  probabilities?: Record<string, number>
): {
  allModels: Record<string, PatientModelResult>;
  rankedModels: string[];
  bestModel: string | null;
  totalModels: number;
  isDerived: boolean;
} => {
  const probs = probabilities ?? {};
  const hasProbabilities = Object.keys(probs).length > 0;

  if (!hasProbabilities) {
    return {
      allModels: {},
      rankedModels: [],
      bestModel: null,
      totalModels: 0,
      isDerived: false,
    };
  }

  // Per-model scores that were not stored are NOT reconstructed (the old code invented 5 models
  // from the global score). Only real stored results (patient.allModels) are displayed.
  void prediction;
  return { allModels: {}, rankedModels: [], bestModel: null, totalModels: 0, isDerived: false };
};

// The old "indicative heatmap" was 3 ellipses at fixed positions, unrelated to the image.
// Disabled until a real Grad-CAM is implemented. Returning null hides every heatmap block.
const buildIndicativeHeatmapUrl = (
  _probabilities?: Record<string, number>,
  _prediction?: string | null
): string | null => null;

const getPatientScoreDelta = (patient: Patient) => {
  const history = patient.medicalHistory?.filter((item) => item.bestModel || item.probabilities) ?? [];
  if (history.length < 2) return null;

  const ordered = [...history].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const current = ordered[0];
  const previous = ordered[1];
  const currentScore = current.bestModel && current.allModels?.[current.bestModel]
    ? current.allModels[current.bestModel].confidence
    : getTopProbability(current.probabilities ?? {})?.[1];
  const previousScore = previous.bestModel && previous.allModels?.[previous.bestModel]
    ? previous.allModels[previous.bestModel].confidence
    : getTopProbability(previous.probabilities ?? {})?.[1];

  if (currentScore == null || previousScore == null) return null;
  return Number((currentScore - previousScore).toFixed(4));
};

const repairMojibake = (value: string): string => {
  if (!/[ÃÂâð]/.test(value)) return value;

  const replacements: Array<[string, string]> = [
    ["dé", "dé"],
    ["Dé", "Dé"],
    ["mé", "mé"],
    ["Mé", "Mé"],
    ["cé", "cé"],
    ["Cé", "Cé"],
    ["ré", "ré"],
    ["Ré", "Ré"],
    ["é", "é"],
    ["è", "è"],
    ["ê", "ê"],
    ["ë", "ë"],
    ["Ã ", "à "],
    ["à", "à"],
    ["â", "â"],
    ["î", "î"],
    ["ï", "ï"],
    ["ô", "ô"],
    ["ö", "ö"],
    ["ù", "ù"],
    ["û", "û"],
    ["ü", "ü"],
    ["ç", "ç"],
    ["É", "É"],
    ["À", "À"],
    ["Ç", "Ç"],
    ["ÃŽ", "Î"],
    ["©", "©"],
    ["·", "·"],
    ["®", "®"],
    ["µ", "µ"],
    ["Â", ""],
    ["—", "—"],
    ["–", "–"],
    ["…", "..."],
    ["•", "•"],
    ["â€", "\""],
    ["’", "'"],
    ["“", "\""],
    ["”", "\""],
    ["→", "→"],
    ["🧠", "🧠 "],
    ["🧠", "🧠"],
    ["📊", "📊"],
    ["📋", "📋"],
    ["📷", "📷"],
    ["🤖", "🤖"],
    ["⚠️", "⚠️"],
  ];

  return replacements.reduce((text, [bad, good]) => text.split(bad).join(good), value);
};

const PREDICTION_COLORS: Record<string, string> = {
  "Non Demented":       "#10b981",
  "Very Mild Demented": "#f59e0b",
  "Mild Demented":      "#f97316",
  "Moderate Demented":  "#ef4444",
  "Severe Demented":    "#7f1d1d",
};

const PREDICTION_BG: Record<string, string> = {
  "Non Demented":       "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  "Very Mild Demented": "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  "Mild Demented":      "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
  "Moderate Demented":  "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  "Severe Demented":    "bg-red-200 text-red-900 dark:bg-red-900/50 dark:text-red-300",
};

const getRiskBucket = (prediction?: string | null) => {
  switch (prediction) {
    case "Moderate Demented":
    case "Severe Demented":
      return "high";
    case "Mild Demented":
      return "medium";
    case "Non Demented":
    case "Very Mild Demented":
      return "low";
    default:
      return "unknown";
  }
};

// Neutral notes: the classifier outputs a class label only. It does NOT measure the hippocampus,
// ventricles or cortex, so the report must never describe imaging findings.
const AI_NOTE_SUFFIX = "Résultat indicatif d'un modèle de recherche sur une coupe IRM 2D, à confirmer par un neurologue.";
const AI_NOTES: Record<string, string> = {
  "Non Demented": `Classe prédite : Non Demented. ${AI_NOTE_SUFFIX}`,
  "Very Mild Demented": `Classe prédite : Very Mild Demented. ${AI_NOTE_SUFFIX}`,
  "Mild Demented": `Classe prédite : Mild Demented. ${AI_NOTE_SUFFIX}`,
  "Moderate Demented": `Classe prédite : Moderate Demented. ${AI_NOTE_SUFFIX}`,
  "Severe Demented": `Classe prédite : Severe Demented. ${AI_NOTE_SUFFIX}`,
};

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const REPORT_CARE_PLAN: Record<string, {
  headline: string;
  medications: string[];
  activities: string[];
  hygiene: string[];
}> = {
  "Non Demented": {
    headline: "Orientation preventive avec surveillance legere et hygiene de vie neuroprotectrice.",
    medications: ["Aucune recommandation médicamenteuse : toute décision de traitement relève du neurologue."],
    activities: [
      "Marche rapide 30 minutes, 5 jours par semaine.",
      "Lecture, jeux de memoire, sudoku, echanges sociaux reguliers.",
      "Sommeil regulier et activites de reduction du stress.",
    ],
    hygiene: [
      "Alimentation mediterraneenne ou MIND.",
      "Hydratation quotidienne et reduction de l'alcool/tabac.",
      "Bilan neurologique de reference selon l'age et le contexte clinique.",
    ],
  },
  "Very Mild Demented": {
    headline: "Prise en charge precoce pour ralentir l'evolution et maintenir l'autonomie.",
    medications: ["Aucune recommandation médicamenteuse : toute décision de traitement relève du neurologue."],
    activities: [
      "Exercices cognitifs quotidiens 20 a 30 minutes.",
      "Marche, danse douce ou natation encadree.",
      "Agenda, rappels et routine quotidienne stable.",
    ],
    hygiene: [
      "Reduction du sucre raffine et des aliments ultra-transformes.",
      "Suivi neurologique periodique et tests cognitifs.",
      "Impliquer un proche pour l'organisation des rendez-vous.",
    ],
  },
  "Mild Demented": {
    headline: "Strategie therapeutique active pour proteger les fonctions cognitives restantes.",
    medications: ["Aucune recommandation médicamenteuse : toute décision de traitement relève du neurologue."],
    activities: [
      "Reeducation cognitive avec orthophonie si disponible.",
      "Marche accompagnee et activites simples guidees.",
      "Musicotherapie, exercices de reminiscence et routines claires.",
    ],
    hygiene: [
      "Surveillance nutritionnelle et hydratation.",
      "Securisation du domicile et supervision des medicaments.",
      "Consultation neurologique rapprochee et coordination avec l'aidant.",
    ],
  },
  "Moderate Demented": {
    headline: "Prise en charge pluridisciplinaire avec soutien quotidien plus important.",
    medications: ["Aucune recommandation médicamenteuse : toute décision de traitement relève du neurologue."],
    activities: [
      "Activites sensorielles, musique, routines tres structurees.",
      "Exercices moteurs doux avec accompagnement.",
      "Communication simple, calme et repetitive.",
    ],
    hygiene: [
      "Presence d'un aidant et surveillance des risques domestiques.",
      "Aide a l'alimentation, au sommeil et a l'hydratation.",
      "Suivi medical rapproche, geriatrique et neurologique.",
    ],
  },
  "Severe Demented": {
    headline: "Objectif prioritaire: confort, securite et accompagnement intensif.",
    medications: ["Aucune recommandation médicamenteuse : toute décision de traitement relève du neurologue."],
    activities: [
      "Stimulation sensorielle douce et presence rassurante.",
      "Mobilisation passive ou douce avec aide specialisee.",
      "Maintien d'un environnement calme et securisant.",
    ],
    hygiene: [
      "Surveillance rapprochee des fonctions vitales et de la deglutition.",
      "Prevention des chutes, escarres et denutrition.",
      "Coordination medico-sociale et soutien intense aux aidants.",
    ],
  },
};

type ZoomViewMode = "fit" | "actual";

// ── Conseils médicaux IA détaillés par stade ────────────────────────────────
function generateMedicalAdviceHTML(prediction: string, _symptoms: string[], age?: number): string {
  const ageNote = age ? `(patient de ${age} ans)` : "";

  const advice: Record<string, {
    stadeDesc: string;
    medicaments: { nom: string; classe: string; posologie: string; indication: string }[];
    cognitif: string[];
    alimentation: string[];
    physique: string[];
    securite: string[];
    suivi: string[];
    aidants: string[];
  }> = {
    "Non Demented": {
      stadeDesc: AI_NOTE_SUFFIX,
      medicaments: [],
      cognitif: [
        "Lecture quotidienne (30 min minimum) — stimulation des circuits langagiers.",
        "Apprentissage d'une nouvelle langue ou d'un instrument de musique.",
        "Mots croisés, Sudoku, échecs, jeux de mémoire (20 min/jour).",
        "Méditation de pleine conscience (10–15 min/jour) — réduit le cortisol néfaste.",
        "Participation à des activités culturelles et sociales régulières.",
      ],
      alimentation: [
        "Régime MIND (Mediterranean-DASH Intervention for Neurodegenerative Delay) — réduction de 53% du risque Alzheimer prouvée.",
        "Légumes verts à feuilles : épinards, chou frisé (6+ portions/semaine).",
        "Baies (myrtilles, fraises) riches en anthocyanes neuroprotectrices (2+ portions/semaine).",
        "Noix et amandes (1 poignée/jour) — source d'oméga-3 et de vitamine E.",
        "Poissons gras (saumon, maquereau) 2×/semaine — DHA essentiel.",
        "Limiter : viandes rouges (<4×/semaine), beurre (<1 c.s./jour), sucreries (<5×/semaine).",
        "Hydratation : 1,5 à 2L d'eau/jour — déshydratation = facteur de confusion cognitive.",
      ],
      physique: [
        "Marche rapide 30 min/jour, 5 jours/semaine (activité physique régulière).",
        "Natation ou vélo 2×/semaine — cardio à faible impact.",
        "Yoga ou Tai-Chi — améliore l'équilibre et réduit le stress oxydatif.",
        "Renforcement musculaire léger 2×/semaine — lié à meilleure santé cognitive.",
      ],
      securite: [
        "Contrôler régulièrement tension artérielle, glycémie et cholestérol.",
        "Éviter le tabac et réduire l'alcool à <1 verre/jour.",
        "Qualité du sommeil : 7–9h/nuit, éviter les écrans 1h avant coucher.",
        "Port du casque pour vélo/moto — prévention des traumatismes crâniens.",
      ],
      suivi: [
        "Bilan neurologique préventif tous les 2 ans après 50 ans.",
        "Test cognitif de base (MoCA ou MMSE) pour référence future.",
        "Bilan sanguin annuel : B12, folates, TSH, glycémie, bilan lipidique.",
        "IRM cérébrale de référence conseillée (si âge >60 ans).",
      ],
      aidants: [
        "Aucune aide spécialisée requise à ce stade.",
        "Informer la famille sur les signes précoces à surveiller.",
        "Encourager un mode de vie actif et socialement engagé.",
      ],
    },
    "Very Mild Demented": {
      stadeDesc: AI_NOTE_SUFFIX,
      medicaments: [],
      cognitif: [
        "Entraînement cognitif structuré : programme BrainHQ ou Lumosity (30 min/jour).",
        "Lecture à voix haute pour stimuler mémoire et langage.",
        "Tenue d'un journal quotidien (agenda structuré).",
        "Activités artistiques : peinture, poterie, musique.",
        "Groupes de soutien cognitif — interaction sociale bénéfique.",
        "Jeux de société en famille : Scrabble, Trivial Pursuit, puzzles.",
      ],
      alimentation: [
        "Régime méditerranéen strict (huile d'olive, légumineuses, poissons).",
        "Curcuma : 1 c.à.c./jour dans les repas — curcumine anti-inflammatoire cérébrale.",
        "Café modéré (1–2 tasses/jour) — caféine associée à réduction du risque Alzheimer.",
        "Réduction drastique du sucre raffiné — lié à inflammation et résistance à l'insuline cérébrale.",
        "Aliments riches en flavonoïdes : cacao noir, thé vert, agrumes.",
        "Éviter les graisses trans (produits industriels, fast-food).",
      ],
      physique: [
        "Marche quotidienne 45 min — programme de marche structuré.",
        "Danse (tango, valse) — combien aspect physique et cognitif.",
        "Natation 3×/semaine.",
        "Séances de gym avec coach spécialisé en bien-être senior.",
      ],
      securite: [
        "Mettre en place un système d'agenda et de rappels numériques.",
        "Informer un proche de confiance des rendez-vous médicaux.",
        "Vérifier la sécurité du domicile : tapis, éclairage la nuit.",
        "Supervision légère pour activités complexes (finances, conduite).",
      ],
      suivi: [
        "Consultation neurologique tous les 6 mois.",
        "Test MoCA ou MMSE tous les 6 mois pour suivi objectif.",
        "IRM cérébrale de contrôle dans 12 mois.",
        "Bilan neuropsychologique complet annuel.",
        "Electroencéphalogramme (EEG) si suspicion d'épilepsie associée.",
      ],
      aidants: [
        "Formation de l'aidant principal aux techniques de communication adaptée.",
        "Mettre en place un carnet de communication partagé.",
        "Rejoindre un groupe de soutien pour aidants (France Alzheimer).",
      ],
    },
    "Mild Demented": {
      stadeDesc: AI_NOTE_SUFFIX,
      medicaments: [],
      cognitif: [
        "Programme de rééducation cognitive avec orthophoniste (2×/semaine).",
        "Musicothérapie — stimulation des circuits émotionnels préservés.",
        "Reminiscence therapy — photographies et objets du passé pour stimuler la mémoire épisodique.",
        "Activités de la vie quotidienne guidées : cuisine simple, jardinage.",
        "Tablette numérique avec applications cognitives adaptées (KOALA, OrCam).",
        "Éviter la surcharge informationnelle — une tâche à la fois.",
      ],
      alimentation: [
        "Régime MIND strict — associé à réduction de 7,5 ans du déclin cognitif.",
        "Supplémentation B12 si déficit (1000 µg/jour sublingual).",
        "Éviter les repas trop copieux (hypoglycémie postprandiale = risque de confusion).",
        "Alimentation fractionnée : 5 petits repas/jour pour stabilité glycémique.",
        "Éviter l'alcool totalement.",
        "Vigilance sur la dénutrition et la perte de poids.",
      ],
      physique: [
        "Marche accompagnée 30–45 min/jour.",
        "Kinésithérapie spécialisée 2×/semaine pour maintien de l'équilibre.",
        "Hydrothérapie (balnéothérapie) si disponible.",
        "Éviter les sports à risque de chute.",
      ],
      securite: [
        "Installation de barres d'appui dans salle de bain et WC.",
        "Détecteur de gaz et sécurité cuisinière automatique recommandée.",
        "Bracelet GPS de localisation (TechSilver, Vivago).",
        "Supervision nécessaire pour prise des médicaments.",
        "Réévaluation de l'aptitude à la conduite automobile.",
        "Mise sous protection juridique si nécessaire (tutelle/curatelle).",
      ],
      suivi: [
        "Consultation neurologique tous les 3 mois.",
        "Évaluation neuropsychologique complète tous les 6 mois.",
        "IRM cérébrale de contrôle annuelle.",
        "Bilan cardio-vasculaire (HTA, diabète = facteurs aggravants).",
        "Bilan orthophonique et ergothérapique.",
        "Consultation gériatrique pour coordination des soins.",
      ],
      aidants: [
        "Présence d'un aidant principal nécessaire à domicile.",
        "Formation obligatoire aux soins Alzheimer (MAIA, SSIAD).",
        "Aide à domicile 2–3h/jour recommandée.",
        "Portage de repas si difficultés de préparation.",
        "Accueil de jour spécialisé (3×/semaine) pour décharge de l'aidant.",
        "Aide psychologique pour l'aidant — burnout fréquent.",
      ],
    },
    "Moderate Demented": {
      stadeDesc: AI_NOTE_SUFFIX,
      medicaments: [],
      cognitif: [
        "Stimulation sensorielle : musicothérapie, aromathérapie, art-thérapie.",
        "Thérapie de validation (Naomi Feil) — valider les émotions sans corriger.",
        "Communication non-verbale prioritaire : contact visuel, toucher rassurant.",
        "Maintien d'une routine quotidienne stricte et prévisible.",
        "Réduire les stimuli environnementaux excessifs (TV, bruit).",
        "Photobooks personnalisés — stimulation mémoire autobiographique.",
      ],
      alimentation: [
        "Surveillance nutritionnelle rigoureuse — risque de dénutrition élevé.",
        "Alimentation texturée si troubles de déglutition (dysphagie).",
        "Enrichissement calorique des repas (huile d'olive, fromage).",
        "Évaluation par diététicien spécialisé tous les 3 mois.",
        "Compléments nutritionnels oraux si besoin (Fortimel, Fresubin).",
        "Hydratation assistée si oubli de boire.",
      ],
      physique: [
        "Kinésithérapie quotidienne pour prévenir les contractures.",
        "Marche assistée avec aide technique (déambulateur si nécessaire).",
        "Prévention des escarres si mobilité réduite.",
        "Programme de prévention des chutes.",
      ],
      securite: [
        "Surveillance continue — ne jamais laisser seul à domicile.",
        "Sécurisation complète du domicile : fermeture des accès extérieurs.",
        "Bracelet GPS obligatoire — risque de fugue élevé.",
        "Retrait des objets dangereux (couteaux, médicaments accessibles).",
        "Alarme de lit pour déplacements nocturnes.",
        "Déclaration d'inaptitude à la conduite obligatoire.",
      ],
      suivi: [
        "Consultation neurologique mensuelle ou bimensuelle.",
        "Hospitalisation en unité gériatrique si décompensation.",
        "Évaluation MMSE mensuelle.",
        "Bilan de déglutition (orthophoniste) si troubles alimentaires.",
        "Consultation psychiatrique si symptômes comportementaux sévères.",
        "Dossier MDPH pour reconnaissance du handicap et aides financières.",
      ],
      aidants: [
        "Aide professionnelle à domicile 8–12h/jour minimum.",
        "Hébergement en EHPAD spécialisé Alzheimer à envisager.",
        "Accueil de jour 5 jours/semaine recommandé.",
        "Coordination par une équipe MAIA ou équipe mobile gériatrique.",
        "Soutien psychologique obligatoire pour l'aidant principal.",
        "Aides financières : APA, PCH — dossier à constituer.",
      ],
    },
    "Severe Demented": {
      stadeDesc: AI_NOTE_SUFFIX,
      medicaments: [],
      cognitif: [
        "Stimulation sensorielle douce : musique familière, toucher, parfums.",
        "Communication par le toucher — contact physique rassurant prioritaire.",
        "Maintien du lien affectif — présence humaine constante.",
        "Éviter toute stimulation excessive ou douloureuse.",
        "Thérapie Snoezelen si disponible — environnement multisensoriel adapté.",
      ],
      alimentation: [
        "Alimentation palliative — objectif : confort, pas nutrition optimale.",
        "Alimentation entérale par sonde nasogastrique si refus alimentaire total.",
        "Soins de bouche réguliers — prévention mycoses et douleurs.",
        "Hydrater par voie sous-cutanée (hypodermoclyse) si déshydratation.",
        "Décision collégiale sur la nutrition artificielle — respect des directives anticipées.",
      ],
      physique: [
        "Nursing complet par personnel soignant qualifié.",
        "Mobilisation passive quotidienne — prévention des escarres (retournements/2h).",
        "Matelas anti-escarres obligatoire.",
        "Soins cutanés préventifs complets.",
        "Kinésithérapie palliative pour maintien du confort.",
      ],
      securite: [
        "Soins en établissement spécialisé (EHPAD unité protégée Alzheimer) recommandés.",
        "Personnel soignant 24h/24 indispensable.",
        "Dispositifs anti-chute : barrières de lit adaptées, chaussons antidérapants.",
        "Surveillance des escarres, infections urinaires, fausses routes.",
        "Prévention des pneumopathies d'inhalation.",
      ],
      suivi: [
        "Consultation palliative pluridisciplinaire mensuelle.",
        "Réunion de concertation médico-soignante régulière.",
        "Respect des directives anticipées et désignation d'un personne de confiance.",
        "Accompagnement en soins palliatifs — équipe mobile si domicile.",
        "Accompagnement psychologique et spirituel du patient ET de la famille.",
        "Soutien au deuil anticipé pour les proches.",
      ],
      aidants: [
        "Placement en EHPAD spécialisé fortement recommandé pour qualité de soins.",
        "Si maintien à domicile : infirmière 2×/jour + aide-soignant matin et soir.",
        "Hospitalisation à domicile (HAD) possible pour phase terminale.",
        "Répit obligatoire pour aidant : hébergement temporaire.",
        "Accompagnement psychologique professionnel de toute la famille.",
        "Aide juridique : directives anticipées, testament, procurations.",
      ],
    },
  };

  const a = advice[prediction] ?? advice["Non Demented"];
  const predColor = PREDICTION_COLORS[prediction] ?? "#6b7280";

  // Drug table removed on purpose (no prescriptions generated from an AI label)
  const _unusedMedicBlock = a.medicaments.map(m => `
    <tr>
      <td style="padding:8px 10px;border-bottom:1px solid #f3f4f6;font-weight:600;color:#1f2937">${m.nom}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #f3f4f6;color:#6b7280;font-size:11px">${m.classe}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #f3f4f6;color:#374151;font-size:11px">${m.posologie}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #f3f4f6;color:#6b7280;font-size:11px">${m.indication}</td>
    </tr>`).join("");

  const listBlock = (items: string[]) =>
    items.map(i => `<li style="margin-bottom:5px;color:#374151">${i}</li>`).join("");

  return `
    <div style="margin-bottom:20px;padding:14px 18px;background:${predColor}18;border-left:5px solid ${predColor};border-radius:6px">
      <h3 style="margin:0 0 6px 0;color:${predColor};font-size:15px">🔬 Analyse IA — Stade : ${prediction} ${ageNote}</h3>
      <p style="margin:0;color:#374151;font-size:13px;line-height:1.6">${a.stadeDesc}</p>
    </div>

    <div style="margin-bottom:20px;padding:10px 14px;border:1px solid #fecaca;background:#fef2f2;border-radius:6px">
      <p style="margin:0;font-size:12px;color:#991b1b">Ce rapport ne propose aucun médicament : toute décision de traitement relève du neurologue.</p>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:20px">
      <div style="background:#f0fdf4;padding:12px;border-radius:6px;border:1px solid #bbf7d0">
        <h4 style="margin:0 0 8px 0;color:#166534;font-size:13px">🧠 Exercices Cognitifs</h4>
        <ul style="margin:0;padding-left:16px;font-size:12px">${listBlock(a.cognitif)}</ul>
      </div>
      <div style="background:#fff7ed;padding:12px;border-radius:6px;border:1px solid #fed7aa">
        <h4 style="margin:0 0 8px 0;color:#9a3412;font-size:13px">🥗 Alimentation & Nutrition</h4>
        <ul style="margin:0;padding-left:16px;font-size:12px">${listBlock(a.alimentation)}</ul>
      </div>
      <div style="background:#eff6ff;padding:12px;border-radius:6px;border:1px solid #bfdbfe">
        <h4 style="margin:0 0 8px 0;color:#1d4ed8;font-size:13px">🏃 Activité Physique</h4>
        <ul style="margin:0;padding-left:16px;font-size:12px">${listBlock(a.physique)}</ul>
      </div>
      <div style="background:#fef2f2;padding:12px;border-radius:6px;border:1px solid #fecaca">
        <h4 style="margin:0 0 8px 0;color:#991b1b;font-size:13px">🔒 Sécurité & Environnement</h4>
        <ul style="margin:0;padding-left:16px;font-size:12px">${listBlock(a.securite)}</ul>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:10px">
      <div style="background:#faf5ff;padding:12px;border-radius:6px;border:1px solid #e9d5ff">
        <h4 style="margin:0 0 8px 0;color:#6b21a8;font-size:13px">📅 Planning de Suivi Médical</h4>
        <ul style="margin:0;padding-left:16px;font-size:12px">${listBlock(a.suivi)}</ul>
      </div>
      <div style="background:#f0fdfa;padding:12px;border-radius:6px;border:1px solid #99f6e4">
        <h4 style="margin:0 0 8px 0;color:#0f766e;font-size:13px">🤝 Conseils pour l'Aidant</h4>
        <ul style="margin:0;padding-left:16px;font-size:12px">${listBlock(a.aidants)}</ul>
      </div>
    </div>
  `;
}

// ── Composant dédié : charge l'image IRM d'un patient à la demande ──────────
function PatientIrmPanel({
  patientId,
  patientName,
  patientCreatedAt,
  token,
  onZoom,
}: {
  patientId: string;
  patientName: string;
  patientCreatedAt: string;
  token: string;
  onZoom: (z: { src: string; patientName: string; date: string }) => void;
}) {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["patient-irm", patientId],
    queryFn: () => getPatientIrmImage(patientId, token),
    enabled: !!patientId && !!token,
    staleTime: 30 * 1000, // cache 30 s — rafraîchissement quasi-immédiat
    retry: 2,
  });

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ["patient-irm", patientId] });
    refetch();
  };

  const dateStr = data?.lastScanDate
    ? new Date(data.lastScanDate).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" })
    : new Date(patientCreatedAt).toLocaleDateString("fr-FR");
  const heatmapUrl = buildIndicativeHeatmapUrl(data?.probabilities, data?.prediction);

  return (
    <div className="p-4 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
          <ScanLine className="h-3.5 w-3.5 text-primary" /> IMAGE IRM
        </p>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={isFetching}
          title="Actualiser l'image IRM"
          className="p-1 rounded hover:bg-muted/60 transition-colors disabled:opacity-40"
        >
          <RefreshCw className={`h-3.5 w-3.5 text-muted-foreground ${isFetching ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Chargement */}
      {(isLoading || isFetching) && !data && (
        <div className="flex flex-col items-center justify-center h-44 rounded-xl border border-border bg-muted/20 gap-2">
          <Loader2 className="h-7 w-7 animate-spin text-primary" />
          <p className="text-xs text-muted-foreground">Chargement de l'image IRM…</p>
        </div>
      )}

      {/* Erreur réseau */}
      {isError && !isLoading && (
        <div className="flex flex-col items-center justify-center h-44 rounded-xl border-2 border-dashed border-red-200 bg-red-50 dark:bg-red-900/10 gap-2">
          <ImageOff className="h-8 w-8 text-red-400" />
          <p className="text-xs text-red-500 text-center">
            Impossible de charger l'image<br />
            <button type="button" onClick={handleRefresh} className="underline text-primary text-[11px] mt-1">Réessayer</button>
          </p>
        </div>
      )}

      {/* Image disponible */}
      {!isLoading && !isError && data?.irmImage && (
        <div className="space-y-3">
          <div className="relative group">
            <img
              src={data.irmImage}
              alt={`IRM — ${patientName}`}
              className="w-full max-h-56 object-contain rounded-xl border border-border bg-black cursor-zoom-in"
              onClick={() => onZoom({ src: data.irmImage!, patientName, date: dateStr })}
            />
            {/* Overlay zoom */}
            <div
              onClick={() => onZoom({ src: data.irmImage!, patientName, date: dateStr })}
              className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/30 transition-all rounded-xl cursor-zoom-in"
            >
              <ZoomIn className="h-7 w-7 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            {/* Badge date */}
            <div className="absolute bottom-2 left-2 flex items-center gap-1 bg-black/70 text-white text-[10px] px-2 py-0.5 rounded-full backdrop-blur-sm">
              <Calendar className="h-3 w-3" />
              {data.lastScanDate
                ? new Date(data.lastScanDate).toLocaleDateString("fr-FR")
                : new Date(patientCreatedAt).toLocaleDateString("fr-FR")}
            </div>
          </div>

          {heatmapUrl && (
            <div className="rounded-xl border border-border bg-muted/20 p-2">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Heatmap visuelle indicative
                </p>
                <span className="text-[10px] text-amber-600">lecture explicative</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <img
                  src={data.irmImage}
                  alt={`IRM source ${patientName}`}
                  className="h-28 w-full rounded-lg border border-border bg-black object-cover"
                />
                <img
                  src={heatmapUrl}
                  alt={`Heatmap indicative ${patientName}`}
                  className="h-28 w-full rounded-lg border border-border bg-black object-cover"
                />
              </div>
              <p className="mt-2 text-[10px] text-muted-foreground">
                Carte visuelle indicative basee sur les probabilites du scan. Ce n'est pas un Grad-CAM medical certifie.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Pas d'image */}
      {!isLoading && !isFetching && !isError && !data?.irmImage && (
        <div className="flex flex-col items-center justify-center h-44 rounded-xl border-2 border-dashed border-border bg-muted/20 gap-2 text-muted-foreground">
          <ImageOff className="h-8 w-8" />
          <p className="text-xs text-center">
            Aucune image IRM importée<br />
            <span className="text-[10px] opacity-60">Le patient n'a pas encore effectué de scan</span>
          </p>
          <button
            type="button"
            onClick={handleRefresh}
            className="flex items-center gap-1 text-[11px] text-primary underline mt-1"
          >
            <RefreshCw className="h-3 w-3" /> Vérifier à nouveau
          </button>
        </div>
      )}
    </div>
  );
}

// ── Miniature IRM dans l'onglet Overview ─────────────────────────────────────
function OverviewIrmThumb({
  patient,
  token,
  onZoom,
}: {
  patient: Patient;
  token: string;
  onZoom: (z: { src: string; patientName: string; date: string }) => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["patient-irm", patient._id],
    queryFn: () => getPatientIrmImage(patient._id, token),
    enabled: !!patient._id && !!token,
    staleTime: 5 * 60 * 1000,
  });

  const dateStr = data?.lastScanDate
    ? new Date(data.lastScanDate).toLocaleDateString("fr-FR")
    : new Date(patient.createdAt).toLocaleDateString("fr-FR");

  return (
    <div className="flex flex-col items-center">
      {isLoading ? (
        <div className="h-20 w-20 rounded-xl border border-border bg-muted/40 flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : data?.irmImage ? (
        <div className="relative group cursor-zoom-in"
          onClick={() => onZoom({ src: data.irmImage!, patientName: patient.name, date: dateStr })}>
          <img
            src={data.irmImage}
            alt={`IRM ${patient.name}`}
            className="h-20 w-20 object-cover rounded-xl border-2 border-border bg-black group-hover:border-primary transition-colors"
          />
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 rounded-xl transition-all flex items-center justify-center">
            <ZoomIn className="h-5 w-5 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
          <div className="absolute bottom-1 left-0 right-0 flex justify-center">
            <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold text-white shadow truncate max-w-[72px]"
              style={{ background: PREDICTION_COLORS[patient.prediction ?? ""] ?? "#6b7280" }}>
              {patient.prediction?.split(" ")[0] ?? "N/A"}
            </span>
          </div>
        </div>
      ) : (
        <div className="h-20 w-20 rounded-xl border-2 border-dashed border-border bg-muted/20 flex items-center justify-center">
          <ImageOff className="h-6 w-6 text-muted-foreground/40" />
        </div>
      )}
      <p className="text-[10px] text-muted-foreground text-center mt-1 truncate max-w-[80px]">{patient.name}</p>
    </div>
  );
}

// ── Données conseils médicaux par stade ─────────────────────────────────────
const WEB_ADVICE: Record<string, {
  color: string; bg: string; border: string;
  resume: string;
  medicaments: string[];
  cognitif: string[];
  alimentation: string[];
  physique: string[];
  securite: string[];
  suivi: string[];
}> = {
  "Non Demented": {
    color: "#10b981", bg: "bg-emerald-50 dark:bg-emerald-900/10", border: "border-emerald-200 dark:border-emerald-700",
    resume: AI_NOTE_SUFFIX,
    medicaments: [],
    cognitif: ["Lecture 30 min/jour", "Mots croisés, Sudoku, échecs", "Méditation pleine conscience 10–15 min/jour", "Activités sociales et culturelles"],
    alimentation: ["Régime MIND (méditerranéen)", "Baies, noix, poissons gras 2×/semaine", "Limiter viandes rouges et sucres raffinés", "Hydratation : 1,5–2 L d'eau/jour"],
    physique: ["Marche rapide 30 min × 5 jours/semaine", "Natation ou vélo 2×/semaine", "Yoga ou Tai-Chi"],
    securite: ["Contrôler tension, glycémie, cholestérol", "Éviter tabac, limiter alcool", "Sommeil 7–9h/nuit"],
    suivi: ["Bilan neurologique préventif tous les 2 ans (>50 ans)", "Test MoCA/MMSE de référence", "Bilan sanguin annuel : B12, TSH, glycémie"],
  },
  "Very Mild Demented": {
    color: "#f59e0b", bg: "bg-yellow-50 dark:bg-yellow-900/10", border: "border-yellow-200 dark:border-yellow-700",
    resume: AI_NOTE_SUFFIX,
    medicaments: [],
    cognitif: ["Programme BrainHQ ou Lumosity 30 min/jour", "Journal quotidien structuré", "Musicothérapie, peinture, activités artistiques", "Groupes de soutien cognitif"],
    alimentation: ["Régime méditerranéen strict", "Curcuma 1 c.à.c./jour", "Café modéré 1–2 tasses/jour", "Flavonoïdes : cacao noir, thé vert, agrumes"],
    physique: ["Marche structurée 45 min/jour", "Danse (tango, valse) 2×/semaine", "Natation 3×/semaine"],
    securite: ["Agenda et rappels numériques", "Informer un proche des RDV médicaux", "Vérifier sécurité domicile (éclairage, tapis)"],
    suivi: ["Consultation neurologique tous les 6 mois", "IRM cérébrale de contrôle dans 12 mois", "Bilan neuropsychologique annuel"],
  },
  "Mild Demented": {
    color: "#f97316", bg: "bg-orange-50 dark:bg-orange-900/10", border: "border-orange-200 dark:border-orange-700",
    resume: AI_NOTE_SUFFIX,
    medicaments: [],
    cognitif: ["Rééducation cognitive avec orthophoniste 2×/semaine", "Musicothérapie (circuits émotionnels préservés)", "Stimulation sensorielle : jardinage, cuisine adaptée"],
    alimentation: ["Aliments anti-inflammatoires (curcuma, baies)", "Fractionnement des repas (5 petits repas/jour)", "Éviter alcool et excitants"],
    physique: ["Marche accompagnée 30 min/jour", "Séances de gym adaptées senior", "Hydrothérapie si disponible"],
    securite: ["Supervision pour finances, conduite, gaz", "Repères visuels dans le domicile", "Bracelet d'identification médicale"],
    suivi: ["Consultation neurologique tous les 3 mois", "IRM de contrôle tous les 6 mois", "Évaluation gériatrique complète"],
  },
  "Moderate Demented": {
    color: "#ef4444", bg: "bg-red-50 dark:bg-red-900/10", border: "border-red-200 dark:border-red-700",
    resume: AI_NOTE_SUFFIX,
    medicaments: [],
    cognitif: ["Thérapie de réminiscence (photos, musique du passé)", "Activités adaptées : tri d'objets, jardinage simplifié", "Communication non-verbale et gestuelle"],
    alimentation: ["Repas à heures fixes, texture adaptée si besoin", "Surveillance hydratation (risque déshydratation)", "Suppléments nutritionnels si perte de poids"],
    physique: ["Marche accompagnée courte 2×/jour", "Kinésithérapie 2×/semaine", "Exercices d'équilibre pour prévenir chutes"],
    securite: ["Sécuriser fenêtres, escaliers, cuisine", "Serrures de sécurité sur portes extérieures", "Système de géolocalisation GPS si fugues"],
    suivi: ["Consultation tous les 3 mois", "Évaluation charge aidants (épuisement)", "Envisager hébergement spécialisé si nécessaire"],
  },
  "Severe Demented": {
    color: "#7f1d1d", bg: "bg-red-100 dark:bg-red-900/20", border: "border-red-300 dark:border-red-600",
    resume: AI_NOTE_SUFFIX,
    medicaments: [],
    cognitif: ["Stimulation sensorielle douce (musique calme, toucher)", "Présence rassurante, voix familières", "Éviter surcharges cognitives"],
    alimentation: ["Texture mixée ou liquide si troubles déglutition", "Alimentation assistée bienveillante", "Évaluer nutrition entérale si dénutrition sévère"],
    physique: ["Mobilisation passive au lit/fauteuil", "Prévention escarres : changements de position", "Kinésithérapie respiratoire si besoin"],
    securite: ["Surveillance continue 24h/24", "Éviter contentions sauf urgence médicale", "Soins de confort et dignité en priorité"],
    suivi: ["Réunion pluridisciplinaire palliative mensuelle", "Soutien psychologique pour la famille", "Directives anticipées à discuter avec la famille"],
  },
};

const STAGE_WEB_RESOURCES: Record<string, Array<{ title: string; url: string; description: string }>> = {
  "Non Demented": [
    {
      title: "NIA - Cognitive Health and Older Adults",
      url: "https://www.nia.nih.gov/health/brain-health/cognitive-health-and-older-adults",
      description: "Prevention, facteurs de risque et hygiene de vie pour proteger la cognition.",
    },
    {
      title: "WHO - Dementia",
      url: "https://www.who.int/news-room/fact-sheets/detail/dementia",
      description: "Vue d'ensemble officielle sur la demence, ses risques et les points de surveillance.",
    },
    {
      title: "Alzheimer's Association - 10 Healthy Habits",
      url: "https://www.alz.org/help-support/brain_health/10_healthy_habits",
      description: "Bonnes habitudes a renforcer quand l'analyse reste rassurante.",
    },
  ],
  "Very Mild Demented": [
    {
      title: "Alzheimer's Association - Early Stage",
      url: "https://www.alz.org/help-support/caregiving/stages-behaviors/early-stage",
      description: "Repere clinique et conduite pratique pour les signes precoces.",
    },
    {
      title: "NIA - What Happens to the Brain in Alzheimer's Disease?",
      url: "https://www.nia.nih.gov/health/alzheimers-causes-and-risk-factors/what-happens-brain-alzheimers-disease",
      description: "Explication du retentissement cerebral utile pour interpreter le stade debutant.",
    },
    {
      title: "WHO - Risk Reduction of Cognitive Decline and Dementia",
      url: "https://www.who.int/publications/i/item/risk-reduction-of-cognitive-decline-and-dementia",
      description: "Cadre de reduction du risque et suivi precoce.",
    },
  ],
  "Mild Demented": [
    {
      title: "Alzheimer's Association - Early Stage Care",
      url: "https://www.alz.org/help-support/caregiving/stages-behaviors/early-stage",
      description: "Aide a structurer la prise en charge quand les difficultes deviennent quotidiennes.",
    },
    {
      title: "NIA - Alzheimer's Disease Fact Sheet",
      url: "https://www.nia.nih.gov/health/alzheimers-and-dementia/alzheimers-disease-fact-sheet",
      description: "Reference clinique generale sur les symptomes, la progression et la prise en charge.",
    },
    {
      title: "Alzheimer's Association - Treatments for Behavior",
      url: "https://www.alz.org/alzheimers-dementia/treatments/treatments-for-behavior",
      description: "Elements utiles pour les symptomes cognitifs et comportementaux debutants.",
    },
  ],
  "Moderate Demented": [
    {
      title: "Alzheimer's Association - Middle Stage",
      url: "https://www.alz.org/help-support/caregiving/stages-behaviors/middle-stage",
      description: "Repere central pour la dependance partielle et l'organisation du quotidien.",
    },
    {
      title: "NIA - Caring for a Person with Alzheimer's Disease",
      url: "https://www.nia.nih.gov/health/alzheimers/caring-person-alzheimers-disease",
      description: "Conseils pour adapter soins, securite et communication aux stades intermediaires.",
    },
    {
      title: "WHO - Dementia Fact Sheet",
      url: "https://www.who.int/news-room/fact-sheets/detail/dementia",
      description: "Point de synthese officiel pour cadrer le niveau de severite et les besoins de soins.",
    },
  ],
  "Severe Demented": [
    {
      title: "Alzheimer's Association - Late Stage",
      url: "https://www.alz.org/help-support/caregiving/stages-behaviors/late-stage",
      description: "Recommandations sur confort, surveillance continue et communication avec la famille.",
    },
    {
      title: "NIA - End of Life Care for People with Dementia",
      url: "https://www.nia.nih.gov/health/end-life-care-people-dementia",
      description: "Aide pour les decisions de confort, nutrition, dignite et soins palliatifs.",
    },
    {
      title: "Alzheimers.gov",
      url: "https://www.alzheimers.gov/",
      description: "Portail federal pour les ressources de prise en charge avancee et l'accompagnement des aidants.",
    },
  ],
};

const getStageWebResources = (prediction?: string | null) =>
  STAGE_WEB_RESOURCES[prediction ?? ""] ?? STAGE_WEB_RESOURCES["Non Demented"];

// ── Composant conseils médicaux web ─────────────────────────────────────────
function MedicalAdviceWebPanel({ prediction }: { prediction?: string }) {
  const [open, setOpen] = useState(false);
  if (!prediction) return null;
  const advice = WEB_ADVICE[prediction];
  if (!advice) return null;

  const sections = [
    { icon: <Brain className="h-3.5 w-3.5" />,          label: "Exercice cognitif", items: advice.cognitif,      col: "text-blue-600" },
    { icon: <Apple className="h-3.5 w-3.5" />,          label: "Alimentation",      items: advice.alimentation,  col: "text-green-600" },
    { icon: <Dumbbell className="h-3.5 w-3.5" />,       label: "Activité physique", items: advice.physique,      col: "text-orange-600" },
    { icon: <ShieldCheck className="h-3.5 w-3.5" />,    label: "Sécurité",          items: advice.securite,      col: "text-amber-600" },
    { icon: <CalendarCheck className="h-3.5 w-3.5" />,  label: "Suivi médical",     items: advice.suivi,         col: "text-primary" },
  ];

  return (
    <div className={`mx-4 mb-3 rounded-xl border ${advice.border} ${advice.bg} overflow-hidden`}>
      {/* Header */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-black/5 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Lightbulb className="h-4 w-4" style={{ color: advice.color }} />
          <span className="text-xs font-semibold text-foreground">Recommandations médicales IA</span>
          <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold text-white" style={{ background: advice.color }}>
            {prediction}
          </span>
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>

      {open && (
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}
          className="px-4 pb-4 space-y-3">
          {/* Résumé du stade */}
          <p className="text-xs text-muted-foreground italic border-l-2 pl-3" style={{ borderColor: advice.color }}>
            {advice.resume}
          </p>
          {/* Grille des sections */}
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {sections.map(sec => (
              <div key={sec.label} className="rounded-lg bg-white/70 dark:bg-black/20 border border-white/80 dark:border-white/10 p-3">
                <p className={`text-[11px] font-bold flex items-center gap-1.5 mb-2 ${sec.col}`}>
                  {sec.icon}{sec.label}
                </p>
                <ul className="space-y-1">
                  {sec.items.map((item, i) => (
                    <li key={i} className="text-[11px] text-muted-foreground flex items-start gap-1.5">
                      <span className="mt-0.5 shrink-0 h-1.5 w-1.5 rounded-full" style={{ background: advice.color }} />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          {/* Disclaimer */}
          <p className="text-[10px] text-muted-foreground flex items-start gap-1.5 pt-1 border-t border-border/50">
            <HeartHandshake className="h-3 w-3 shrink-0 mt-0.5" />
            Ces recommandations sont générées par l'IA à titre indicatif. Tout traitement doit être validé par un médecin qualifié.
          </p>
        </motion.div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
const Reports = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [selectedDoctor, setSelectedDoctor] = useState<Doctor | null>(null);
  const [search, setSearch] = useState("");
  const [filterPrediction, setFilterPrediction] = useState<string>("all");
  const [filterRisk, setFilterRisk] = useState<string>("all");
  const [expandedPatient, setExpandedPatient] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"overview" | "patients" | "charts" | "assistant">("overview");
  const [zoomImage, setZoomImage] = useState<{ src: string; patientName: string; date: string } | null>(null);
  const [zoomViewMode, setZoomViewMode] = useState<ZoomViewMode>("fit");
  const [reanalyzingPatientId, setReanalyzingPatientId] = useState<string | null>(null);
  const reportRef = useRef<HTMLDivElement>(null);

  // Only the logged-in doctor: reports cover HIS patients (other doctors' patients are private)
  const { data: doctors = [], isLoading: doctorsLoading, error: doctorsError } = useQuery({
    queryKey: ["doctors", user?.token],
    queryFn: async () => (await getDoctors(user?.token || "")).filter((d) => d._id === user?.id),
    enabled: !!user?.token,
  });

  const { data: allPatients = [], isLoading: allPatientsLoading } = useQuery({
    queryKey: ["all-patients", user?.token],
    queryFn: () => getPatients(user?.token || ""),
    enabled: !!user?.token,
  });

  const { data: patients = [], isLoading: patientsLoading, error: patientsError } = useQuery({
    queryKey: ["patients-by-doctor", selectedDoctor?._id, user?.token],
    queryFn: () => getPatientsByDoctor(selectedDoctor!._id, user?.token || ""),
    enabled: !!user?.token && !!selectedDoctor,
  });

  useEffect(() => {
    if (doctors.length > 0 && !selectedDoctor) {
      setSelectedDoctor(doctors[0]);
    }
  }, [doctors, selectedDoctor]);

  useEffect(() => {
    if (doctorsError || patientsError) {
      toast.error("Échec du chargement des données");
    }
  }, [doctorsError, patientsError]);

  useEffect(() => {
    if (!zoomImage) return;

    setZoomViewMode("fit");

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setZoomImage(null);
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleEscape);

    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleEscape);
    };
  }, [zoomImage]);

  const isLoading = doctorsLoading || patientsLoading || allPatientsLoading;
  const [isRepairing, setIsRepairing] = useState(false);

  const handleRepairLinks = async () => {
    // The old "repair" linked/deleted medical records by NAME without login. Records are now linked
    // only by account id or exact email, so there is nothing to repair.
    setIsRepairing(false);
    toast.info("Fonction retirée : les dossiers sont liés uniquement par compte (identifiant ou email exact).");
  };


  // ── Computed stats ──────────────────────────────────────────────────────────
  const predictionCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    (allPatients as Patient[]).forEach((p) => {
      const key = p.prediction || "En attente";   // no validated diagnosis: never counted as healthy
      counts[key] = (counts[key] || 0) + 1;
    });
    return counts;
  }, [allPatients]);

  const pieData = useMemo(() =>
    Object.entries(predictionCounts).map(([name, value]) => ({ name, value })),
    [predictionCounts]
  );

  const barData = useMemo(() =>
    (doctors as Doctor[]).map((doc) => {
      const count = (allPatients as Patient[]).filter(
        (p) => p.assignedDoctor?._id === doc._id
      ).length;
      return { name: doc.username, patients: count };
    }),
    [doctors, allPatients]
  );

  const highRiskCount = (allPatients as Patient[]).filter(
    (p) => p.prediction === "Moderate Demented" || p.prediction === "Severe Demented"
  ).length;

  const priorityPatients = useMemo(() => {
    return (patients as Patient[])
      .map((patient) => {
        const delta = getPatientScoreDelta(patient);
        const reasons: string[] = [];

        if (patient.prediction === "Moderate Demented" || patient.prediction === "Severe Demented") {
          reasons.push("Stade eleve");
        }
        if (delta != null && delta <= -0.12) {
          reasons.push(`Baisse rapide du score (${(Math.abs(delta) * 100).toFixed(1)}%)`);
        }
        const diagnoses = patient.medicalHistory?.map((item) => item.diagnosis).filter(Boolean) ?? [];
        if (diagnoses.length >= 2) {
          const latest = diagnoses[diagnoses.length - 1];
          const previous = diagnoses[diagnoses.length - 2];
          if (latest && previous && latest !== previous) {
            reasons.push(`Changement important (${previous} -> ${latest})`);
          }
        }

        return { patient, reasons, delta };
      })
      .filter((entry) => entry.reasons.length > 0)
      .sort((a, b) => b.reasons.length - a.reasons.length || ((a.delta ?? 0) - (b.delta ?? 0)));
  }, [patients]);

  const reportAssistantSuggestions = useMemo(() => {
    const selectedDoctorName = selectedDoctor?.username ?? "ce medecin";
    const topPatient = (patients as Patient[]).find(
      (p) => p.prediction === "Moderate Demented" || p.prediction === "Severe Demented"
    );

    return [
      `Donne-moi un resume clinique pour ${selectedDoctorName}.`,
      "Quels conseils donner aux aidants des patients a haut risque ?",
      topPatient ? `Comment accompagner le patient ${topPatient.name} au quotidien ?` : "Comment organiser le suivi des patients Alzheimer ?",
      "Quelles activites recommandees pour ralentir le declin cognitif ?",
    ];
  }, [patients, selectedDoctor]);

  const filteredPatients = useMemo(() =>
    (patients as Patient[]).filter((p) => {
      const matchSearch =
        p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.email.toLowerCase().includes(search.toLowerCase());
      const matchFilter =
        filterPrediction === "all" || p.prediction === filterPrediction;
      const matchRisk =
        filterRisk === "all" || getRiskBucket(p.prediction) === filterRisk;
      return matchSearch && matchFilter && matchRisk;
    }),
    [patients, search, filterPrediction, filterRisk]
  );

  // ── Handlers ────────────────────────────────────────────────────────────────
  const handleDownloadCSV = async () => {
    if (!selectedDoctor || patients.length === 0) {
      toast.error("Aucun patient à exporter");
      return;
    }
    const loadingToast = toast.loading(`Preparation du CSV... (${patients.length} patient(s))`);

    let irmDataMap: Record<string, PatientIrmData> = {};
    const withTimeout = async <T,>(promise: Promise<T>, timeoutMs: number): Promise<T> =>
      await Promise.race([
        promise,
        new Promise<T>((_, reject) =>
          window.setTimeout(() => reject(new Error("timeout")), timeoutMs)
        ),
      ]);

    try {
      const results = await Promise.allSettled(
        (patients as Patient[]).map((patient) =>
          withTimeout(getPatientIrmImage(patient._id, user?.token ?? ""), 3500)
        )
      );

      results.forEach((result, index) => {
        if (result.status === "fulfilled") {
          irmDataMap[(patients as Patient[])[index]._id] = result.value;
        }
      });

      const header = [
        "Nom",
        "Email",
        "Age",
        "Symptomes",
        "Prediction",
        "Modele prefere",
        "Score modele prefere",
        "Classement modeles",
        "Details scores modeles",
        "Date",
      ].join(",");
      const rows = (patients as Patient[]).map((p) => {
        const fresh = irmDataMap[p._id];
        const latestHistory = p.medicalHistory?.length ? [...p.medicalHistory].reverse()[0] : undefined;
        const prediction = fresh?.prediction ?? p.prediction ?? latestHistory?.diagnosis ?? "N/A";
        const probabilities = (fresh?.probabilities && Object.keys(fresh.probabilities).length > 0)
          ? fresh.probabilities
          : p.probabilities ?? latestHistory?.probabilities ?? {};
        const storedAllModels = fresh?.allModels ?? p.allModels ?? latestHistory?.allModels ?? {};
        const derivedComparison = Object.keys(storedAllModels).length === 0
          ? deriveModelComparison(prediction === "N/A" ? p.prediction : prediction, probabilities)
          : null;
        const allModels = Object.keys(storedAllModels).length > 0
          ? storedAllModels
          : (derivedComparison?.allModels ?? {});
        const rankedModels = (fresh?.rankedModels?.length
          ? fresh.rankedModels
          : p.rankedModels?.length
            ? p.rankedModels
            : latestHistory?.rankedModels?.length
              ? latestHistory.rankedModels
              : derivedComparison?.rankedModels?.length
                ? derivedComparison.rankedModels
                : undefined) ?? [];
        const totalModels = fresh?.totalModels ?? p.totalModels ?? latestHistory?.totalModels ?? derivedComparison?.totalModels ?? 0;
        const patientForExport: Patient = {
          ...p,
          prediction: prediction === "N/A" ? p.prediction : prediction,
          probabilities,
          allModels,
          rankedModels,
          totalModels,
          bestModel: fresh?.bestModel ?? p.bestModel ?? latestHistory?.bestModel ?? null,
        };
        const { bestModel, bestConfidence } = getPatientBestModelSummary(patientForExport);
        const rankedEntries = getPatientRankedModelEntries(patientForExport);
        const fallbackTopProbability = getTopProbability(probabilities);
        const resolvedPrediction = prediction !== "N/A"
          ? prediction
          : (fallbackTopProbability?.[0] ?? p.prediction ?? "N/A");
        const resolvedScore = bestConfidence != null
          ? `${(bestConfidence * 100).toFixed(1)}%`
          : (fallbackTopProbability ? `${(fallbackTopProbability[1] * 100).toFixed(1)}%` : "N/A");
        const resolvedBestModel = bestModel ?? (fallbackTopProbability ? "Probabilite globale" : "N/A");
        const rankingText = rankedEntries
          .map(([modelName, result], index) => `#${index + 1} ${modelName} (${(result.confidence * 100).toFixed(1)}%)`)
          .join(" | ") || (fallbackTopProbability ? `${fallbackTopProbability[0]} (${(fallbackTopProbability[1] * 100).toFixed(1)}%)` : "");
        const detailedScores = rankedEntries
          .map(([modelName, result]) => {
            const topStage = Object.entries(result.probabilities ?? {})
              .sort((a, b) => b[1] - a[1])[0];
            const topStageText = topStage ? `${topStage[0]} ${(topStage[1] * 100).toFixed(1)}%` : result.prediction;
            return `${modelName}: score ${(result.confidence * 100).toFixed(1)}%, prediction ${result.prediction}, top ${topStageText}`;
          })
          .join(" | ") || (fallbackTopProbability ? `Prediction ${fallbackTopProbability[0]} avec score ${(fallbackTopProbability[1] * 100).toFixed(1)}%` : "");
        const rankingCell = derivedComparison?.isDerived
          ? `Scores reconstitues | ${rankingText}`
          : rankingText;
        const detailedScoresCell = derivedComparison?.isDerived
          ? `Reconstitution a partir du score global du scan | ${detailedScores}`
          : detailedScores;

        return `"${p.name}","${p.email}","${p.age ?? "N/A"}","${p.symptoms?.join("; ") ?? ""}","${resolvedPrediction}","${resolvedBestModel}","${resolvedScore}","${rankingCell}","${detailedScoresCell}","${new Date(p.createdAt).toLocaleDateString("fr-FR")}"`;
      });
      const csv = [header, ...rows].join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `rapport_${selectedDoctor.username}_${new Date().toISOString().split("T")[0]}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast.success("CSV exporte avec succes !", { id: loadingToast });
    } catch {
      toast.error("Impossible de preparer le CSV complet", { id: loadingToast });
    }
  };

  const handlePrint = async () => {
    if (!selectedDoctor || patients.length === 0) {
      toast.error("Aucun patient a imprimer");
      return;
    }

    const previewWindow = window.open("", "_blank");
    if (!previewWindow) {
      toast.error("Le navigateur a bloque l'ouverture du rapport");
      return;
    }

    previewWindow.document.write(`<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Preparation</title></head><body style="font-family:Arial,sans-serif;padding:24px;background:#f8fafc;color:#0f172a"><h2>Preparation du rapport...</h2><p>Chargement des images IRM et des donnees IA.</p></body></html>`);
    previewWindow.document.close();

    let irmDataMap: Record<string, PatientIrmData> = {};
    const loadingToast = toast.loading(`Preparation du rapport... (${patients.length} patient(s))`);
    const withTimeout = async <T,>(promise: Promise<T>, timeoutMs: number): Promise<T> =>
      await Promise.race([
        promise,
        new Promise<T>((_, reject) =>
          window.setTimeout(() => reject(new Error("timeout")), timeoutMs)
        ),
      ]);

    try {
      const results = await Promise.allSettled(
        (patients as Patient[]).map((patient) =>
          withTimeout(getPatientIrmImage(patient._id, user?.token ?? ""), 3500)
        )
      );

      results.forEach((result, index) => {
        if (result.status === "fulfilled") {
          irmDataMap[(patients as Patient[])[index]._id] = result.value;
        }
      });
    } finally {
      toast.dismiss(loadingToast);
    }

    // ── 2. Convertit un base64 en Blob URL (fiable pour l'impression) ─────
    const toObjectURL = (b64: string): string => {
      try {
        const [header, data] = b64.split(",");
        const mime = header.match(/:(.*?);/)?.[1] ?? "image/jpeg";
        const binary = atob(data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return URL.createObjectURL(new Blob([bytes], { type: mime }));
      } catch {
        return b64;
      }
    };

    const blobUrls: string[] = [];
    const getImgUrl = (b64: string | null | undefined): string | null => {
      if (!b64) return null;
      const url = toObjectURL(b64);
      blobUrls.push(url);
      return url;
    };

    const buildPatientPage = (p: Patient, idx: number): string => {
      const fresh = irmDataMap[p._id];
      const pred = fresh?.prediction ?? p.prediction ?? "Non Demented";
      const scanDate = fresh?.lastScanDate ?? p.lastScanDate ?? p.createdAt;
      const latestHistory = p.medicalHistory?.length ? [...p.medicalHistory].reverse()[0] : undefined;
      const baseProbabilities = (fresh?.probabilities && Object.keys(fresh.probabilities).length > 0)
        ? fresh.probabilities
        : p.probabilities ?? latestHistory?.probabilities ?? {};
      const storedAllModels = fresh?.allModels ?? p.allModels ?? latestHistory?.allModels ?? {};
      const derivedComparison = Object.keys(storedAllModels).length === 0
        ? deriveModelComparison(pred, baseProbabilities)
        : null;
      const allModels = Object.keys(storedAllModels).length > 0
        ? storedAllModels
        : (derivedComparison?.allModels ?? {});
      const derivedRankedModels = Object.keys(allModels).sort((a, b) => {
        const aConfidence = allModels[a]?.confidence ?? 0;
        const bConfidence = allModels[b]?.confidence ?? 0;
        return bConfidence - aConfidence;
      });
      const rankedModels = (fresh?.rankedModels?.length
        ? fresh.rankedModels
        : p.rankedModels?.length
          ? p.rankedModels
          : latestHistory?.rankedModels?.length
            ? latestHistory.rankedModels
            : derivedComparison?.rankedModels?.length
              ? derivedComparison.rankedModels
              : derivedRankedModels) ?? [];
      const bestModel = fresh?.bestModel
        ?? p.bestModel
        ?? latestHistory?.bestModel
        ?? derivedComparison?.bestModel
        ?? rankedModels[0]
        ?? null;
      const bestModelResult = bestModel ? allModels[bestModel] : undefined;
      const bestScore = bestModelResult?.confidence ?? null;
      const totalModels = fresh?.totalModels
        ?? p.totalModels
        ?? latestHistory?.totalModels
        ?? derivedComparison?.totalModels
        ?? rankedModels.length
        ?? Object.keys(allModels).length
        ?? 0;
      const explanation = fresh?.explanation ?? p.explanation ?? "";
      const symptomsText = p.symptoms?.length ? p.symptoms.join(", ") : "Aucun symptome renseigne";
      const clinicalSummary = repairMojibake(AI_NOTES[pred] ?? "Analyse non disponible.");
      const topProbability = getTopProbability(baseProbabilities);
      const topProbabilityLabel = topProbability?.[0] ?? null;
      const topProbabilityValue = topProbability?.[1] ?? null;
      const decisionNarrative = bestModel
        ? `Le modele ${bestModel} a ete retenu pour ce scan${bestScore != null ? ` avec un score de ${(bestScore * 100).toFixed(1)}%` : ""}.`
        : "Les details complets de comparaison ne sont pas encore enregistres pour ce scan.";
      const rankingFallback = `
        <div style="padding:14px 16px;border:1px dashed #cbd5e1;border-radius:14px;background:#f8fafc;color:#334155">
          <div style="font-size:14px;font-weight:800;color:#0f172a;margin-bottom:6px">Classement detaille indisponible</div>
          <p style="margin:0 0 8px 0;font-size:13px;line-height:1.6">${escapeHtml(decisionNarrative)}</p>
          <p style="margin:0;font-size:13px;line-height:1.6;color:#64748b">
            Ce scan ne contient pas encore les scores detailles des autres modeles. Un nouveau scan permettra d'afficher le classement complet.
          </p>
        </div>`;
      const carePlan = REPORT_CARE_PLAN[pred] ?? REPORT_CARE_PLAN["Non Demented"];
      const stageWebResources = getStageWebResources(pred);
      const probs = baseProbabilities;
      const rawIrm = fresh?.irmImage ?? p.irmImage;
      const irmUrl = getImgUrl(rawIrm);
      const heatmapUrl = buildIndicativeHeatmapUrl(probs, pred);
      const historyItems = p.medicalHistory?.length
        ? [...p.medicalHistory].reverse().slice(0, 3).map((h) =>
            `<li>${escapeHtml(new Date(h.date).toLocaleDateString("fr-FR"))} - ${escapeHtml(h.diagnosis)}</li>`
          ).join("")
        : "<li>Aucun historique medical enregistre</li>";
      const scores = probs && Object.keys(probs).length > 0
        ? Object.entries(probs)
            .sort((a, b) => b[1] - a[1])
            .map(([label, val]) => {
              const pct = (val * 100).toFixed(1);
              const color = PREDICTION_COLORS[label] ?? "#64748b";
              return `<div style="margin-bottom:10px">
                <div style="display:flex;justify-content:space-between;gap:12px;font-size:13px;margin-bottom:4px">
                  <span>${escapeHtml(label)}</span>
                  <strong style="color:${color}">${pct}%</strong>
                </div>
                <div style="height:10px;background:#e2e8f0;border-radius:999px;overflow:hidden">
                  <div style="width:${pct}%;height:10px;background:${color};border-radius:999px"></div>
                </div>
              </div>`;
            }).join("")
        : "<p style=\"margin:0;color:#64748b\">Probabilites non disponibles</p>";
      const modelSectionTitle = derivedComparison?.isDerived
        ? "Classement des modeles (scores reconstitues)"
        : "Classement des modeles";
      const probabilityColumnTitle = derivedComparison?.isDerived
        ? "Probabilites globales du scan"
        : "Probabilities";
      const derivedNotice = derivedComparison?.isDerived
        ? `<div style="margin-bottom:12px;padding:12px 14px;border:1px solid #fcd34d;border-radius:16px;background:#fffbeb;color:#92400e;font-size:12px;line-height:1.6">
            Les 5 scores ci-dessous sont reconstitues a partir du score global enregistre pour ce scan.
            Ils servent a donner un ordre indicatif entre les modeles et ne representent pas des probabilites reelles calculees separement pour chaque modele.
          </div>`
        : "";
      const modelCards = rankedModels.length > 0
        ? `<div style="overflow:hidden;border:1px solid #dbe4f0;border-radius:18px">
            <table style="width:100%;border-collapse:collapse;background:#ffffff">
              <thead>
                <tr style="background:#f8fafc">
                  <th style="text-align:left;padding:12px 14px;font-size:12px;color:#475569;border-bottom:1px solid #e2e8f0">#</th>
                  <th style="text-align:left;padding:12px 14px;font-size:12px;color:#475569;border-bottom:1px solid #e2e8f0">Nom du modele</th>
                  <th style="text-align:left;padding:12px 14px;font-size:12px;color:#475569;border-bottom:1px solid #e2e8f0">Prediction</th>
                  <th style="text-align:left;padding:12px 14px;font-size:12px;color:#475569;border-bottom:1px solid #e2e8f0">Confidence</th>
                  <th style="text-align:left;padding:12px 14px;font-size:12px;color:#475569;border-bottom:1px solid #e2e8f0">${probabilityColumnTitle}</th>
                </tr>
              </thead>
              <tbody>
                ${rankedModels.map((modelName, modelIndex) => {
                  const modelResult = allModels[modelName];
                  const confidence = modelResult ? `${(modelResult.confidence * 100).toFixed(1)}%` : "N/A";
                  const modelPrediction = modelResult?.prediction ?? "N/A";
                  const rowBackground = modelName === bestModel ? "#eff6ff" : "#ffffff";
                  const probabilitiesHtml = modelResult?.probabilities
                    ? Object.entries(modelResult.probabilities)
                        .sort((a, b) => b[1] - a[1])
                        .map(([label, value]) => `${escapeHtml(label)}: ${(value * 100).toFixed(1)}%`)
                        .join("<br />")
                    : "N/A";

                  return `<tr style="background:${rowBackground}">
                    <td style="padding:12px 14px;font-size:13px;color:#334155;border-bottom:1px solid #e2e8f0">#${modelIndex + 1}${modelName === bestModel ? " • meilleur" : ""}</td>
                    <td style="padding:12px 14px;font-size:13px;font-weight:700;color:#0f172a;border-bottom:1px solid #e2e8f0">${escapeHtml(modelName)}</td>
                    <td style="padding:12px 14px;font-size:13px;color:#334155;border-bottom:1px solid #e2e8f0">${escapeHtml(modelPrediction)}</td>
                    <td style="padding:12px 14px;font-size:13px;font-weight:800;color:#0f172a;border-bottom:1px solid #e2e8f0">${confidence}</td>
                    <td style="padding:12px 14px;font-size:12px;line-height:1.6;color:#334155;border-bottom:1px solid #e2e8f0">${probabilitiesHtml}</td>
                  </tr>`;
                }).join("")}
              </tbody>
            </table>
          </div>`
        : rankingFallback;
      const reportRankingText = rankedModels.length > 0
        ? rankedModels
            .map((modelName, index) => {
              const modelResult = allModels[modelName];
              return modelResult ? `#${index + 1} ${modelName} (${(modelResult.confidence * 100).toFixed(1)}%)` : null;
            })
            .filter((value): value is string => value !== null)
            .join(" | ")
        : (topProbabilityLabel && topProbabilityValue != null
            ? `${topProbabilityLabel} (${(topProbabilityValue * 100).toFixed(1)}%)`
            : "Aucun classement disponible");
      const reportDetailedScores = rankedModels.length > 0
        ? rankedModels
            .map((modelName) => {
              const modelResult = allModels[modelName];
              if (!modelResult) return null;
              const topStage = Object.entries(modelResult.probabilities ?? {})
                .sort((a, b) => b[1] - a[1])[0];
              const topStageText = topStage
                ? `${topStage[0]} ${(topStage[1] * 100).toFixed(1)}%`
                : modelResult.prediction;
              return `${modelName}: score ${(modelResult.confidence * 100).toFixed(1)}%, prediction ${modelResult.prediction}, top ${topStageText}`;
            })
            .filter((value): value is string => value !== null)
            .join(" | ")
        : (topProbabilityLabel && topProbabilityValue != null
            ? `Prediction ${topProbabilityLabel} avec score ${(topProbabilityValue * 100).toFixed(1)}%`
            : "Aucun detail de score disponible");
      const reportRankingLabel = derivedComparison?.isDerived
        ? `Scores reconstitues | ${reportRankingText}`
        : reportRankingText;
      const reportDetailedLabel = derivedComparison?.isDerived
        ? `Reconstitution a partir du score global du scan | ${reportDetailedScores}`
        : reportDetailedScores;
      const bulletList = (items: string[], accent: string) =>
        `<ul style="margin:0;padding-left:18px;color:#334155">${items.map((item) => `<li style="margin-bottom:8px"><span style="color:${accent}">•</span> ${escapeHtml(item)}</li>`).join("")}</ul>`;
      const stageWebResourcesHtml = stageWebResources
        .map(
          (resource) => `
            <a
              href="${escapeHtml(resource.url)}"
              target="_blank"
              rel="noreferrer"
              style="display:block;padding:14px 16px;border:1px solid #dbe4f0;border-radius:18px;background:#ffffff;text-decoration:none"
            >
              <div style="font-size:13px;font-weight:800;color:#0f172a;margin-bottom:6px">${escapeHtml(resource.title)}</div>
              <div style="font-size:12px;line-height:1.6;color:#475569;margin-bottom:8px">${escapeHtml(resource.description)}</div>
              <div style="font-size:12px;color:#2563eb;word-break:break-word">${escapeHtml(resource.url)}</div>
            </a>`
        )
        .join("");
      return `
        <section style="margin-bottom:28px;border:1px solid #dbe4f0;border-radius:28px;overflow:hidden;background:#ffffff;box-shadow:0 20px 45px rgba(15,23,42,0.08)">
          <div style="padding:24px 28px;background:linear-gradient(135deg,#0f172a 0%,#1d4ed8 100%);color:#ffffff">
            <div style="display:flex;justify-content:space-between;gap:20px;align-items:flex-start">
              <div>
                <div style="font-size:12px;letter-spacing:0.14em;text-transform:uppercase;opacity:0.75">Patient ${idx + 1}</div>
                <h2 style="margin:6px 0 8px 0;font-size:30px;line-height:1.1">${escapeHtml(p.name)}</h2>
                <div style="font-size:14px;opacity:0.9">${escapeHtml(p.email)}${p.age ? ` • ${p.age} ans` : ""}</div>
              </div>
              <div style="text-align:right">
                <div style="display:inline-block;padding:9px 14px;border-radius:999px;background:${PREDICTION_COLORS[pred] ?? "#64748b"};font-size:13px;font-weight:800">
                  ${escapeHtml(pred)}
                </div>
                <div style="margin-top:8px;font-size:12px;opacity:0.8">Scan du ${escapeHtml(new Date(scanDate).toLocaleDateString("fr-FR"))}</div>
              </div>
            </div>
          </div>

          <div style="padding:28px">
            <div style="display:grid;grid-template-columns:1.1fr 0.9fr;gap:22px;margin-bottom:22px">
              <div style="border:1px solid #e2e8f0;border-radius:22px;padding:18px;background:#f8fafc">
                <div style="font-size:12px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;color:#475569;margin-bottom:12px">IRM du patient</div>
                ${irmUrl
                  ? `<img src="${irmUrl}" alt="IRM ${escapeHtml(p.name)}" style="width:100%;max-height:340px;object-fit:contain;border-radius:18px;border:1px solid #cbd5e1;background:#020617" />`
                  : `<div style="padding:56px 20px;text-align:center;border:1px dashed #cbd5e1;border-radius:18px;color:#64748b;background:#ffffff">Aucune image IRM disponible</div>`}
              </div>
              <div style="display:grid;gap:18px">
                <div style="border:1px solid #e2e8f0;border-radius:22px;padding:18px;background:#ffffff">
                  <div style="font-size:12px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;color:#475569;margin-bottom:12px">Decision IA</div>
                  <div style="font-size:14px;color:#334155;margin-bottom:6px">Modele retenu</div>
                  <div style="font-size:24px;font-weight:900;color:#0f172a">${escapeHtml(bestModel ?? topProbabilityLabel ?? "Details de comparaison non enregistres")}</div>
                  <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:14px">
                    <div style="padding:12px 14px;border-radius:16px;background:#eff6ff;border:1px solid #bfdbfe">
                      <div style="font-size:11px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#1d4ed8;margin-bottom:4px">Modele principal</div>
                      <div style="font-size:22px;font-weight:900;color:#0f172a">${bestScore != null ? `${(bestScore * 100).toFixed(1)}%` : (topProbabilityValue != null ? `${(topProbabilityValue * 100).toFixed(1)}%` : "N/A")}</div>
                    </div>
                    <div style="padding:12px 14px;border-radius:16px;background:#f8fafc;border:1px solid #e2e8f0">
                      <div style="font-size:11px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#475569;margin-bottom:4px">Modeles compares</div>
                      <div style="font-size:22px;font-weight:900;color:#0f172a">${totalModels > 0 ? totalModels : (derivedComparison?.totalModels ?? "N/A")}</div>
                    </div>
                  </div>
                  <div style="margin-top:10px;font-size:13px;color:#64748b">${totalModels > 0
                    ? `${totalModels} modeles compares et classes par performance.${derivedComparison?.isDerived ? " Comparaison reconstituee a partir du score global du scan." : ""}`
                    : "Ce scan ne contient pas encore les scores detailles des autres modeles. Refaites un nouveau scan apres redemarrage du backend pour afficher le classement complet."}</div>
                  ${explanation ? `<p style="margin:14px 0 0 0;font-size:13px;line-height:1.6;color:#334155">${escapeHtml(repairMojibake(explanation))}</p>` : ""}
                </div>
                <div style="border:1px solid #e2e8f0;border-radius:22px;padding:18px;background:#ffffff">
                  <div style="font-size:12px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;color:#475569;margin-bottom:12px">Scores de probabilite</div>
                  ${scores}
                </div>
              </div>
            </div>

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:22px;margin-bottom:22px">
              <div style="border:1px solid #e2e8f0;border-radius:22px;padding:18px;background:#ffffff">
                <div style="font-size:12px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;color:#475569;margin-bottom:12px">${modelSectionTitle}</div>
                ${derivedNotice}
                <div style="display:grid;gap:10px">${modelCards}</div>
              </div>
              <div style="border:1px solid #e2e8f0;border-radius:22px;padding:18px;background:#ffffff">
                <div style="font-size:12px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;color:#475569;margin-bottom:12px">Contexte clinique</div>
                <p style="margin:0 0 12px 0;font-size:14px;color:#334155"><strong>Symptomes:</strong> ${escapeHtml(symptomsText)}</p>
                <p style="margin:0 0 12px 0;font-size:14px;color:#334155"><strong>Synthese:</strong> ${escapeHtml(clinicalSummary)}</p>
                <p style="margin:0 0 12px 0;font-size:14px;color:#334155"><strong>Decision IA:</strong> ${escapeHtml(decisionNarrative)}</p>
                <div style="font-size:14px;color:#334155"><strong>Historique recent:</strong></div>
                <ul style="margin:8px 0 0 18px;color:#334155">${historyItems}</ul>
                <div style="margin-top:14px;padding:14px;border-radius:18px;background:#f8fafc;border:1px solid #e2e8f0">
                  <div style="font-size:12px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#475569;margin-bottom:10px">Detail dynamique du scan IRM</div>
                  <p style="margin:0 0 8px 0;font-size:13px;line-height:1.6;color:#334155"><strong>Modele retenu:</strong> ${escapeHtml(bestModel ?? topProbabilityLabel ?? "N/A")}</p>
                  <p style="margin:0 0 8px 0;font-size:13px;line-height:1.6;color:#334155"><strong>Score principal:</strong> ${escapeHtml(bestScore != null ? `${(bestScore * 100).toFixed(1)}%` : (topProbabilityValue != null ? `${(topProbabilityValue * 100).toFixed(1)}%` : "N/A"))}</p>
                  <p style="margin:0 0 8px 0;font-size:13px;line-height:1.6;color:#334155"><strong>Classement:</strong> ${escapeHtml(reportRankingLabel)}</p>
                  <p style="margin:0;font-size:13px;line-height:1.7;color:#334155"><strong>Details:</strong> ${escapeHtml(reportDetailedLabel)}</p>
                </div>
              </div>
            </div>

            ${heatmapUrl ? `
              <div style="margin-bottom:22px;border:1px solid #e2e8f0;border-radius:22px;padding:18px;background:#ffffff">
                <div style="font-size:12px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;color:#475569;margin-bottom:12px">Explication visuelle de l'IRM</div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
                  <div>
                    <div style="font-size:12px;font-weight:700;color:#334155;margin-bottom:8px">Image source</div>
                    ${irmUrl ? `<img src="${irmUrl}" alt="IRM source ${escapeHtml(p.name)}" style="width:100%;max-height:240px;object-fit:contain;border-radius:16px;border:1px solid #cbd5e1;background:#020617" />` : ""}
                  </div>
                  <div>
                    <div style="font-size:12px;font-weight:700;color:#334155;margin-bottom:8px">Heatmap indicative</div>
                    <img src="${heatmapUrl}" alt="Heatmap indicative ${escapeHtml(p.name)}" style="width:100%;max-height:240px;object-fit:contain;border-radius:16px;border:1px solid #cbd5e1;background:#020617" />
                  </div>
                </div>
                <p style="margin:12px 0 0 0;font-size:12px;line-height:1.6;color:#64748b">Carte visuelle indicative construite a partir des probabilites du scan pour aider la lecture clinique. Ce visuel n'est pas un Grad-CAM medical certifie.</p>
              </div>
            ` : ""}

            <div style="border:1px solid #dbe4f0;border-radius:24px;padding:22px;background:linear-gradient(180deg,#fffdf6 0%,#ffffff 100%)">
              <div style="font-size:12px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;color:#92400e;margin-bottom:10px">Plan de conseils et prise en charge</div>
              <h3 style="margin:0 0 10px 0;font-size:22px;color:#111827">${escapeHtml(carePlan.headline)}</h3>
              <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px">
                <div style="padding:16px;border-radius:18px;background:#fff7ed;border:1px solid #fed7aa">
                  <div style="font-size:14px;font-weight:800;color:#9a3412;margin-bottom:10px">Medicaments possibles</div>
                  ${bulletList(carePlan.medications, "#ea580c")}
                </div>
                <div style="padding:16px;border-radius:18px;background:#eff6ff;border:1px solid #bfdbfe">
                  <div style="font-size:14px;font-weight:800;color:#1d4ed8;margin-bottom:10px">Activites recommandees</div>
                  ${bulletList(carePlan.activities, "#2563eb")}
                </div>
                <div style="padding:16px;border-radius:18px;background:#f8fafc;border:1px solid #cbd5e1">
                  <div style="font-size:14px;font-weight:800;color:#334155;margin-bottom:10px">Conseils pratiques</div>
                  ${bulletList(carePlan.hygiene, "#475569")}
                </div>
              </div>
              <p style="margin:14px 0 0 0;font-size:12px;line-height:1.6;color:#78716c">Ces recommandations sont informatives. Toute prescription medicamenteuse doit etre validee par un medecin qualifie apres evaluation clinique complete.</p>
            </div>

            <div style="margin-top:22px;border:1px solid #dbe4f0;border-radius:24px;padding:22px;background:#f8fbff">
              <div style="font-size:12px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;color:#1d4ed8;margin-bottom:10px">Ressources web pour le medecin</div>
              <h3 style="margin:0 0 10px 0;font-size:22px;color:#111827">Liens utiles selon le stade detecte: ${escapeHtml(pred)}</h3>
              <p style="margin:0 0 16px 0;font-size:13px;line-height:1.7;color:#475569">
                Ces liens officiels ouvrent dans la fenetre about:blank et aident a mieux interpreter le stade du patient,
                la progression attendue et les mesures de prise en charge adaptees.
              </p>
              <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px">
                ${stageWebResourcesHtml}
              </div>
            </div>

          </div>
        </section>`;
    };

    const allPatientsPages = (patients as Patient[]).length === 0
      ? `<div style="text-align:center;padding:80px 20px;color:#9ca3af">
           <p style="font-size:20px">Aucun patient assigne a ce medecin.</p>
         </div>`
      : (patients as Patient[]).map((p, i) => buildPatientPage(p, i)).join("\n");

    const now = new Date();

    const reportHTML = `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <title>Rapport - ${escapeHtml(formatDoctorName(selectedDoctor?.username))}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: Arial, sans-serif; padding: 28px; color: #111827; background: linear-gradient(180deg, #eaf1ff 0%, #f8fafc 35%, #ffffff 100%); line-height: 1.5; }
    h1, h2, h3, p { margin-top: 0; }
    button { background:#2563eb;color:#fff;border:none;border-radius:999px;padding:12px 18px;cursor:pointer;font-weight:700; }
    @media print {
      .print-toolbar { display:none; }
      body { padding: 0; background: #ffffff; }
      section { break-inside: avoid; page-break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="print-toolbar" style="display:flex;justify-content:space-between;align-items:flex-end;gap:16px;margin-bottom:24px;padding:22px 24px;border-radius:28px;background:linear-gradient(135deg,#0f172a 0%,#1d4ed8 100%);color:#ffffff;box-shadow:0 24px 50px rgba(29,78,216,0.22)">
    <div>
      <div style="font-size:12px;letter-spacing:0.16em;text-transform:uppercase;opacity:0.7">DataScoop</div>
      <h1 style="margin:6px 0 8px 0;font-size:34px">Rapport clinique IA</h1>
      <p style="margin:0;font-size:14px;opacity:0.9">${escapeHtml(formatDoctorName(selectedDoctor?.username))} • ${escapeHtml(selectedDoctor?.email ?? "")}</p>
      <p style="margin:6px 0 0 0;font-size:13px;opacity:0.75">${patients.length} patient(s) • ${escapeHtml(now.toLocaleDateString("fr-FR"))}</p>
    </div>
    <button onclick="window.print()">Imprimer</button>
  </div>
  ${allPatientsPages}
</body>
</html>`;

    const cleanReportHTML = repairMojibake(reportHTML);

    try {
      const cleanup = () => {
        blobUrls.forEach((url) => URL.revokeObjectURL(url));
      };

      previewWindow.document.open();
      previewWindow.document.write(cleanReportHTML);
      previewWindow.document.close();
      previewWindow.focus();

      window.setTimeout(cleanup, 5000);
    } catch (error) {
      blobUrls.forEach((url) => URL.revokeObjectURL(url));
      console.error("Erreur impression rapport:", error);
      try {
        previewWindow.document.open();
        previewWindow.document.write(`<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><title>Erreur impression</title></head>
<body style="font-family:Segoe UI,Tahoma,Geneva,Verdana,sans-serif;padding:24px">
  <h2>Erreur lors de la generation du rapport</h2>
  <p>Le rapport n'a pas pu etre affiche automatiquement.</p>
  <pre>${String(error)}</pre>
</body>
</html>`);
        previewWindow.document.close();
      } catch {}
      toast.error("Erreur lors de la generation du rapport");
      return;
    }

    const nbWithImage = Object.values(irmDataMap).filter((p) => p.irmImage).length || (patients as Patient[]).filter((p) => p.irmImage).length;

    toast.success(
      repairMojibake(`Rapport affiche — ${patients.length} patient(s) · ${nbWithImage} image(s) IRM incluse(s)`)
    );
  };
  const handleDownloadPdf = async () => {
    if (!reportRef.current || !selectedDoctor) {
      toast.error("Aucun rapport disponible pour le PDF");
      return;
    }

    const loadingToast = toast.loading("Generation du PDF professionnel...");
    try {
      const printWindow = window.open("", "_blank", "noopener,noreferrer,width=1200,height=900");
      if (!printWindow) {
        throw new Error("PRINT_WINDOW_BLOCKED");
      }
      const styles = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'))
        .map((node) => node.outerHTML)
        .join("\n");
      const reportHtml = reportRef.current.outerHTML;
      const reportDate = new Date().toISOString().split("T")[0];
      const safeDoctorName = selectedDoctor.username.replace(/[^\w-]+/g, "_");
      printWindow.document.write(`
        <!DOCTYPE html>
        <html lang="fr">
          <head>
            <meta charset="UTF-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1.0" />
            <title>rapport_clinique_${safeDoctorName}_${reportDate}</title>
            ${styles}
            <style>
              body {
                margin: 0;
                padding: 24px;
                background: #ffffff;
              }
              @page {
                size: A4;
                margin: 12mm;
              }
              @media print {
                body {
                  padding: 0;
                }
              }
            </style>
          </head>
          <body>
            ${reportHtml}
          </body>
        </html>
      `);
      printWindow.document.close();
      printWindow.focus();
      printWindow.onload = () => {
        printWindow.print();
        printWindow.onafterprint = () => printWindow.close();
      };
      toast.success("Fenetre d'impression ouverte pour enregistrer le PDF", { id: loadingToast });
    } catch (error) {
      toast.error("Impossible de generer le PDF", { id: loadingToast });
    }
  };

  const handleReanalyzePatient = async (patient: Patient) => {
    if (!user?.token) return;

    setReanalyzingPatientId(patient._id);
    const loadingToast = toast.loading(`Reanalyse IRM de ${patient.name}...`);
    try {
      await reanalyzePatientScan(patient._id, user.token);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["patients-by-doctor", selectedDoctor?._id, user.token] }),
        queryClient.invalidateQueries({ queryKey: ["patient-irm", patient._id] }),
        queryClient.invalidateQueries({ queryKey: ["patients", user.token] }),
      ]);
      toast.success(`Reanalyse terminee pour ${patient.name}`, { id: loadingToast });
    } catch {
      toast.error(`Impossible de reanalyser l'IRM de ${patient.name}`, { id: loadingToast });
    } finally {
      setReanalyzingPatientId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-full bg-[linear-gradient(180deg,transparent_0%,rgba(255,255,255,0.42)_100%)] px-4 py-5 sm:px-6 lg:px-8">
        <div className="flex min-h-[300px] items-center justify-center rounded-3xl border border-border/70 bg-card/85 p-6 shadow-card backdrop-blur-sm">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">{repairMojibake("Chargement des données...")}</p>
        </div>
        </div>
      </div>
    );
  }

  if (!selectedDoctor) {
    return (
      <div className="min-h-full bg-[linear-gradient(180deg,transparent_0%,rgba(255,255,255,0.42)_100%)] px-4 py-5 text-center sm:px-6 lg:px-8">
        <div className="rounded-3xl border border-border/70 bg-card/85 p-8 shadow-card backdrop-blur-sm">
        <Brain className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
        <p className="text-muted-foreground">{repairMojibake("Aucun médecin disponible pour les rapports.")}</p>
        </div>
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-full bg-[linear-gradient(180deg,transparent_0%,rgba(255,255,255,0.42)_100%)] px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6 pb-8">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
        className="flex flex-col gap-4 rounded-3xl border border-border/70 bg-card/85 p-6 shadow-card backdrop-blur-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground flex items-center gap-2">
            <BarChart2 className="h-6 w-6 text-primary" /> {repairMojibake("Rapports Médicaux")}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {repairMojibake(`Analyses détaillées • ${(doctors as Doctor[]).length} médecin(s) • ${(allPatients as Patient[]).length} patient(s) total`)}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {/* "Réparer les images" removed: records are linked by account only, nothing to repair */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-xl gap-2"
            onClick={() => {
              queryClient.invalidateQueries({ queryKey: ["patient-irm"] });
              toast.success(repairMojibake("Images IRM actualisées"));
            }}
          >
            <RefreshCw className="h-4 w-4" /> Actualiser
          </Button>
          <Button type="button" onClick={handlePrint} variant="outline" size="sm" className="rounded-xl gap-2">
            <Printer className="h-4 w-4" /> Imprimer
          </Button>
          <Button type="button" onClick={handleDownloadPdf} variant="outline" size="sm" className="rounded-xl gap-2">
            <FileText className="h-4 w-4" /> Export PDF
          </Button>
          <Button type="button" onClick={handleDownloadCSV} size="sm" className="rounded-xl gap-2">
            <FileDown className="h-4 w-4" /> Export CSV
          </Button>
        </div>
      </motion.div>

      {/* Global stats */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
        className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { icon: <Users className="h-5 w-5 text-primary" />, label: "Total Patients", value: (allPatients as Patient[]).length },
          { icon: <Brain className="h-5 w-5 text-blue-500" />, label: repairMojibake("Médecins"), value: (doctors as Doctor[]).length },
          { icon: <AlertTriangle className="h-5 w-5 text-red-500" />, label: "Haut Risque", value: highRiskCount },
          { icon: <TrendingUp className="h-5 w-5 text-green-500" />, label: "Ce Mois", value: (allPatients as Patient[]).filter(p => {
            const d = new Date(); d.setMonth(d.getMonth() - 1); return new Date(p.createdAt) > d;
          }).length },
        ].map((s, i) => (
          <motion.div key={s.label} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.08 + i * 0.05 }}
            className="rounded-2xl border border-border bg-card p-4 shadow-card flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-muted">{s.icon}</div>
            <div>
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className="text-xl font-bold font-display text-foreground">{s.value}</p>
            </div>
          </motion.div>
        ))}
      </motion.div>

      {/* Tabs */}
      <div className="flex gap-1 bg-muted/40 p-1 rounded-xl w-fit">
        {(["overview", "patients", "charts", "assistant"] as const).map((tab) => (
          <button type="button" key={tab} onClick={() => setActiveTab(tab)}
            className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-all ${
              activeTab === tab ? "bg-card shadow text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}>
            {tab === "overview" ? "Vue d'ensemble" : tab === "patients" ? "Patients" : tab === "charts" ? "Graphiques" : "Assistant"}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW TAB ─────────────────────────────────────────────────── */}
      {activeTab === "overview" && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          <h3 className="text-sm font-semibold text-foreground">{repairMojibake("Sélectionner un médecin")}</h3>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {(doctors as Doctor[]).map((d) => {
              const dPatients = (allPatients as Patient[]).filter(p => p.assignedDoctor?._id === d._id);
              const isSelected = selectedDoctor._id === d._id;
              return (
                <button type="button" key={d._id} onClick={() => setSelectedDoctor(d)}
                  className={`text-left rounded-2xl border p-4 transition-all ${isSelected
                    ? "border-primary bg-primary/5 shadow-md"
                    : "border-border bg-card hover:border-primary/40"}`}>
                  <div className="flex items-center gap-3 mb-3">
                    <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${isSelected ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                      <Shield className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-foreground">{d.username}</p>
                      <p className="text-xs text-muted-foreground">{d.email}</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">{repairMojibake("Patients assignés")}</span>
                    <span className={`text-sm font-bold ${isSelected ? "text-primary" : "text-foreground"}`}>{dPatients.length}</span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Doctor detail card */}
          <motion.div key={selectedDoctor._id} initial={{ opacity: 0 }} animate={{ opacity: 1 }}
            ref={reportRef}
            className="rounded-2xl border border-border bg-card shadow-card p-6 space-y-4">
            <div className="flex items-center gap-3 border-b border-border pb-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10">
                <FileText className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h4 className="font-semibold text-foreground">{formatDoctorName(selectedDoctor.username)}</h4>
                <p className="text-xs text-muted-foreground">{selectedDoctor.email}</p>
              </div>
              <div className="ml-auto flex items-center gap-1.5">
                <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                <span className="text-xs text-muted-foreground">Actif</span>
              </div>
            </div>
            <div className="grid sm:grid-cols-3 gap-4 text-sm">
              <div className="rounded-xl bg-muted/40 p-3">
                <p className="text-xs text-muted-foreground mb-1">Patients totaux</p>
                <p className="text-2xl font-bold text-foreground">{patients.length}</p>
              </div>
              <div className="rounded-xl bg-green-50 dark:bg-green-900/20 p-3">
                <p className="text-xs text-muted-foreground mb-1">Non Demented</p>
                <p className="text-2xl font-bold text-green-600">{(patients as Patient[]).filter(p => p.prediction === "Non Demented").length}</p>
              </div>
              <div className="rounded-xl bg-red-50 dark:bg-red-900/20 p-3">
                <p className="text-xs text-muted-foreground mb-1">Haut risque</p>
                <p className="text-2xl font-bold text-red-500">{(patients as Patient[]).filter(p => p.prediction === "Moderate Demented" || p.prediction === "Severe Demented").length}</p>
              </div>
            </div>
            <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Patients prioritaires</p>
                  <p className="text-sm text-amber-900">Moderate/Severe, baisse rapide du score, ou changement important entre deux scans.</p>
                </div>
                <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800">
                  {priorityPatients.length}
                </span>
              </div>
              {priorityPatients.length > 0 ? (
                <div className="mt-3 grid gap-2">
                  {priorityPatients.slice(0, 4).map(({ patient, reasons, delta }) => (
                    <div key={patient._id} className="rounded-xl border border-amber-200 bg-white/90 px-3 py-2">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-foreground">{patient.name}</p>
                          <p className="text-xs text-muted-foreground">{patient.prediction ?? "Diagnostic indisponible"}</p>
                        </div>
                        {delta != null && (
                          <span className={`text-xs font-bold ${delta < 0 ? "text-red-500" : "text-green-600"}`}>
                            {delta < 0 ? "-" : "+"}{(Math.abs(delta) * 100).toFixed(1)}%
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-amber-800">{reasons.join(" • ")}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-xs text-muted-foreground">Aucun patient prioritaire detecte pour ce medecin.</p>
              )}
            </div>
            {/* Galerie miniatures IRM — chargée via endpoint dédié */}
            {(patients as Patient[]).length > 0 && (
              <div className="border-t border-border pt-4">
                <p className="text-xs font-semibold text-muted-foreground mb-3 flex items-center gap-1.5">
                  <ScanLine className="h-3.5 w-3.5 text-primary" />
                  {repairMojibake(`SCANS IRM — ${(patients as Patient[]).length} patient(s)`)}
                </p>
                <div className="flex flex-wrap gap-3">
                  {(patients as Patient[]).map(p => (
                    <OverviewIrmThumb
                      key={p._id}
                      patient={p}
                      token={user?.token ?? ""}
                      onZoom={setZoomImage}
                    />
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center gap-2 text-xs text-muted-foreground border-t border-border pt-3">
              <Clock className="h-3.5 w-3.5" />
              <span>{repairMojibake(`Rapport généré le ${new Date().toLocaleDateString("fr-FR")} à ${new Date().toLocaleTimeString("fr-FR")}`)}</span>
            </div>
          </motion.div>
        </motion.div>
      )}

      {/* ── PATIENTS TAB ─────────────────────────────────────────────────── */}
      {activeTab === "patients" && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
          {/* Doctor picker + filters */}
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-xs font-medium text-muted-foreground mr-1">{repairMojibake("Médecin:")}</span>
            {(doctors as Doctor[]).map((d) => (
              <button type="button" key={d._id} onClick={() => setSelectedDoctor(d)}
                className={`rounded-xl px-3 py-1.5 text-xs font-medium transition-all border ${
                  selectedDoctor._id === d._id ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground hover:border-primary/30"}`}>
                {d.username}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input placeholder={repairMojibake("Rechercher un patient...")} value={search} onChange={e => setSearch(e.target.value)}
                className="rounded-xl pl-8 h-8 text-xs w-48" />
            </div>
            <div className="flex items-center gap-1">
              <Filter className="h-3.5 w-3.5 text-muted-foreground" />
              <select title="Filtrer par diagnostic" aria-label="Filtrer par diagnostic" value={filterPrediction} onChange={e => setFilterPrediction(e.target.value)}
                className="text-xs rounded-xl border border-border bg-card px-2 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-primary">
                <option value="all">Tous les diagnostics</option>
                {Object.keys(PREDICTION_COLORS).map(k => <option key={k} value={k}>{k}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-1">
              <AlertTriangle className="h-3.5 w-3.5 text-muted-foreground" />
              <select title="Filtrer par niveau de risque" aria-label="Filtrer par niveau de risque" value={filterRisk} onChange={e => setFilterRisk(e.target.value)}
                className="text-xs rounded-xl border border-border bg-card px-2 py-1.5 text-foreground focus:outline-none focus:ring-1 focus:ring-primary">
                <option value="all">Tous les risques</option>
                <option value="high">Haut risque</option>
                <option value="medium">Risque moyen</option>
                <option value="low">Risque faible</option>
              </select>
            </div>
            <button
              type="button"
              onClick={() => {
                setSearch("");
                setFilterPrediction("all");
                setFilterRisk("all");
              }}
              className="rounded-xl border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Reinitialiser
            </button>
            <span className="text-xs text-muted-foreground ml-auto">{repairMojibake(`${filteredPatients.length} résultat(s)`)}</span>
          </div>

          {patientsLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, index) => (
                <div key={index} className="rounded-2xl border border-border bg-card shadow-card p-4 animate-pulse">
                  <div className="flex items-center justify-between">
                    <div className="space-y-2">
                      <div className="h-4 w-32 rounded bg-muted" />
                      <div className="h-3 w-48 rounded bg-muted" />
                    </div>
                    <div className="h-6 w-24 rounded-full bg-muted" />
                  </div>
                </div>
              ))}
            </div>
          ) : filteredPatients.length === 0 ? (
            <EmptyState
              icon={<Users className="h-5 w-5" />}
              title={patients.length === 0 ? "Aucun patient assigne" : "Aucun patient pour ces filtres"}
              description={patients.length === 0
                ? "Les patients suivis par ce medecin apparaitront ici apres leur premiere analyse."
                : "Essaie une recherche plus large ou reinitialise les filtres actifs."}
            />
          ) : (
            <div className="space-y-3">
              {filteredPatients.map((patient: Patient, i: number) => (
                <motion.div key={patient._id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                  className="rounded-2xl border border-border bg-card shadow-card overflow-hidden">
                  <button type="button" onClick={() => setExpandedPatient(expandedPatient === patient._id ? null : patient._id)}
                    className="w-full flex items-center justify-between p-4 hover:bg-muted/20 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="h-9 w-9 rounded-xl bg-muted flex items-center justify-center text-sm font-bold text-foreground">
                        {patient.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="text-left">
                        <p className="text-sm font-medium text-foreground">{patient.name}</p>
                        <p className="text-xs text-muted-foreground">{repairMojibake(`${patient.email}${patient.age ? ` • ${patient.age} ans` : ""}`)}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {patient.prediction && (
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${PREDICTION_BG[patient.prediction] ?? "bg-muted text-muted-foreground"}`}>
                          {patient.prediction}
                        </span>
                      )}
                      <Activity className="h-3.5 w-3.5 text-muted-foreground" />
                      {expandedPatient === patient._id ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                    </div>
                  </button>
                  {expandedPatient === patient._id && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      className="border-t border-border"
                    >
                      {/* ── Image IRM + Probabilités côte à côte ──────────────── */}
                      <div className="grid sm:grid-cols-2 gap-0 divide-y sm:divide-y-0 sm:divide-x divide-border">

                        {/* Image IRM — chargée à la demande */}
                        <PatientIrmPanel
                          patientId={patient._id}
                          patientName={patient.name}
                          patientCreatedAt={patient.createdAt}
                          token={user?.token ?? ""}
                          onZoom={setZoomImage}
                        />

                        {/* Scores IA + Symptômes */}
                        <div className="p-4 space-y-3">
                          {(() => {
                            const { bestModel, bestConfidence, totalModels } = getPatientBestModelSummary(patient);
                            const rankedEntries = getPatientRankedModelEntries(patient);

                            if (!bestModel && rankedEntries.length === 0) return null;

                            return (
                              <div className="space-y-3 rounded-xl border border-primary/20 bg-primary/5 p-3">
                                <div>
                                  <p className="text-[11px] font-semibold uppercase tracking-wide text-primary">
                                    Meilleur modele IA
                                  </p>
                                  <div className="mt-1 flex items-center justify-between gap-3">
                                    <div>
                                      <p className="text-sm font-bold text-foreground">{bestModel ?? rankedEntries[0]?.[0] ?? "Modele indisponible"}</p>
                                      <p className="text-xs text-muted-foreground">
                                        {totalModels > 0 ? `${totalModels} modeles compares` : "Comparaison IA disponible"}
                                      </p>
                                    </div>
                                    {bestConfidence != null && (
                                      <div className="text-right">
                                        <p className="text-lg font-extrabold text-primary">
                                          {(bestConfidence * 100).toFixed(1)}%
                                        </p>
                                        <p className="text-[11px] text-muted-foreground">meilleur score</p>
                                      </div>
                                    )}
                                  </div>
                                </div>

                                {rankedEntries.length > 0 && (
                                  <div className="space-y-2 rounded-lg border border-primary/10 bg-background/70 p-2.5">
                                    <div className="flex items-center justify-between gap-2">
                                      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                        Scores par modele
                                      </p>
                                      <button
                                        type="button"
                                        onClick={() => void handleReanalyzePatient(patient)}
                                        disabled={reanalyzingPatientId === patient._id}
                                        className="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/5 px-2 py-1 text-[10px] font-semibold text-primary disabled:opacity-50"
                                      >
                                        {reanalyzingPatientId === patient._id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                                        Reanalyser IRM
                                      </button>
                                    </div>
                                    {rankedEntries.map(([modelName, result], index) => (
                                      <div key={modelName} className="rounded-lg border border-border/70 bg-card px-2.5 py-2">
                                        <div className="flex items-start justify-between gap-3">
                                          <div>
                                            <p className="text-xs font-semibold text-foreground">
                                              #{index + 1} {modelName}
                                            </p>
                                            <p className="text-[11px] text-muted-foreground">
                                              {result.prediction}
                                            </p>
                                          </div>
                                          <div className="text-right">
                                            <p className="text-sm font-extrabold text-foreground">
                                              {(result.confidence * 100).toFixed(1)}%
                                            </p>
                                            <p className="text-[11px] text-muted-foreground">
                                              {result.inference_time_ms} ms
                                            </p>
                                          </div>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })()}

                          {/* Barres de probabilité */}
                          {patient.probabilities && Object.keys(patient.probabilities).length > 0 ? (
                            <div className="space-y-1.5">
                              <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                                <Brain className="h-3.5 w-3.5 text-primary" /> SCORES IA PAR STADE
                              </p>
                              {Object.entries(patient.probabilities)
                                .sort((a, b) => b[1] - a[1])
                                .map(([label, val]) => (
                                  <div key={label}>
                                    <div className="flex justify-between text-[11px] mb-0.5">
                                      <span className="text-muted-foreground truncate max-w-[140px]">{label}</span>
                                      <span className="font-semibold text-foreground ml-1">{(val * 100).toFixed(1)}%</span>
                                    </div>
                                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                                      <motion.div
                                        initial={{ width: 0 }}
                                        animate={{ width: `${val * 100}%` }}
                                        transition={{ duration: 0.6, ease: "easeOut" }}
                                        className="h-full rounded-full"
                                        style={{ background: PREDICTION_COLORS[label] ?? "#94a3b8" }}
                                      />
                                    </div>
                                  </div>
                                ))}
                            </div>
                          ) : (
                            <div className="rounded-xl bg-muted/40 p-3">
                              <p className="text-xs font-semibold text-muted-foreground mb-1 flex items-center gap-1.5">
                                <Brain className="h-3.5 w-3.5 text-primary" /> ANALYSE IA
                              </p>
                              <p className="text-xs text-foreground">{patient.prediction ? (AI_NOTES[patient.prediction] ?? "") : "Aucune analyse disponible"}</p>
                            </div>
                          )}

                          {/* Symptômes */}
                          {patient.symptoms?.length ? (
                            <div>
                              <p className="text-xs font-semibold text-muted-foreground mb-1">{repairMojibake("SYMPTÔMES")}</p>
                              <div className="flex flex-wrap gap-1.5">
                                {patient.symptoms.map(s => (
                                  <span key={s} className="px-2 py-0.5 rounded-full bg-muted text-xs text-foreground">{s}</span>
                                ))}
                              </div>
                            </div>
                          ) : null}

                          {/* Historique */}
                          {patient.medicalHistory?.length ? (
                            <div>
                              <p className="text-xs font-semibold text-muted-foreground mb-1">HISTORIQUE SCANS</p>
                              <div className="space-y-1.5 max-h-28 overflow-y-auto pr-1">
                                {[...patient.medicalHistory].reverse().map((h, idx) => (
                                  <div key={idx} className="text-[11px] rounded-lg bg-muted/30 p-2 flex items-start justify-between gap-2">
                                    <div className="flex-1 min-w-0">
                                      <span className="font-medium">{new Date(h.date).toLocaleDateString("fr-FR")}</span>
                                      <span className="text-muted-foreground">{repairMojibake(` — ${h.diagnosis}`)}</span>
                                    </div>
                                    {h.irmImage && (
                                      <img
                                        src={h.irmImage}
                                        alt="IRM historique"
                                        className="h-8 w-8 rounded object-cover border border-border bg-black cursor-zoom-in shrink-0"
                                        onClick={() => setZoomImage({
                                          src: h.irmImage!,
                                          patientName: patient.name,
                                          date: new Date(h.date).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" })
                                        })}
                                      />
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      </div>

                      {/* ── Conseils médicaux IA ─────────────────────────── */}
                      {patient.prediction && (
                        <div className="border-t border-border">
                          <MedicalAdviceWebPanel prediction={patient.prediction} />
                        </div>
                      )}

                      {/* Footer date */}
                      <div className="flex items-center gap-2 text-xs text-muted-foreground px-4 py-2 border-t border-border bg-muted/10">
                        <Calendar className="h-3.5 w-3.5" />
                        <span>Inscrit le {new Date(patient.createdAt).toLocaleDateString("fr-FR")}</span>
                        {patient.lastScanDate && (
                          <>
                            <span className="text-border">•</span>
                            <ScanLine className="h-3.5 w-3.5 text-primary" />
                            <span>Dernier scan : {new Date(patient.lastScanDate).toLocaleDateString("fr-FR")}</span>
                          </>
                        )}
                      </div>
                    </motion.div>
                  )}
                </motion.div>
              ))}
            </div>
          )}
        </motion.div>
      )}

      {/* ── CHARTS TAB ───────────────────────────────────────────────────── */}
      {activeTab === "charts" && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="grid gap-6 lg:grid-cols-2">
          {/* Pie chart */}
          <div className="rounded-2xl border border-border bg-card shadow-card p-5">
            <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
              <Brain className="h-4 w-4 text-primary" /> Distribution des Diagnostics
            </h3>
            {pieData.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-8">{repairMojibake("Aucune donnée")}</p>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={85} innerRadius={48} strokeWidth={2}>
                      {pieData.map((entry) => (
                        <Cell key={entry.name} fill={PREDICTION_COLORS[entry.name] ?? "#94a3b8"} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ borderRadius: "0.75rem", border: "1px solid hsl(214,20%,90%)", fontSize: "0.75rem" }} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex flex-wrap justify-center gap-3 mt-2">
                  {pieData.map((d) => (
                    <div key={d.name} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span className="h-2.5 w-2.5 rounded-full inline-block" style={{ background: PREDICTION_COLORS[d.name] ?? "#94a3b8" }} />
                      {d.name} ({d.value})
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
          {/* Bar chart */}
          <div className="rounded-2xl border border-border bg-card shadow-card p-5">
            <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" /> {repairMojibake("Patients par Médecin")}
            </h3>
            {barData.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-8">{repairMojibake("Aucune donnée")}</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={barData} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(214,20%,90%)" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip contentStyle={{ borderRadius: "0.75rem", border: "1px solid hsl(214,20%,90%)", fontSize: "0.75rem" }} />
                  <Legend wrapperStyle={{ fontSize: "0.7rem" }} />
                  <Bar dataKey="patients" name="Patients" fill="hsl(221,83%,53%)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </motion.div>
      )}

      {activeTab === "assistant" && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <MedicalChatbotPanel
            title="Assistant clinique Alzheimer"
            extraSuggestions={reportAssistantSuggestions}
          />

          <div className="space-y-4">
            <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
              <h3 className="text-sm font-semibold text-foreground mb-3">Fonctions rapides</h3>
              <div className="space-y-3 text-sm">
                <div className="rounded-xl bg-muted/40 p-3">
                  <p className="text-xs text-muted-foreground mb-1">Medecin selectionne</p>
                  <p className="font-semibold text-foreground">{selectedDoctor?.username ?? "Aucun"}</p>
                </div>
                <div className="rounded-xl bg-muted/40 p-3">
                  <p className="text-xs text-muted-foreground mb-1">Patients suivis</p>
                  <p className="font-semibold text-foreground">{patients.length}</p>
                </div>
                <div className="rounded-xl bg-muted/40 p-3">
                  <p className="text-xs text-muted-foreground mb-1">Patients a haut risque</p>
                  <p className="font-semibold text-red-500">
                    {(patients as Patient[]).filter((p) => p.prediction === "Moderate Demented" || p.prediction === "Severe Demented").length}
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-card p-5 shadow-card">
              <h3 className="text-sm font-semibold text-foreground mb-3">Ce que l'assistant peut faire</h3>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>Resumer les symptomes d'Alzheimer.</p>
                <p>Donner des conseils aux aidants et au medecin.</p>
                <p>Proposer des activites, routines et mesures de prevention.</p>
                <p>Signaler les situations d'urgence qui demandent une orientation immediate.</p>
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {/* Footer note */}
      <p className="text-xs text-muted-foreground text-center border-t border-border pt-4">
        {repairMojibake(`DataScoop — Rapports confidentiels à usage médical uniquement. Généré le ${new Date().toLocaleDateString("fr-FR")}.`)}
      </p>

      {/* ── Modal Zoom Image IRM ─────────────────────────────────────────── */}
      {zoomImage && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 bg-slate-950/90 p-3 backdrop-blur-md sm:p-5"
          onClick={() => setZoomImage(null)}
        >
          <motion.div
            initial={{ scale: 0.85, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.85, opacity: 0 }}
            transition={{ type: "spring", damping: 20 }}
            className="relative mx-auto flex h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-[28px] border border-white/10 bg-[#050816] shadow-[0_32px_120px_rgba(15,23,42,0.65)]"
            onClick={e => e.stopPropagation()}
          >
            <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.18),transparent_60%)]" />

            <div className="relative flex flex-col gap-3 border-b border-white/10 bg-white/[0.03] px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-cyan-400/20 bg-cyan-400/10 text-cyan-200">
                  <ScanLine className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-white sm:text-base">{zoomImage.patientName}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-white/60">
                    <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1">
                      IRM du {zoomImage.date}
                    </span>
                    <span className="rounded-full border border-emerald-400/15 bg-emerald-400/10 px-2.5 py-1 text-emerald-200">
                      Visionneuse plein ecran
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex rounded-2xl border border-white/10 bg-black/20 p-1">
                  <button
                    type="button"
                    onClick={() => setZoomViewMode("fit")}
                    className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors ${
                      zoomViewMode === "fit"
                        ? "bg-cyan-400 text-slate-950"
                        : "text-white/70 hover:bg-white/10 hover:text-white"
                    }`}
                  >
                    Ajuster
                  </button>
                  <button
                    type="button"
                    onClick={() => setZoomViewMode("actual")}
                    className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors ${
                      zoomViewMode === "actual"
                        ? "bg-cyan-400 text-slate-950"
                        : "text-white/70 hover:bg-white/10 hover:text-white"
                    }`}
                  >
                    Taille reelle
                  </button>
                </div>

                <button
                  type="button"
                  aria-label="Fermer l'image IRM"
                  title="Fermer"
                  onClick={() => setZoomImage(null)}
                  className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-white/80 transition-colors hover:bg-white/10 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-auto bg-[linear-gradient(180deg,rgba(8,15,32,0.98),rgba(2,6,23,1))] p-3 sm:p-5">
              <div className="flex min-h-full items-center justify-center rounded-[24px] border border-white/8 bg-[radial-gradient(circle_at_top,rgba(148,163,184,0.16),transparent_30%),linear-gradient(180deg,rgba(15,23,42,0.85),rgba(2,6,23,0.96))] p-3 sm:p-6">
                <img
                  src={zoomImage.src}
                  alt={`IRM agrandie — ${zoomImage.patientName}`}
                  className={`rounded-2xl border border-white/10 bg-black shadow-2xl transition-all duration-300 ${
                    zoomViewMode === "fit"
                      ? "h-auto max-h-[calc(92vh-15rem)] w-full object-contain"
                      : "h-auto max-w-none object-none"
                  }`}
                />
              </div>
            </div>

            <div className="flex flex-col gap-2 border-t border-white/10 bg-black/30 px-4 py-3 text-xs text-white/60 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                <p>Mode ajuste pour voir toute l'image, ou taille reelle pour inspecter les details.</p>
              </div>
              <p className="text-white/45">Appuie sur Echap pour fermer.</p>
            </div>
          </motion.div>
        </motion.div>
      )}
      </div>
    </div>
  );
};

export default Reports;


