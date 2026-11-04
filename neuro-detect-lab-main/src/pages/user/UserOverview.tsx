import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Activity,
  ScanLine,
  ShieldCheck,
  AlertTriangle,
  Loader2,
  CalendarClock,
  HeartPulse,
  Brain,
  NotebookPen,
  Moon,
  Smile,
  TimerReset,
  Target,
  CheckCircle2,
  Users,
  HandHeart,
  BellRing,
  BellPlus,
  ExternalLink,
  Phone,
  Plus,
  SquareCheckBig,
  Trash2,
  UserCircle2,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createAssistantReminder,
  createPatientJournalEntry,
  createFamilyMember,
  deleteAssistantReminder,
  deleteFamilyMember,
  getHistory,
  getPatientAssistantData,
  getPatientAppointments,
  getPatientJournalEntries,
  updateAppointmentStatus,
  updateAssistantReminder,
  updatePatientAssistantProfile,
  type Appointment,
  type JournalEntry,
} from "@/lib/api";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import EmptyState from "@/components/ui/empty-state";

interface ScanRecord {
  id: string;
  patientId?: string;
  date: string;
  prediction: string;
  probabilities: Record<string, number>;
  heatmap_url: string;
  explanation: string;
  createdAt?: string;
  bestModel?: string | null;
  status?: "pending_review" | "reviewed";   // patient view: diagnosis only after the doctor's review
  reviewedAt?: string | null;
  allModels?: Record<string, unknown>;
  rankedModels?: string[];
  totalModels?: number;
  source?: string;
}

type SymptomJournalEntry = JournalEntry;

interface FamilyMember {
  id: string;
  name: string;
  relation: string;
  phone: string;
  notes: string;
  imageUrl: string;
}

interface AssistantTask {
  id: string;
  title: string;
  time: string;
  details: string;
  done: boolean;
  lastNotifiedOn?: string;
}

interface PatientAssistantProfile {
  patientName: string;
  age: string;
  diagnosis: string;
  emergencyContact: string;
  emergencyPhone: string;
  dailyNotes: string;
}

type ReminderAudioApi = {
  currentTime: number;
  createGain: () => GainNode;
  createOscillator: () => OscillatorNode;
  destination: AudioDestinationNode;
  resume?: () => Promise<void>;
  state?: string;
};

const articleCardThemes = [
  { start: "#eff6ff", end: "#dbeafe", accent: "#2563eb", pill: "#bfdbfe" },
  { start: "#ecfdf5", end: "#d1fae5", accent: "#059669", pill: "#a7f3d0" },
  { start: "#fff7ed", end: "#ffedd5", accent: "#ea580c", pill: "#fed7aa" },
];

const createArticleImage = (title: string, index: number) => {
  const theme = articleCardThemes[index % articleCardThemes.length];
  const safeTitle = title
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .slice(0, 28);

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="320" height="240" viewBox="0 0 320 240">
      <defs>
        <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${theme.start}" />
          <stop offset="100%" stop-color="${theme.end}" />
        </linearGradient>
      </defs>
      <rect width="320" height="240" rx="28" fill="url(#g)" />
      <circle cx="248" cy="72" r="38" fill="${theme.pill}" />
      <circle cx="248" cy="72" r="18" fill="${theme.accent}" opacity="0.28" />
      <rect x="28" y="36" width="96" height="24" rx="12" fill="${theme.pill}" />
      <text x="42" y="52" font-family="Arial, sans-serif" font-size="12" font-weight="700" fill="${theme.accent}">ALZHEIMER</text>
      <text x="28" y="120" font-family="Arial, sans-serif" font-size="28" font-weight="700" fill="${theme.accent}">Science</text>
      <text x="28" y="150" font-family="Arial, sans-serif" font-size="18" font-weight="600" fill="#0f172a">${safeTitle}</text>
      <rect x="28" y="184" width="150" height="12" rx="6" fill="${theme.pill}" />
      <rect x="28" y="204" width="110" height="12" rx="6" fill="${theme.pill}" opacity="0.8" />
    </svg>
  `.trim();

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
};

const DEFAULT_FAMILY_MEMBERS: FamilyMember[] = [
  {
    id: "family-1",
    name: "Oumaima",
    relation: "Fille / aidante",
    phone: "",
    notes: "Personne de confiance pour le suivi quotidien.",
    imageUrl: createArticleImage("Famille Oumaima", 0),
  },
  {
    id: "family-2",
    name: "Yawmian",
    relation: "Proche famille",
    phone: "",
    notes: "Peut aider pour les rappels et l'accompagnement.",
    imageUrl: createArticleImage("Famille Yawmian", 1),
  },
];

const DEFAULT_ASSISTANT_TASKS: AssistantTask[] = [
  {
    id: "task-1",
    title: "Verifier les medicaments",
    time: "08:00",
    details: "Confirmer la prise du traitement du matin.",
    done: false,
  },
  {
    id: "task-2",
    title: "Appeler un proche",
    time: "13:00",
    details: "Prendre des nouvelles avec un membre de la famille.",
    done: false,
  },
  {
    id: "task-3",
    title: "Faire le point du soir",
    time: "19:00",
    details: "Noter les oublis, l'humeur et le sommeil dans le journal.",
    done: false,
  },
];

const riskConfig: Record<string, { color: string; bg: string; icon: React.ReactNode; summary: string }> = {
  Low: {
    color: "text-severity-healthy",
    bg: "bg-severity-healthy/10",
    icon: <ShieldCheck className="h-5 w-5" />,
    summary: "Current scan suggests a reassuring situation with lower immediate risk.",
  },
  Medium: {
    color: "text-severity-mild",
    bg: "bg-severity-mild/10",
    icon: <Activity className="h-5 w-5" />,
    summary: "A follow-up and close monitoring would help track any progression early.",
  },
  Unknown: {
    color: "text-muted-foreground",
    bg: "bg-muted/40",
    icon: <Activity className="h-5 w-5" />,
    summary: "No analysed scan yet: no risk level can be estimated.",
  },
  High: {
    color: "text-severity-severe",
    bg: "bg-severity-severe/10",
    icon: <AlertTriangle className="h-5 w-5" />,
    summary: "This result deserves timely medical attention and a discussion with your doctor.",
  },
};

const panelClass =
  "rounded-[28px] border border-border/70 bg-card/85 p-6 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur-sm";

const innerCardClass =
  "rounded-[24px] border border-border/60 bg-background/80 p-4 shadow-[0_12px_36px_rgba(15,23,42,0.05)]";

const createClientId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

const getRiskLevel = (prediction: string): string => {
  switch (prediction) {
    case "Non Demented":
    case "Very Mild Demented":
      return "Low";
    case "Mild Demented":
      return "Medium";
    case "Moderate Demented":
    case "Severe Demented":
      return "High";
    default:
      return "Unknown"; // unknown class -> no invented risk
  }
};

const getTopProbability = (probabilities?: Record<string, number>) => {
  if (!probabilities) return null;
  return Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0] ?? null;
};

const getDynamicIrmSummary = (prediction?: string | null, explanation?: string | null) => {
  if (explanation?.trim()) {
    return explanation.trim();
  }

  switch (prediction) {
    case "Non Demented":
      return "La derniere IRM ne montre pas d'anomalie majeure selon l'analyse IA actuelle.";
    case "Very Mild Demented":
      return "La derniere IRM suggere des signes tres legers a surveiller regulierement.";
    case "Mild Demented":
      return "La derniere IRM indique un niveau leger qui justifie un suivi clinique plus attentif.";
    case "Moderate Demented":
      return "La derniere IRM montre des signes plus marques et demande une prise en charge rapprochee.";
    case "Severe Demented":
      return "La derniere IRM indique une situation avancee qui necessite une attention medicale renforcee.";
    default:
      return "Le resume se mettra a jour des qu'une nouvelle analyse IRM sera disponible.";
  }
};

const getDynamicRiskLabel = (prediction?: string | null) => {
  switch (prediction) {
    case "Non Demented":
      return "Stabilite rassurante";
    case "Very Mild Demented":
      return "Surveillance precoce";
    case "Mild Demented":
      return "Suivi renforce";
    case "Moderate Demented":
      return "Attention elevee";
    case "Severe Demented":
      return "Priorite clinique";
    default:
      return "En attente d'analyse";
  }
};

const getSuggestedExercises = (prediction?: string | null) => {
  switch (prediction) {
    case "Moderate Demented":
    case "Severe Demented":
      return [
        {
          title: "Orientation quotidienne",
          duration: "5-7 min",
          goal: "Revoir la date, le lieu, les proches et les moments de la journee.",
        },
        {
          title: "Memoire guidee",
          duration: "8 min",
          goal: "Associer 3 objets visibles a 3 mots simples et les redire apres 2 minutes.",
        },
        {
          title: "Attention calme",
          duration: "5 min",
          goal: "Repeter une petite suite de chiffres ou de couleurs sans se presser.",
        },
      ];
    case "Mild Demented":
      return [
        {
          title: "Memoire a court terme",
          duration: "8-10 min",
          goal: "Memoriser une liste de 4 mots puis la retrouver apres une pause courte.",
        },
        {
          title: "Logique simple",
          duration: "10 min",
          goal: "Classer des objets ou des images par categorie et expliquer le choix.",
        },
        {
          title: "Attention selective",
          duration: "6 min",
          goal: "Reperer une lettre ou un symbole cible dans une petite grille.",
        },
      ];
    case "Very Mild Demented":
      return [
        {
          title: "Memoire active",
          duration: "10 min",
          goal: "Retenir 5 mots, puis les redonner dans l'ordre ou par theme.",
        },
        {
          title: "Orientation rapide",
          duration: "5 min",
          goal: "Nommer la date, les activites prevues et les personnes a contacter aujourd'hui.",
        },
        {
          title: "Mini logique",
          duration: "8 min",
          goal: "Resoudre de petites suites ou associations d'images.",
        },
      ];
    case "Non Demented":
    default:
      return [
        {
          title: "Memoire preventive",
          duration: "10 min",
          goal: "Retenir et rappeler une courte liste de mots ou d'objets.",
        },
        {
          title: "Concentration",
          duration: "7 min",
          goal: "Lire une phrase puis retrouver un detail precis sans aide.",
        },
        {
          title: "Logique legere",
          duration: "8-10 min",
          goal: "Faire une petite suite logique ou un tri de cartes mentales.",
        },
      ];
  }
};

const getCaregiverAdvice = (prediction?: string | null) => {
  switch (prediction) {
    case "Moderate Demented":
    case "Severe Demented":
      return {
        tone: "Accompagnement renforce",
        dailyHelp: [
          "Mettre en place une routine fixe pour le lever, les repas, les medicaments et le coucher.",
          "Donner une consigne a la fois avec des phrases courtes et un ton calme.",
          "Verifier chaque jour l'hydratation, l'alimentation et la securite dans la maison.",
        ],
        watchFor: [
          "Episodes de confusion plus frequents ou agitation inhabituelle.",
          "Difficultes pour se deplacer seul, se laver ou prendre les repas.",
          "Changement brusque du sommeil, de l'humeur ou du comportement.",
        ],
        communication: "Rassurer souvent, eviter de contredire frontalement et reformuler doucement.",
      };
    case "Mild Demented":
      return {
        tone: "Accompagnement attentif",
        dailyHelp: [
          "Aider a organiser la journee avec un agenda visible et des rappels simples.",
          "Encourager les activites connues sans faire a la place du patient trop vite.",
          "Verifier les rendez-vous, les traitements et les petites taches importantes.",
        ],
        watchFor: [
          "Oublis plus frequents dans les taches habituelles.",
          "Perte de repere dans le temps ou hesitation dans les decisions simples.",
          "Fatigue mentale plus nette en fin de journee.",
        ],
        communication: "Parler lentement, laisser du temps pour repondre et valoriser les efforts.",
      };
    case "Very Mild Demented":
      return {
        tone: "Surveillance precoce",
        dailyHelp: [
          "Conserver des habitudes stables et proposer une aide discrete si besoin.",
          "Utiliser des pense-betes pour les rendez-vous et les activites importantes.",
          "Encourager le sommeil, la marche et les moments de stimulation cognitive.",
        ],
        watchFor: [
          "Petits oublis repetes ou besoin inhabituel de rappels.",
          "Difficultes legeres de concentration ou de planification.",
          "Stress accru devant des taches nouvelles ou complexes.",
        ],
        communication: "Rester encourageant, sans dramatiser, et noter calmement les changements observes.",
      };
    case "Non Demented":
    default:
      return {
        tone: "Prevention et soutien",
        dailyHelp: [
          "Maintenir une hygiene de vie reguliere et des activites sociales.",
          "Encourager les exercices cognitifs et le suivi medical recommande.",
          "Garder les anciens resultats IRM pour comparer l'evolution dans le temps.",
        ],
        watchFor: [
          "Apparition d'oublis inhabituels ou de fatigue cognitive persistante.",
          "Changements progressifs d'humeur, de sommeil ou d'organisation.",
          "Plaintes repetees sur la memoire ou l'attention au quotidien.",
        ],
        communication: "Adopter une presence rassurante et observer sans surinterpretrer.",
      };
  }
};

const GUIDE_LINKS: Record<string, Array<{ label: string; url: string }>> = {
  "Non Demented": [
    { label: "Sante cognitive et prevention (NIA)", url: "https://www.nia.nih.gov/health/brain-health/cognitive-health-and-older-adults" },
    { label: "Comprendre les stades (Alzheimer's Association)", url: "https://www.alz.org/alzheimers-dementia/stages" },
  ],
  "Very Mild Demented": [
    { label: "Vivre avec un stade precoce (Alzheimer's Association)", url: "https://www.alz.org/help-support/caregiving/stages-behaviors/early-stage" },
    { label: "Sante cognitive et habitudes utiles (NIA)", url: "https://www.nia.nih.gov/health/brain-health/cognitive-health-and-older-adults" },
  ],
  "Mild Demented": [
    { label: "Aide au stade precoce a modere (Alzheimer's Association)", url: "https://www.alz.org/help-support/caregiving/stages-behaviors/early-stage" },
    { label: "Ce qui se passe dans le cerveau (NIA)", url: "https://www.nia.nih.gov/health/alzheimers-causes-and-risk-factors/what-happens-brain-alzheimers-disease" },
  ],
  "Moderate Demented": [
    { label: "Aide au stade moyen (Alzheimer's Association)", url: "https://www.alz.org/help-support/caregiving/stages-behaviors/middle-stage" },
    { label: "Comprendre la maladie d'Alzheimer (NIA)", url: "https://www.nia.nih.gov/health/alzheimers-and-dementia/alzheimers-disease-fact-sheet" },
  ],
  "Severe Demented": [
    { label: "Aide au stade avance (Alzheimer's Association)", url: "https://www.alz.org/help-support/caregiving/stages-behaviors/late-stage" },
    { label: "Ressources officielles Alzheimer.gov", url: "https://www.alzheimers.gov/" },
  ],
};

const UserOverview = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [journalForm, setJournalForm] = useState({
    forgetfulness: "Faible",
    fatigue: "Faible",
    confusion: "Aucune",
    sleep: "Bon",
    mood: "Stable",
    note: "",
  });
  const [familyMembers, setFamilyMembers] = useState<FamilyMember[]>([]);
  const [familyForm, setFamilyForm] = useState({
    name: "",
    relation: "",
    phone: "",
    notes: "",
    imageUrl: "",
  });
  const [assistantTasks, setAssistantTasks] = useState<AssistantTask[]>([]);
  const [taskForm, setTaskForm] = useState({
    title: "",
    time: "09:00",
    details: "",
  });
  const [assistantProfile, setAssistantProfile] = useState<PatientAssistantProfile>({
    patientName: user?.name ?? "",
    age: "",
    diagnosis: "Suivi cognitif Alzheimer",
    emergencyContact: "",
    emergencyPhone: "",
    dailyNotes: "",
  });
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | "unsupported">(
    typeof window !== "undefined" && "Notification" in window ? Notification.permission : "unsupported"
  );
  const notifiedReminderKeysRef = useRef<Set<string>>(new Set());
  const reminderAudioRef = useRef<ReminderAudioApi | null>(null);
  const notificationsRequireSecureContext =
    typeof window !== "undefined" &&
    "Notification" in window &&
    !window.isSecureContext &&
    !["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
  const notificationStatusLabel =
    notificationsRequireSecureContext
      ? "Alerte dans l'application"
      : notificationPermission === "granted"
        ? "Actif"
        : notificationPermission === "denied"
          ? "Refuse"
          : notificationPermission === "unsupported"
            ? "Non supporte"
            : "A activer";
  const notificationHelpText = notificationsRequireSecureContext
    ? "Les notifications du navigateur ne sont pas disponibles sur cette adresse IP en HTTP. Les rappels s'afficheront directement dans l'application a l'heure prevue."
    : notificationPermission === "denied"
      ? "Les notifications du navigateur ont ete refusees. Les rappels continueront a apparaitre dans l'application."
      : notificationPermission === "unsupported"
        ? "Ce navigateur ne prend pas en charge les notifications systeme. Les rappels apparaitront dans l'application."
        : "Quand l'heure du rappel arrive, une notification et un son d'alerte peuvent se declencher automatiquement.";

  const { data: scans = [], isLoading, error } = useQuery({
    queryKey: ["history", user?.token],
    queryFn: () => getHistory(user?.token || ""),
    enabled: !!user?.token,
    refetchInterval: 5000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
  });

  if (error) {
    toast.error("Failed to load scan data");
  }

  const typedScans = scans as ScanRecord[];
  const sortedScans = [...typedScans].sort(
    (a, b) => new Date(b.date || b.createdAt || "").getTime() - new Date(a.date || a.createdAt || "").getTime()
  );
  const lastScan = sortedScans[0] ?? null;
  // Risk only from a diagnosis VALIDATED by the doctor (a pending scan or no scan -> "Unknown", never invented)
  const lastReviewed = sortedScans.find((s) => s.status === "reviewed") ?? null;
  const risk = lastReviewed ? getRiskLevel(lastReviewed.prediction) : "Unknown";
  const cfg = riskConfig[risk];
  const topProbability = getTopProbability(lastScan?.probabilities);
  // Advice, guides and journal follow the last diagnosis VALIDATED by the doctor, never a pending scan
  const advicePrediction = lastReviewed?.prediction;
  const dynamicIrmSummary = getDynamicIrmSummary(advicePrediction, lastReviewed?.explanation);
  const dynamicRiskLabel = getDynamicRiskLabel(advicePrediction);
  const journalQueryKey = useMemo(() => ["patient-journal-preview", user?.token], [user?.token]);
  const suggestedExercises = getSuggestedExercises(advicePrediction);
  const caregiverAdvice = getCaregiverAdvice(advicePrediction);
  const guideLinks = GUIDE_LINKS[advicePrediction ?? ""] ?? GUIDE_LINKS["Non Demented"];
  const quickSummaryItems = [
    {
      label: "Derniere prediction",
      value: lastScan?.prediction ?? "Aucun scan",
      hint: lastScan ? "Resultat du dernier scan IRM analyse" : "Charge un scan pour voir un resume clinique",
      icon: <Brain className="h-4 w-4 text-primary" />,
    },
    {
      label: "Date du dernier scan",
      value: lastScan ? new Date(lastScan.date || lastScan.createdAt || "").toLocaleDateString("fr-FR") : "Indisponible",
      hint: lastScan ? "Date associee a l'IRM la plus recente" : "Aucune date disponible pour le moment",
      icon: <CalendarClock className="h-4 w-4 text-primary" />,
    },
    {
      label: "Statut",
      value: !lastScan ? "Aucune IRM" : lastScan.status === "reviewed" ? "Validé" : "En attente",
      hint: lastScan?.status === "reviewed" ? "Diagnostic validé par votre médecin" : "Votre médecin doit encore examiner l'IRM",
      icon: <Target className="h-4 w-4 text-primary" />,
    },
    {
      label: "Niveau de risque",
      value: risk,
      hint: dynamicRiskLabel,
      icon: <HeartPulse className={`h-4 w-4 ${cfg.color}`} />,
    },
  ];
  const { data: journalData } = useQuery({
    queryKey: journalQueryKey,
    queryFn: () => getPatientJournalEntries(user?.token || ""),
    enabled: !!user?.token,
  });

  const journalEntries = (journalData?.entries || []) as SymptomJournalEntry[];

  const { data: assistantData } = useQuery({
    queryKey: ["patient-assistant", user?.token],
    queryFn: () => getPatientAssistantData(user?.token || ""),
    enabled: !!user?.token,
  });

  useEffect(() => {
    if (!assistantData) return;

    setFamilyMembers(assistantData.familyMembers || []);
    setAssistantTasks(assistantData.reminders || []);
    setAssistantProfile({
      patientName: assistantData.profile?.patientName || user?.name || "",
      age: assistantData.profile?.age || "",
      diagnosis: assistantData.profile?.diagnosis || "Suivi cognitif Alzheimer",
      emergencyContact: assistantData.profile?.emergencyContact || "",
      emergencyPhone: assistantData.profile?.emergencyPhone || "",
      dailyNotes: assistantData.profile?.dailyNotes || "",
    });
  }, [assistantData, user?.name]);

  const { data: appointments = [], refetch: refetchAppointments } = useQuery({
    queryKey: ["patient-appointments", user?.token],
    queryFn: () => getPatientAppointments(user?.token || ""),
    enabled: !!user?.token,
  });

  const pendingAssistantTasks = assistantTasks.filter((task) => !task.done);

  const refreshAssistantData = async () => {
    await queryClient.invalidateQueries({ queryKey: ["patient-assistant", user?.token] });
  };

  const updateProfileMutation = useMutation({
    mutationFn: (profile: PatientAssistantProfile) => updatePatientAssistantProfile(profile, user?.token || ""),
    onSuccess: async () => {
      await refreshAssistantData();
      toast.success("Profil patient enregistre");
    },
    onError: () => toast.error("Impossible d'enregistrer le profil patient"),
  });

  const addFamilyMemberMutation = useMutation({
    mutationFn: (payload: Omit<FamilyMember, "id">) => createFamilyMember(payload, user?.token || ""),
    onSuccess: async () => {
      await refreshAssistantData();
      toast.success("Membre de la famille ajoute");
    },
    onError: () => toast.error("Impossible d'ajouter le proche"),
  });

  const deleteFamilyMemberMutation = useMutation({
    mutationFn: (memberId: string) => deleteFamilyMember(memberId, user?.token || ""),
    onSuccess: refreshAssistantData,
    onError: () => toast.error("Impossible de supprimer le proche"),
  });

  const addReminderMutation = useMutation({
    mutationFn: (payload: { title: string; time: string; details: string }) =>
      createAssistantReminder(payload, user?.token || ""),
    onSuccess: async () => {
      await refreshAssistantData();
      toast.success("Rappel ajoute dans la liste quotidienne");
    },
    onError: () => toast.error("Impossible d'ajouter le reminder"),
  });

  const updateReminderMutation = useMutation({
    mutationFn: ({ reminderId, payload }: { reminderId: string; payload: Partial<AssistantTask> }) =>
      updateAssistantReminder(reminderId, payload, user?.token || ""),
    onSuccess: refreshAssistantData,
    onError: () => toast.error("Impossible de mettre a jour le reminder"),
  });

  const deleteReminderMutation = useMutation({
    mutationFn: (reminderId: string) => deleteAssistantReminder(reminderId, user?.token || ""),
    onSuccess: refreshAssistantData,
    onError: () => toast.error("Impossible de supprimer le reminder"),
  });

  const createJournalEntryMutation = useMutation({
    mutationFn: (payload: Omit<JournalEntry, "id" | "createdAt">) =>
      createPatientJournalEntry(payload, user?.token || ""),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: journalQueryKey });
      setJournalForm({
        forgetfulness: "Faible",
        fatigue: "Faible",
        confusion: "Aucune",
        sleep: "Bon",
        mood: "Stable",
        note: "",
      });
      toast.success("Journal de symptomes enregistre");
    },
  });

  const saveJournalEntry = () => {
    const entry: Omit<JournalEntry, "id" | "createdAt"> = {
      scanPrediction: advicePrediction ?? "Aucun diagnostic validé",
      memory: journalForm.forgetfulness,
      autonomy: "Bonne",
      riskLevel: risk,
      forgetfulness: journalForm.forgetfulness,
      fatigue: journalForm.fatigue,
      confusion: journalForm.confusion,
      sleep: journalForm.sleep,
      mood: journalForm.mood,
      note: journalForm.note.trim(),
    };
    createJournalEntryMutation.mutate(entry);
  };

  const handleAppointmentStatus = async (
    appointmentId: string,
    status: "confirmed" | "cancelled"
  ) => {
    try {
      await updateAppointmentStatus(appointmentId, { status }, user?.token || "");
      await refetchAppointments();
      toast.success(status === "confirmed" ? "Rendez-vous confirme" : "Rendez-vous annule");
    } catch {
      toast.error("Impossible de mettre a jour le statut du rendez-vous");
    }
  };

  const handleFamilyImageUpload = (file: File | null) => {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setFamilyForm((current) => ({ ...current, imageUrl: reader.result as string }));
      }
    };
    reader.readAsDataURL(file);
  };

  const addFamilyMember = () => {
    if (!familyForm.name.trim() || !familyForm.relation.trim()) {
      toast.error("Ajoute au minimum le nom et le lien de famille");
      return;
    }

    const nextMember: FamilyMember = {
      id: createClientId(),
      name: familyForm.name.trim(),
      relation: familyForm.relation.trim(),
      phone: familyForm.phone.trim(),
      notes: familyForm.notes.trim(),
      imageUrl: familyForm.imageUrl || createArticleImage(familyForm.name.trim(), familyMembers.length),
    };

    addFamilyMemberMutation.mutate({
      name: nextMember.name,
      relation: nextMember.relation,
      phone: nextMember.phone,
      notes: nextMember.notes,
      imageUrl: nextMember.imageUrl,
    });
    setFamilyForm({
      name: "",
      relation: "",
      phone: "",
      notes: "",
      imageUrl: "",
    });
  };

  const removeFamilyMember = (memberId: string) => {
    deleteFamilyMemberMutation.mutate(memberId);
  };

  const addAssistantTask = () => {
    if (!taskForm.title.trim()) {
      toast.error("Ajoute un titre pour le rappel");
      return;
    }

    const nextTask: AssistantTask = {
      id: createClientId(),
      title: taskForm.title.trim(),
      time: taskForm.time,
      details: taskForm.details.trim(),
      done: false,
    };

    addReminderMutation.mutate({
      title: nextTask.title,
      time: nextTask.time,
      details: nextTask.details,
    });
    setTaskForm({
      title: "",
      time: "09:00",
      details: "",
    });
  };

  const toggleAssistantTask = (taskId: string) => {
    const task = assistantTasks.find((entry) => entry.id === taskId);
    if (!task) return;
    updateReminderMutation.mutate({
      reminderId: taskId,
      payload: { done: !task.done },
    });
  };

  const removeAssistantTask = (taskId: string) => {
    deleteReminderMutation.mutate(taskId);
  };

  const saveAssistantProfile = () => {
    updateProfileMutation.mutate(assistantProfile);
  };

  const requestReminderPermission = async () => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      toast.error("Les notifications ne sont pas supportees sur ce navigateur");
      return;
    }

    if (notificationsRequireSecureContext) {
      toast.error("Les notifications systeme du navigateur sont bloquees sur cette adresse IP en HTTP. Le rappel apparaitra quand meme dans l'application a l'heure prevue.");
      return;
    }

    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);

    if (permission === "granted") {
      toast.success("Notifications actives pour les rappels du patient");
    } else {
      toast.error("Notifications refusees");
    }
  };

  const getReminderAudio = () => {
    if (typeof window === "undefined") return null;
    if (reminderAudioRef.current) return reminderAudioRef.current;

    const AudioContextCtor =
      window.AudioContext || (window as Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

    if (!AudioContextCtor) {
      return null;
    }

    const context = new AudioContextCtor() as ReminderAudioApi;
    reminderAudioRef.current = context;
    return context;
  };

  const playReminderAlert = async () => {
    const audioContext = getReminderAudio();
    if (!audioContext) return;

    try {
      if (audioContext.state === "suspended" && audioContext.resume) {
        await audioContext.resume();
      }

      const pattern = [
        { frequency: 880, duration: 0.18, delay: 0 },
        { frequency: 660, duration: 0.18, delay: 0.24 },
        { frequency: 990, duration: 0.24, delay: 0.48 },
      ];

      const startAt = audioContext.currentTime + 0.02;

      pattern.forEach(({ frequency, duration, delay }) => {
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        const toneStart = startAt + delay;
        const toneEnd = toneStart + duration;

        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(frequency, toneStart);

        gainNode.gain.setValueAtTime(0.0001, toneStart);
        gainNode.gain.exponentialRampToValueAtTime(0.18, toneStart + 0.02);
        gainNode.gain.exponentialRampToValueAtTime(0.0001, toneEnd);

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        oscillator.start(toneStart);
        oscillator.stop(toneEnd + 0.02);
      });
    } catch {
      // If the browser blocks autoplay audio, we keep the visual reminder only.
    }
  };

  useEffect(() => {
    if (typeof window === "undefined") return;

    const primeReminderAudio = () => {
      const audioContext = getReminderAudio();
      if (audioContext?.state === "suspended" && audioContext.resume) {
        void audioContext.resume();
      }
    };

    window.addEventListener("pointerdown", primeReminderAudio, { once: true });

    return () => {
      window.removeEventListener("pointerdown", primeReminderAudio);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const checkDueReminders = () => {
      const now = new Date();
      const today = now.toISOString().slice(0, 10);
      const currentTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

      assistantTasks.forEach((task) => {
        const reminderKey = `${task.id}:${today}`;
        if (
          task.done ||
          task.lastNotifiedOn === today ||
          task.time > currentTime ||
          notifiedReminderKeysRef.current.has(reminderKey)
        ) {
          return;
        }

        const reminderText = `${task.time} - ${task.title}${task.details ? `: ${task.details}` : ""}`;

        void playReminderAlert();

        if ("Notification" in window && Notification.permission === "granted" && !notificationsRequireSecureContext) {
          new Notification("Rappel quotidien patient", {
            body: reminderText,
          });
        } else {
          toast.info(`Rappel: ${reminderText}`, {
            duration: 12000,
          });
        }

        notifiedReminderKeysRef.current.add(reminderKey);
        updateReminderMutation.mutate({
          reminderId: task.id,
          payload: { lastNotifiedOn: today },
        });
      });
    };

    checkDueReminders();
    const intervalId = window.setInterval(checkDueReminders, 30_000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [assistantTasks, notificationsRequireSecureContext, updateReminderMutation]);

  return (
    <div className="min-h-full bg-[radial-gradient(circle_at_top_left,rgba(37,99,235,0.18),transparent_28%),radial-gradient(circle_at_top_right,rgba(5,150,105,0.14),transparent_24%),linear-gradient(180deg,#f8fbff_0%,#f7fafc_42%,#eef6ff_100%)] px-4 py-5 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6 pb-10">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-[32px] border border-white/60 bg-[linear-gradient(135deg,rgba(255,255,255,0.96),rgba(239,246,255,0.92))] p-6 shadow-[0_30px_100px_rgba(37,99,235,0.12)] backdrop-blur-sm">
        <div className="absolute -right-10 -top-12 h-40 w-40 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute bottom-0 right-24 h-24 w-24 rounded-full bg-emerald-400/10 blur-2xl" />
        <h1 className="font-display text-2xl font-bold text-foreground">
          Welcome, {user?.name?.split(" ")[0]} 👋
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Here's a summary of your brain health monitoring.</p>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-primary/10 bg-white/80 p-4 shadow-[0_10px_30px_rgba(37,99,235,0.08)]">
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Dernier scan</p>
            <p className="mt-2 text-lg font-semibold text-foreground">{lastScan?.prediction ?? "Aucun scan"}</p>
          </div>
          <div className="rounded-2xl border border-emerald-100 bg-white/80 p-4 shadow-[0_10px_30px_rgba(16,185,129,0.08)]">
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Risque</p>
            <p className={`mt-2 text-lg font-semibold ${cfg.color}`}>{risk}</p>
          </div>
          <div className="rounded-2xl border border-amber-100 bg-white/80 p-4 shadow-[0_10px_30px_rgba(245,158,11,0.08)]">
            <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Articles</p>
            <p className="mt-2 text-lg font-semibold text-foreground">Learn more</p>
          </div>
        </div>
      </motion.div>

      {isLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}
            className="relative overflow-hidden rounded-[24px] border border-primary/10 bg-white/90 p-5 shadow-[0_16px_40px_rgba(37,99,235,0.08)]">
            <div className="absolute inset-x-0 top-0 h-1 bg-primary/70" />
            <div className="flex items-center gap-3 mb-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10">
                <ScanLine className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Last Scan Result</p>
                <p className="text-base font-semibold text-foreground">
                  {lastScan ? lastScan.prediction : "No scans yet"}
                </p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              {lastScan ? new Date(lastScan.date || lastScan.createdAt).toLocaleDateString() : "Upload your first scan"}
            </p>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
            className="relative overflow-hidden rounded-[24px] border border-emerald-100 bg-white/90 p-5 shadow-[0_16px_40px_rgba(16,185,129,0.08)]">
            <div className="absolute inset-x-0 top-0 h-1 bg-emerald-500/70" />
            <div className="flex items-center gap-3 mb-3">
              <div className={`flex h-11 w-11 items-center justify-center rounded-2xl ${cfg.bg}`}>
                <div className={cfg.color}>{cfg.icon}</div>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Risk Level</p>
                <p className={`text-base font-semibold ${cfg.color}`}>{risk}</p>
              </div>
            </div>
            <p className="text-xs leading-5 text-muted-foreground">{cfg.summary}</p>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
            className="relative overflow-hidden rounded-[24px] border border-amber-100 bg-white/90 p-5 shadow-[0_16px_40px_rgba(245,158,11,0.08)]">
            <div className="absolute inset-x-0 top-0 h-1 bg-amber-500/70" />
            <div className="flex items-center gap-3 mb-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-accent/10">
                <Activity className="h-5 w-5 text-accent" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total Scans</p>
                <p className="text-base font-semibold text-foreground">{scans.length}</p>
              </div>
            </div>
            <p className="text-xs leading-5 text-muted-foreground">Chaque nouveau resultat enrichit le suivi dans le temps.</p>
          </motion.div>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        <Button asChild className="h-auto justify-between rounded-[24px] border border-primary/20 bg-[linear-gradient(135deg,hsl(var(--primary)),hsl(217,91%,60%))] px-5 py-4 text-left text-primary-foreground shadow-[0_18px_40px_rgba(37,99,235,0.24)]">
          <Link to="/patient/upload">
            <span>
              <span className="block text-xs uppercase tracking-[0.18em] text-primary-foreground/80">Action rapide</span>
              <span className="mt-1 block text-base font-semibold">Televerser une nouvelle IRM</span>
            </span>
            <ScanLine className="h-5 w-5" />
          </Link>
        </Button>
        <Button asChild variant="outline" className="h-auto justify-between rounded-[24px] border border-border/70 bg-white/80 px-5 py-4 text-left shadow-[0_12px_30px_rgba(15,23,42,0.05)]">
          <Link to="/patient/history">
            <span>
              <span className="block text-xs uppercase tracking-[0.18em] text-muted-foreground">Historique</span>
              <span className="mt-1 block text-base font-semibold text-foreground">Consulter les analyses precedentes</span>
            </span>
            <CalendarClock className="h-5 w-5 text-primary" />
          </Link>
        </Button>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className={panelClass}
        >
          <div className="mb-5 flex items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-xl font-bold text-foreground">Resume rapide</h2>
              <p className="text-sm text-muted-foreground">
                Bloc dynamique base sur la derniere IRM et son analyse IA.
              </p>
            </div>
            <div className={`rounded-full px-3 py-1 text-xs font-semibold ${cfg.bg} ${cfg.color}`}>
              Risque {risk}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {quickSummaryItems.map((item) => (
              <div key={item.label} className={innerCardClass}>
                <div className="mb-2 flex items-center gap-2">
                  {item.icon}
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">{item.label}</p>
                </div>
                <p className="text-base font-semibold text-foreground">{item.value}</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.hint}</p>
              </div>
            ))}
          </div>

          <div className="mt-4 space-y-3">
            <div className="rounded-2xl border border-primary/15 bg-primary/5 p-4">
              <div className="flex items-center gap-2 text-primary">
                <CheckCircle2 className="h-4 w-4" />
                <p className="text-sm font-semibold">Synthese de la derniere analyse IRM</p>
              </div>
              <p className="mt-2 text-sm leading-6 text-foreground">{dynamicIrmSummary}</p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className={innerCardClass}>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Diagnostic du médecin</p>
                <p className="mt-2 text-sm font-semibold text-foreground">
                  {lastScan?.status === "reviewed" ? lastScan.prediction : "En attente"}
                </p>
              </div>

              <div className={innerCardClass}>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Statut</p>
                <p className="mt-2 text-sm font-semibold text-foreground">
                  {!lastScan ? "Aucune IRM" : lastScan.status === "reviewed" ? "Validé" : "En attente de validation"}
                </p>
              </div>

              <div className={innerCardClass}>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Validé le</p>
                <p className="mt-2 text-sm font-semibold text-foreground">
                  {lastScan?.reviewedAt ? new Date(lastScan.reviewedAt).toLocaleDateString("fr-FR") : "—"}
                </p>
              </div>
            </div>
          </div>
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="rounded-3xl border border-border bg-card p-6 shadow-card"
        >
          <div className="mb-5 flex items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-xl font-bold text-foreground">Exercices cognitifs</h2>
              <p className="text-sm text-muted-foreground">
                Activites suggerees selon le resultat de la derniere IRM.
              </p>
            </div>
            <div className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
              {lastScan?.prediction ?? "Sans IRM recente"}
            </div>
          </div>

          <div className="space-y-3">
            {suggestedExercises.map((exercise) => (
              <div key={exercise.title} className="rounded-2xl border border-border/70 bg-background/70 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-foreground">{exercise.title}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{exercise.goal}</p>
                  </div>
                  <div className="shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
                    {exercise.duration}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 rounded-2xl border border-border/70 bg-muted/30 p-4 text-sm text-muted-foreground">
            Ces exercices restent des propositions de stimulation cognitive. Ils suivent le niveau suggere par l'IRM,
            mais ne remplacent pas l'avis du medecin.
          </div>
        </motion.section>
      </div>

      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.22 }}
        className={panelClass}
      >
        <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-display text-xl font-bold text-foreground">Mes rendez-vous planifies</h2>
            <p className="text-sm text-muted-foreground">
              Consultations programmees par l'equipe medicale avec date, heure, duree et objectif clinique.
            </p>
          </div>
          <div className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
            {appointments.length} rendez-vous actif{appointments.length > 1 ? "s" : ""}
          </div>
        </div>

        {appointments.length === 0 ? (
          <EmptyState
            title="Aucun rendez-vous programme"
            description="Les prochaines consultations planifiees par votre medecin apparaitront ici avec l'heure, la duree et l'objectif clinique."
          />
        ) : (
          <div className="grid gap-4 lg:grid-cols-3">
            {appointments.slice(0, 3).map((appointment: Appointment) => (
              <div key={appointment._id} className="rounded-2xl border border-border/70 bg-background/70 p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-foreground">{appointment.slotLabel}</p>
                  <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
                    {appointment.durationMinutes} min
                  </span>
                </div>
                <p className="mt-2 text-xs font-medium uppercase tracking-[0.18em] text-primary/80">
                  {appointment.scheduledDate} a {appointment.startTime}
                </p>
                <p className="mt-3 text-sm font-medium text-foreground">{appointment.title}</p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{appointment.description}</p>
                <div className="mt-4 rounded-xl border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
                  Programme par {appointment.doctor.username} • {appointment.timingLabel} • Fin prevue a {appointment.endTime}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => handleAppointmentStatus(appointment._id, "confirmed")}
                    disabled={appointment.status === "confirmed"}
                  >
                    Confirmer
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => handleAppointmentStatus(appointment._id, "cancelled")}
                    disabled={appointment.status === "cancelled"}
                  >
                    Annuler
                  </Button>
                  <span className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
                    Statut: {appointment.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </motion.section>

      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.24 }}
        className={panelClass}
      >
        <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Assistant quotidien</p>
            <h2 className="mt-2 font-display text-xl font-bold text-foreground">Profil patient, famille et rappels</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Un espace simple pour le malade et la famille: informations utiles, proches aidants, to do list et reminders.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
              {familyMembers.length} proche{familyMembers.length > 1 ? "s" : ""}
            </span>
            <span className="rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground">
              {pendingAssistantTasks.length} rappel{pendingAssistantTasks.length > 1 ? "s" : ""} en attente
            </span>
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
          <div className="space-y-4">
            <div className={innerCardClass}>
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">Informations sur le malade</p>
                  <p className="mt-1 text-xs text-muted-foreground">Resume pratique pour la famille et le suivi quotidien.</p>
                </div>
                <UserCircle2 className="h-5 w-5 text-primary" />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-2 text-sm">
                  <span className="text-foreground">Nom du patient</span>
                  <Input
                    value={assistantProfile.patientName}
                    onChange={(e) => setAssistantProfile((current) => ({ ...current, patientName: e.target.value }))}
                  />
                </label>
                <label className="space-y-2 text-sm">
                  <span className="text-foreground">Age</span>
                  <Input
                    value={assistantProfile.age}
                    onChange={(e) => setAssistantProfile((current) => ({ ...current, age: e.target.value }))}
                    placeholder="Ex: 72"
                  />
                </label>
                <label className="space-y-2 text-sm sm:col-span-2">
                  <span className="text-foreground">Diagnostic / contexte</span>
                  <Input
                    value={assistantProfile.diagnosis}
                    onChange={(e) => setAssistantProfile((current) => ({ ...current, diagnosis: e.target.value }))}
                    placeholder="Ex: Alzheimer stade precoce"
                  />
                </label>
                <label className="space-y-2 text-sm">
                  <span className="text-foreground">Contact d'urgence</span>
                  <Input
                    value={assistantProfile.emergencyContact}
                    onChange={(e) => setAssistantProfile((current) => ({ ...current, emergencyContact: e.target.value }))}
                    placeholder="Ex: Oumaima"
                  />
                </label>
                <label className="space-y-2 text-sm">
                  <span className="text-foreground">Telephone urgence</span>
                  <Input
                    value={assistantProfile.emergencyPhone}
                    onChange={(e) => setAssistantProfile((current) => ({ ...current, emergencyPhone: e.target.value }))}
                    placeholder="Ex: +216..."
                  />
                </label>
                <label className="space-y-2 text-sm sm:col-span-2">
                  <span className="text-foreground">Notes quotidiennes</span>
                  <Textarea
                    value={assistantProfile.dailyNotes}
                    onChange={(e) => setAssistantProfile((current) => ({ ...current, dailyNotes: e.target.value }))}
                    placeholder="Ex: aime marcher le matin, oublis plus frequents le soir, routine de coucher..."
                    className="min-h-24"
                  />
                </label>
              </div>

              <div className="mt-4 flex justify-end">
                <Button type="button" onClick={saveAssistantProfile} className="rounded-xl">
                  Enregistrer le profil
                </Button>
              </div>
            </div>

            <div className={innerCardClass}>
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">Notifications et reminders</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Quand l'heure du rappel arrive, une notification ou une alerte dans l'application s'affiche.
                  </p>
                </div>
                <BellPlus className="h-5 w-5 text-primary" />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/60 bg-white/70 p-4">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    Etat: {notificationStatusLabel}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {notificationHelpText}
                  </p>
                </div>
                <Button type="button" onClick={requestReminderPermission} className="rounded-xl">
                  Activer les notifications
                </Button>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className={innerCardClass}>
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">Famille et arbre d'aide</p>
                  <p className="mt-1 text-xs text-muted-foreground">Ajoute photo, nom, lien familial et notes utiles pour chaque proche.</p>
                </div>
                <Users className="h-5 w-5 text-primary" />
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <label className="space-y-2 text-sm">
                  <span className="text-foreground">Nom</span>
                  <Input value={familyForm.name} onChange={(e) => setFamilyForm((current) => ({ ...current, name: e.target.value }))} placeholder="Ex: Oumaima" />
                </label>
                <label className="space-y-2 text-sm">
                  <span className="text-foreground">Lien de famille</span>
                  <Input value={familyForm.relation} onChange={(e) => setFamilyForm((current) => ({ ...current, relation: e.target.value }))} placeholder="Ex: Fille, soeur, mari..." />
                </label>
                <label className="space-y-2 text-sm">
                  <span className="text-foreground">Telephone</span>
                  <Input value={familyForm.phone} onChange={(e) => setFamilyForm((current) => ({ ...current, phone: e.target.value }))} placeholder="Ex: +216..." />
                </label>
                <label className="space-y-2 text-sm">
                  <span className="text-foreground">Image</span>
                  <Input type="file" accept="image/*" onChange={(e) => handleFamilyImageUpload(e.target.files?.[0] ?? null)} />
                </label>
                <label className="space-y-2 text-sm md:col-span-2">
                  <span className="text-foreground">Notes</span>
                  <Textarea value={familyForm.notes} onChange={(e) => setFamilyForm((current) => ({ ...current, notes: e.target.value }))} placeholder="Ex: accompagne aux rendez-vous, gere les medicaments..." className="min-h-20" />
                </label>
              </div>

              <div className="mt-4 flex justify-end">
                <Button type="button" onClick={addFamilyMember} className="rounded-xl">
                  <Plus className="mr-2 h-4 w-4" />
                  Ajouter un proche
                </Button>
              </div>

              <div className="mt-5">
                {familyMembers.length === 0 ? (
                  <EmptyState
                    title="Aucun proche enregistre"
                    description="Ajoute les proches du malade avec leur photo, nom et lien familial pour construire l'arbre d'aide."
                  />
                ) : (
                  <div className="grid gap-4 md:grid-cols-2">
                    {familyMembers.map((member) => (
                      <div key={member.id} className="relative rounded-2xl border border-border/70 bg-white/80 p-4 shadow-[0_12px_28px_rgba(15,23,42,0.06)]">
                        <button
                          type="button"
                          onClick={() => removeFamilyMember(member.id)}
                          className="absolute right-3 top-3 rounded-full p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                        <div className="flex items-center gap-3">
                          <img src={member.imageUrl || createArticleImage(member.name, 0)} alt={member.name} className="h-16 w-16 rounded-2xl object-cover border border-border/60" />
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-foreground">{member.name}</p>
                            <p className="text-xs text-primary">{member.relation}</p>
                            {member.phone && (
                              <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                                <Phone className="h-3.5 w-3.5" />
                                {member.phone}
                              </p>
                            )}
                          </div>
                        </div>
                        {member.notes && <p className="mt-3 text-sm leading-6 text-muted-foreground">{member.notes}</p>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className={innerCardClass}>
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">To do list et rappels</p>
                  <p className="mt-1 text-xs text-muted-foreground">Une liste quotidienne simple pour se rappeler des choses importantes.</p>
                </div>
                <SquareCheckBig className="h-5 w-5 text-primary" />
              </div>

              <div className="grid gap-3 md:grid-cols-[1fr_140px]">
                <label className="space-y-2 text-sm">
                  <span className="text-foreground">Tache / reminder</span>
                  <Input value={taskForm.title} onChange={(e) => setTaskForm((current) => ({ ...current, title: e.target.value }))} placeholder="Ex: Boire de l'eau, medicament, appel famille..." />
                </label>
                <label className="space-y-2 text-sm">
                  <span className="text-foreground">Heure</span>
                  <Input type="time" value={taskForm.time} onChange={(e) => setTaskForm((current) => ({ ...current, time: e.target.value }))} />
                </label>
                <label className="space-y-2 text-sm md:col-span-2">
                  <span className="text-foreground">Details</span>
                  <Textarea value={taskForm.details} onChange={(e) => setTaskForm((current) => ({ ...current, details: e.target.value }))} placeholder="Ex: apres le petit dejeuner, avec Oumaima, verifier si c'est fait..." className="min-h-20" />
                </label>
              </div>

              <div className="mt-4 flex justify-end">
                <Button type="button" onClick={addAssistantTask} className="rounded-xl">
                  <Plus className="mr-2 h-4 w-4" />
                  Ajouter un reminder
                </Button>
              </div>

              <div className="mt-5 space-y-3">
                {assistantTasks.length === 0 ? (
                  <EmptyState
                    title="Aucun rappel pour le moment"
                    description="Ajoute une premiere tache quotidienne pour aider le patient et la famille."
                  />
                ) : (
                  assistantTasks.map((task) => (
                    <div key={task.id} className={`flex flex-col gap-3 rounded-2xl border p-4 transition-colors sm:flex-row sm:items-center sm:justify-between ${
                      task.done ? "border-emerald-200 bg-emerald-50/80" : "border-border/70 bg-white/80"
                    }`}>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
                            {task.time}
                          </span>
                          <p className={`text-sm font-semibold ${task.done ? "text-emerald-700 line-through" : "text-foreground"}`}>
                            {task.title}
                          </p>
                        </div>
                        {task.details && (
                          <p className="mt-2 text-sm leading-6 text-muted-foreground">{task.details}</p>
                        )}
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <Button type="button" variant="outline" onClick={() => toggleAssistantTask(task.id)} className="rounded-xl">
                          <SquareCheckBig className="mr-2 h-4 w-4" />
                          {task.done ? "Annuler" : "Fait"}
                        </Button>
                        <Button type="button" variant="outline" onClick={() => removeAssistantTask(task.id)} className="rounded-xl">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </motion.section>

      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25 }}
        className={panelClass}
      >
        <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-display text-xl font-bold text-foreground">Journal de symptomes</h2>
            <p className="text-sm text-muted-foreground">
              Notes quotidiennes rattachees au dernier contexte IRM pour aider le suivi medical.
            </p>
          </div>
          <div className="rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground">
            Base sur {advicePrediction ?? "aucun diagnostic validé"}
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-4 rounded-2xl border border-border/70 bg-background/70 p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-2 text-sm">
                <span className="flex items-center gap-2 text-foreground"><NotebookPen className="h-4 w-4 text-primary" /> Oubli</span>
                <select
                  value={journalForm.forgetfulness}
                  onChange={(e) => setJournalForm((current) => ({ ...current, forgetfulness: e.target.value }))}
                  className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
                >
                  <option>Faible</option>
                  <option>Modere</option>
                  <option>Eleve</option>
                </select>
              </label>

              <label className="space-y-2 text-sm">
                <span className="flex items-center gap-2 text-foreground"><TimerReset className="h-4 w-4 text-primary" /> Fatigue</span>
                <select
                  value={journalForm.fatigue}
                  onChange={(e) => setJournalForm((current) => ({ ...current, fatigue: e.target.value }))}
                  className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
                >
                  <option>Faible</option>
                  <option>Moderee</option>
                  <option>Forte</option>
                </select>
              </label>

              <label className="space-y-2 text-sm">
                <span className="flex items-center gap-2 text-foreground"><AlertTriangle className="h-4 w-4 text-primary" /> Confusion</span>
                <select
                  value={journalForm.confusion}
                  onChange={(e) => setJournalForm((current) => ({ ...current, confusion: e.target.value }))}
                  className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
                >
                  <option>Aucune</option>
                  <option>Legere</option>
                  <option>Frequente</option>
                </select>
              </label>

              <label className="space-y-2 text-sm">
                <span className="flex items-center gap-2 text-foreground"><Moon className="h-4 w-4 text-primary" /> Sommeil</span>
                <select
                  value={journalForm.sleep}
                  onChange={(e) => setJournalForm((current) => ({ ...current, sleep: e.target.value }))}
                  className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
                >
                  <option>Bon</option>
                  <option>Irregulier</option>
                  <option>Perturbe</option>
                </select>
              </label>
            </div>

            <label className="space-y-2 text-sm">
              <span className="flex items-center gap-2 text-foreground"><Smile className="h-4 w-4 text-primary" /> Humeur</span>
              <select
                value={journalForm.mood}
                onChange={(e) => setJournalForm((current) => ({ ...current, mood: e.target.value }))}
                className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm"
              >
                <option>Stable</option>
                <option>Stress</option>
                <option>Triste</option>
                <option>Irritable</option>
              </select>
            </label>

            <label className="space-y-2 text-sm">
              <span className="text-foreground">Note libre</span>
              <Input
                value={journalForm.note}
                onChange={(e) => setJournalForm((current) => ({ ...current, note: e.target.value }))}
                placeholder="Exemple: oublis plus frequents le soir, sommeil agite..."
              />
            </label>

            <Button onClick={saveJournalEntry} className="rounded-xl">
              Enregistrer le journal
            </Button>
          </div>

          <div className="space-y-3 rounded-2xl border border-border/70 bg-background/70 p-4">
            <div className="rounded-2xl border border-primary/15 bg-primary/5 p-4">
              <p className="text-sm font-semibold text-primary">Repere clinique courant</p>
              <p className="mt-1 text-sm text-foreground">
                Les symptomes notes ici sont interpretes avec le dernier resultat IRM:{" "}
                <span className="font-semibold">{advicePrediction ?? "aucun diagnostic validé"}</span>.
              </p>
            </div>

            {journalEntries.length === 0 ? (
              <EmptyState
                title="Aucune note pour le moment"
                description="Ajoute une premiere entree pour suivre l'evolution de la memoire, de la fatigue et du sommeil."
              />
            ) : (
              journalEntries.map((entry) => (
                <div key={entry.id} className="rounded-2xl border border-border bg-card p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-foreground">
                      {new Date(entry.createdAt).toLocaleDateString("fr-FR")}
                    </p>
                    <span className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
                      {entry.scanPrediction} • Risque {entry.riskLevel}
                    </span>
                  </div>
                  <div className="mt-3 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
                    <p>Oubli: <span className="font-medium text-foreground">{entry.forgetfulness}</span></p>
                    <p>Fatigue: <span className="font-medium text-foreground">{entry.fatigue}</span></p>
                    <p>Confusion: <span className="font-medium text-foreground">{entry.confusion}</span></p>
                    <p>Sommeil: <span className="font-medium text-foreground">{entry.sleep}</span></p>
                    <p>Humeur: <span className="font-medium text-foreground">{entry.mood}</span></p>
                  </div>
                  {entry.note && <p className="mt-3 text-sm text-foreground">{entry.note}</p>}
                </div>
              ))
            )}
          </div>
        </div>
      </motion.section>

      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className={panelClass}
      >
        <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-display text-xl font-bold text-foreground">Conseils pour les proches</h2>
            <p className="text-sm text-muted-foreground">
              Recommandations pour la famille, adaptees au dernier resultat IRM du patient.
            </p>
          </div>
          <div className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
            {caregiverAdvice.tone}
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-2xl border border-border/70 bg-background/70 p-4">
            <div className="mb-3 flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" />
              <p className="text-sm font-semibold text-foreground">Au quotidien</p>
            </div>
            <div className="space-y-2">
              {caregiverAdvice.dailyHelp.map((item) => (
                <p key={item} className="text-sm leading-6 text-muted-foreground">
                  - {item}
                </p>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-border/70 bg-background/70 p-4">
            <div className="mb-3 flex items-center gap-2">
              <BellRing className="h-4 w-4 text-primary" />
              <p className="text-sm font-semibold text-foreground">A surveiller</p>
            </div>
            <div className="space-y-2">
              {caregiverAdvice.watchFor.map((item) => (
                <p key={item} className="text-sm leading-6 text-muted-foreground">
                  - {item}
                </p>
              ))}
            </div>
          </div>

          <div className="rounded-2xl border border-primary/15 bg-primary/5 p-4">
            <div className="mb-3 flex items-center gap-2">
              <HandHeart className="h-4 w-4 text-primary" />
              <p className="text-sm font-semibold text-primary">Comment parler au patient</p>
            </div>
            <p className="text-sm leading-6 text-foreground">{caregiverAdvice.communication}</p>
            <p className="mt-4 text-xs leading-5 text-muted-foreground">
              Ces conseils suivent le contexte de la derniere IRM:{" "}
              <span className="font-semibold text-foreground">{advicePrediction ?? "aucun diagnostic validé"}</span>.
            </p>
          </div>
        </div>
      </motion.section>

      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.35 }}
        className={panelClass}
      >
        <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Guides officiels dynamiques</p>
            <h2 className="mt-2 font-display text-xl font-bold text-foreground">Ressources adaptees au resultat du scan</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Ces liens changent selon le stade detecte pour aider le patient et la famille a comprendre le resultat et les prochaines etapes.
            </p>
          </div>
          <div className="rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground">
            Base sur {advicePrediction ?? "aucun diagnostic validé"}
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {guideLinks.map((link) => (
            <a
              key={link.url}
              href={link.url}
              target="_blank"
              rel="noreferrer"
              className="group rounded-2xl border border-border/70 bg-background/70 p-4 transition-colors hover:border-primary/30 hover:bg-primary/5"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">{link.label}</p>
                  <p className="mt-1 text-sm text-muted-foreground">Ouvrir la ressource officielle dans un nouvel onglet.</p>
                </div>
                <ExternalLink className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
              </div>
            </a>
          ))}
        </div>
      </motion.section>
      </div>
    </div>
  );
};

export default UserOverview;
