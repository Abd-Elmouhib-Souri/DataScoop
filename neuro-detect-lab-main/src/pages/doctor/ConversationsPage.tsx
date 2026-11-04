import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import {
  getConversations,
  getMessages,
  sendMessage,
  createAppointments,
  getDoctorAppointments,
  updateAppointmentStatus,
  rescheduleAppointment,
  type Conversation,
  type Appointment,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  Send,
  MessageCircle,
  Loader2,
  User,
  FileText,
  ScanLine,
  Stethoscope,
  Users,
  ArrowUpRight,
  CheckCircle2,
  BellRing,
  CalendarClock,
  ClipboardList,
  ShieldCheck,
  BookOpen,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";

const doctorCommunicationModules = [
  {
    icon: MessageCircle,
    title: "Message patient-medecin",
    desc: "Conserver un fil d'echange pour le suivi, les symptomes et la preparation de la consultation.",
  },
  {
    icon: ScanLine,
    title: "Partage du scan",
    desc: "Relire l'IRM transmise par le patient avec le contexte clinique associe.",
  },
  {
    icon: FileText,
    title: "Envoi du rapport",
    desc: "Partager une synthese interpretable apres analyse ou relecture clinique.",
  },
  {
    icon: Stethoscope,
    title: "Demande d'avis",
    desc: "Preparer un second avis ou un arbitrage clinique sur un dossier sensible.",
  },
  {
    icon: Users,
    title: "Module Aidant/Famille",
    desc: "Facilitez la coordination entre l'equipe medicale et les proches referents avec un acces encadre aux informations utiles, aux rendez-vous, aux consignes de prise en charge et au suivi a domicile.",
  },
];

const scanShareChecklist = [
  "IRM verifiee et associee au bon patient",
  "Contexte clinique ajoute avant partage",
  "Date du scan confirmee",
];

const familySupportChecklist = [
  "Prochain rendez-vous a communiquer",
  "Consignes quotidiennes et signes d'alerte",
  "Personne de contact principale identifiee",
];

const familyCoordinationFeatures = [
  {
    icon: ShieldCheck,
    title: "Acces encadre",
    desc: "Definir les proches autorises, leur role et le niveau d'information partage.",
  },
  {
    icon: CalendarClock,
    title: "Rendez-vous et rappels",
    desc: "Partager les consultations, examens, renouvellements et temps forts du parcours.",
  },
  {
    icon: ClipboardList,
    title: "Suivi a domicile",
    desc: "Tracer les observations du quotidien, les consignes et leur niveau d'execution.",
  },
  {
    icon: BellRing,
    title: "Alertes ciblees",
    desc: "Notifier rapidement les proches referents en cas de changement clinique ou organisationnel.",
  },
];

const professionalAppointmentPlan = [
  {
    slot: "Rendez-vous 1",
    timing: "Sous 7 jours",
    duration: "45 min",
    title: "Consultation de confirmation clinique",
    desc: "Revoir les plaintes cognitives, l'imagerie, les antecedents et verifier la concordance entre symptomes et stade suspecte.",
  },
  {
    slot: "Rendez-vous 2",
    timing: "A 4 a 6 semaines",
    duration: "30 min",
    title: "Consultation de suivi et ajustement",
    desc: "Evaluer l'evolution fonctionnelle, ajuster les consignes, organiser les examens complementaires et renforcer le plan aidant/famille.",
  },
  {
    slot: "Rendez-vous 3",
    timing: "A 3 mois",
    duration: "40 min",
    title: "Reevaluation du stade et du parcours",
    desc: "Mesurer la progression, revoir la tolerance therapeutique, reevaluer l'autonomie et planifier la suite de la prise en charge.",
  },
];

type AppointmentDraft = {
  slot: string;
  timing: string;
  duration: string;
  title: string;
  desc: string;
  date: string;
  time: string;
};

type ScheduledAppointment = AppointmentDraft & {
  patientEmail: string;
  patientName: string;
  createdAt: string;
  createdBy: string;
  doctorId: string;
  doctorName: string;
  endTime: string;
};

const doctorResourceLinks = [
  {
    title: "Alzheimer's Association - Stages of Alzheimer's",
    desc: "Repere pratique sur les stades mild, moderate et severe et les signes cliniques associes.",
    href: "https://www.alz.org/alzheimers-dementia/stages",
  },
  {
    title: "WHO - Dementia Fact Sheet",
    desc: "Vue d'ensemble sur les symptomes, la charge de maladie, le retentissement fonctionnel et les enjeux de prise en charge.",
    href: "https://www.who.int/news-room/fact-sheets/detail/dementia",
  },
  {
    title: "NIA - What Happens to the Brain in Alzheimer's Disease?",
    desc: "Reference utile pour relier les mecanismes cerebraux, l'atteinte des reseaux et l'evolution clinique.",
    href: "https://www.nia.nih.gov/health/alzheimers-causes-and-risk-factors/what-happens-brain-alzheimers-disease",
  },
];

const parseDurationToMinutes = (duration: string) => {
  const numeric = Number.parseInt(duration.replace(/[^\d]/g, ""), 10);
  return Number.isFinite(numeric) ? numeric : 30;
};

const computeAppointmentWindow = (date: string, time: string, duration: string) => {
  const start = new Date(`${date}T${time}:00`);
  const durationMinutes = parseDurationToMinutes(duration);
  const end = new Date(start.getTime() + durationMinutes * 60 * 1000);
  const endTime = `${String(end.getHours()).padStart(2, "0")}:${String(end.getMinutes()).padStart(2, "0")}`;

  return { start, end, endTime };
};

const appointmentsOverlap = (
  left: Pick<ScheduledAppointment, "date" | "time" | "duration">,
  right: Pick<ScheduledAppointment, "date" | "time" | "duration">
) => {
  const leftWindow = computeAppointmentWindow(left.date, left.time, left.duration);
  const rightWindow = computeAppointmentWindow(right.date, right.time, right.duration);

  return leftWindow.start < rightWindow.end && rightWindow.start < leftWindow.end;
};

const getCurrentSchedulingBounds = () => {
  const now = new Date();
  const minDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const minTime = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  return { now, minDate, minTime };
};

const getAppointmentPatientName = (appointment: Appointment) =>
  appointment.patient?.name ||
  (appointment as Appointment & { patientName?: string }).patientName ||
  "Patient";

const getAppointmentPrediction = (appointment: Appointment) =>
  appointment.patient?.prediction || "A preciser";

const getAppointmentStatusLabel = (status: Appointment["status"]) => {
  switch (status) {
    case "scheduled":
      return "Programme";
    case "confirmed":
      return "Confirme";
    case "cancelled":
      return "Annule";
    case "rescheduled":
      return "Reporte";
    case "completed":
      return "Termine";
    default:
      return status;
  }
};

const getAppointmentStatusClasses = (status: Appointment["status"]) => {
  switch (status) {
    case "confirmed":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "cancelled":
      return "border-rose-200 bg-rose-50 text-rose-700";
    case "rescheduled":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "completed":
      return "border-slate-200 bg-slate-100 text-slate-700";
    default:
      return "border-sky-200 bg-sky-50 text-sky-700";
  }
};

const DoctorConversationsPage = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [newMessage, setNewMessage] = useState("");
  const [reportNote, setReportNote] = useState("");
  const [secondOpinionRequest, setSecondOpinionRequest] = useState("");
  const [familyGuidance, setFamilyGuidance] = useState("");
  const [showDoctorAgenda, setShowDoctorAgenda] = useState(true);
  const [rescheduleDrafts, setRescheduleDrafts] = useState<Record<string, { date: string; time: string; duration: string }>>({});
  const [appointmentDrafts, setAppointmentDrafts] = useState<AppointmentDraft[]>(
    professionalAppointmentPlan.map((item) => ({
      ...item,
      date: "",
      time: "",
    }))
  );

  const { data: conversations = [], isLoading: conversationsLoading } = useQuery({
    queryKey: ["conversations"],
    queryFn: () => getConversations(user?.token || ""),
    enabled: !!user?.token,
  });

  const { data: messages = [], isLoading: messagesLoading } = useQuery({
    queryKey: ["messages", selectedConversation?._id],
    queryFn: () => getMessages(selectedConversation!._id, user?.token || ""),
    enabled: !!selectedConversation && !!user?.token,
  });
  const { now: schedulingNow, minDate, minTime } = getCurrentSchedulingBounds();
  const { data: doctorScheduledAppointments = [], isLoading: appointmentsLoading } = useQuery({
    queryKey: ["doctor-appointments", user?.id, user?.token],
    queryFn: () => getDoctorAppointments(user?.id || "", user?.token || ""),
    enabled: !!user?.id && !!user?.token,
  });

  const sendMessageMutation = useMutation({
    mutationFn: ({
      conversationId,
      receiverId,
      content,
    }: {
      conversationId: string;
      receiverId: string;
      content: string;
    }) => sendMessage(conversationId, receiverId, content, user?.token || ""),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["messages", selectedConversation?._id] });
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      setNewMessage("");
    },
    onError: () => {
      toast.error("Erreur lors de l'envoi du message");
    },
  });

  const createAppointmentsMutation = useMutation({
    mutationFn: ({
      patientName: _patientName,
      ...payload
    }: {
      patientName: string;
      patientEmail: string;
      appointments: Array<{
        slot: string;
        timing: string;
        duration: string;
        title: string;
        desc: string;
        date: string;
        time: string;
      }>;
    }) => createAppointments(payload, user?.token || ""),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["doctor-appointments", user?.id, user?.token] });
      appendToComposer(
        [
          `Rendez-vous programmes pour ${variables.patientName}`,
          ...variables.appointments.map(
            (item) =>
              `${item.slot} - ${item.date} a ${item.time} - Duree ${item.duration}\n${item.title}\n${item.desc}`
          ),
        ].join("\n\n")
      );
      toast.success("Les rendez-vous ont ete enregistres et seront visibles dans les espaces doctor et patient.");
    },
    onError: (error: any) => {
      const apiMessage =
        error?.response?.data?.message ||
        error?.message ||
        "Impossible de programmer les rendez-vous pour le moment.";
      toast.error(apiMessage);
    },
  });

  const updateAppointmentStatusMutation = useMutation({
    mutationFn: ({ appointmentId, status }: { appointmentId: string; status: "confirmed" | "cancelled" | "completed" }) =>
      updateAppointmentStatus(appointmentId, { status }, user?.token || ""),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["doctor-appointments", user?.id, user?.token] });
    },
  });

  const rescheduleAppointmentMutation = useMutation({
    mutationFn: ({ appointmentId, date, time, duration }: { appointmentId: string; date: string; time: string; duration: string }) =>
      rescheduleAppointment(appointmentId, { date, time, duration }, user?.token || ""),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["doctor-appointments", user?.id, user?.token] });
    },
  });

  const handleSendMessage = () => {
    if (!selectedConversation || !newMessage.trim()) return;

    sendMessageMutation.mutate({
      conversationId: selectedConversation._id,
      receiverId: selectedConversation.patient._id,
      content: newMessage.trim(),
    });
  };

  const formatTime = (dateString: string) =>
    new Date(dateString).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });

  const getUnreadCount = (_conversation: Conversation) => 0;

  const appendToComposer = (content: string) => {
    setNewMessage((current) => {
      const trimmed = current.trim();
      return trimmed ? `${trimmed}\n\n${content}` : content;
    });
  };

  const syncAppointmentDraftsForConversation = (conversation: Conversation) => {
    setSelectedConversation(conversation);
    setAppointmentDrafts(
      professionalAppointmentPlan.map((item) => ({
        ...item,
        date: "",
        time: "",
      }))
    );
  };

  const handleInsertReport = () => {
    if (!selectedConversation) return;

    appendToComposer(
      [
        `Rapport clinique pour ${selectedConversation.patient.name}`,
        reportNote.trim() || "Synthese du rapport en attente de completion.",
        "Actions proposees : consultation de suivi, verification des symptomes et archivage du compte rendu.",
      ].join("\n")
    );
    toast.success("Le contenu du rapport a ete ajoute au message.");
  };

  const handleInsertSecondOpinion = () => {
    if (!selectedConversation) return;

    appendToComposer(
      [
        `Demande d'avis complementaire pour ${selectedConversation.patient.name}`,
        secondOpinionRequest.trim() || "Merci de relire le dossier et de confirmer l'orientation clinique.",
        "Elements a partager : scan, rapport actuel et evolution des symptomes.",
      ].join("\n")
    );
    toast.success("La demande d'avis a ete preparee dans le message.");
  };

  const handleInsertFamilyGuidance = () => {
    if (!selectedConversation) return;

    appendToComposer(
      [
        `Message aidant/famille pour ${selectedConversation.patient.name}`,
        familyGuidance.trim() || "Merci de suivre les consignes quotidiennes et de signaler tout changement cognitif ou comportemental.",
        "Points pratiques : traitement, rendez-vous, surveillance a domicile.",
      ].join("\n")
    );
    toast.success("Le message aidant/famille a ete prepare.");
  };

  const handleInsertFamilyCoordinationPlan = () => {
    if (!selectedConversation) return;

    appendToComposer(
      [
        `Plan de coordination aidant/famille pour ${selectedConversation.patient.name}`,
        "Proches referents : aidant principal, contact secondaire, disponibilites.",
        "Informations partagees : rendez-vous, consignes de prise en charge, documents utiles.",
        "Suivi a domicile : observations cognitives, comportement, sommeil, alimentation, adherence therapeutique.",
        "Alertes : prevenir l'equipe en cas de changement clinique, aggravation ou difficulte a domicile.",
      ].join("\n")
    );
    toast.success("Le plan de coordination aidant/famille a ete ajoute.");
  };

  const handleInsertAppointmentPlan = () => {
    if (!selectedConversation) return;

    appendToComposer(
      [
        `Plan de rendez-vous pour ${selectedConversation.patient.name}`,
        ...professionalAppointmentPlan.map(
          (item) =>
            `${item.slot} - ${item.timing} - Duree ${item.duration}\n${item.title}\n${item.desc}`
        ),
      ].join("\n\n")
    );
    toast.success("Le plan de rendez-vous detaille a ete ajoute.");
  };

  const handleAppointmentDraftChange = (
    index: number,
    field: "date" | "time" | "duration",
    value: string
  ) => {
    setAppointmentDrafts((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index ? { ...item, [field]: value } : item
      )
    );
  };

  const handleScheduleAppointments = () => {
    if (!selectedConversation) return;

    const completedAppointments = appointmentDrafts.filter((item) => item.date && item.time);

    if (completedAppointments.length === 0) {
      toast.error("Ajoutez au moins une date et une heure pour programmer un rendez-vous.");
      return;
    }

    const payload: ScheduledAppointment[] = completedAppointments.slice(0, 3).map((item) => {
      const window = computeAppointmentWindow(item.date, item.time, item.duration);
      return {
        ...item,
        patientEmail: selectedConversation.patient.email,
        patientName: selectedConversation.patient.name,
        createdAt: new Date().toISOString(),
        createdBy: user?.name ?? "Equipe medicale",
        doctorId: user?.id ?? "",
        doctorName: user?.name ?? "",
        endTime: window.endTime,
      };
    });

    for (let index = 0; index < payload.length; index += 1) {
      const current = payload[index];
      const currentWindow = computeAppointmentWindow(current.date, current.time, current.duration);

      if (currentWindow.start < schedulingNow) {
        toast.error(
          `Le ${current.slot} est dans le passe. Merci de choisir une date et une heure posterieures au ${minDate} ${minTime}.`
        );
        return;
      }

      const conflictingDraft = payload.find(
        (candidate, candidateIndex) =>
          candidateIndex !== index && appointmentsOverlap(current, candidate)
      );

      if (conflictingDraft) {
        toast.error(
          `Conflit entre ${current.slot} et ${conflictingDraft.slot}. Un medecin ne peut pas avoir deux patients au meme moment.`
        );
        return;
      }

      const conflictingExisting = doctorScheduledAppointments.find((appointment) =>
        appointmentsOverlap(current, {
          date: appointment.scheduledDate,
          time: appointment.startTime,
          duration: `${appointment.durationMinutes}`,
        })
      );

      if (conflictingExisting) {
        toast.error(
          `Conflit detecte avec ${getAppointmentPatientName(conflictingExisting)} le ${conflictingExisting.scheduledDate} de ${conflictingExisting.startTime} a ${conflictingExisting.endTime}.`
        );
        return;
      }
    }

    createAppointmentsMutation.mutate({
      patientName: selectedConversation.patient.name,
      patientEmail: selectedConversation.patient.email,
      appointments: completedAppointments.slice(0, 3),
    });
  };

  const handleRescheduleDraftChange = (
    appointmentId: string,
    field: "date" | "time" | "duration",
    value: string
  ) => {
    setRescheduleDrafts((current) => ({
      ...current,
      [appointmentId]: {
        date: current[appointmentId]?.date ?? "",
        time: current[appointmentId]?.time ?? "",
        duration: current[appointmentId]?.duration ?? "",
        [field]: value,
      },
    }));
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, selectedConversation?._id]);

  const activeDoctorAppointments = doctorScheduledAppointments.filter(
    (appointment) => appointment.status !== "cancelled" && appointment.status !== "completed"
  );
  const confirmedAppointments = doctorScheduledAppointments.filter(
    (appointment) => appointment.status === "confirmed"
  );
  const selectedPatientAppointments = selectedConversation
    ? doctorScheduledAppointments.filter(
        (appointment) =>
          appointment.patient?._id === selectedConversation.patient._id ||
          appointment.patient?.email === selectedConversation.patient.email
      )
    : [];

  return (
    <div className="min-h-full bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.12),transparent_34%),radial-gradient(circle_at_top_right,rgba(59,130,246,0.10),transparent_30%)] p-4 sm:p-6">
      <div className="mx-auto max-w-[1600px] space-y-6">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="overflow-hidden rounded-[28px] border border-primary/10 bg-[linear-gradient(135deg,rgba(255,255,255,0.96),rgba(240,249,255,0.92))] p-6 shadow-[0_22px_70px_-32px_rgba(14,165,233,0.55)]"
      >
        <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/15 bg-primary/5 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-primary">
              <MessageCircle className="h-3.5 w-3.5" />
              Coordination Clinique
            </div>
            <h1 className="mt-4 font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              Conversations et rendez-vous patients
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
              Une vue plus claire pour suivre les echanges, preparer les rendez-vous et retrouver rapidement
              le contexte du patient sans faire defiler toute la page.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 xl:min-w-[540px]">
            <div className="rounded-2xl border border-border/70 bg-white/80 p-4 shadow-sm">
              <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Patients</p>
              <p className="mt-2 text-2xl font-bold text-foreground">{conversations.length}</p>
              <p className="mt-1 text-xs text-muted-foreground">Conversations actives</p>
            </div>
            <div className="rounded-2xl border border-border/70 bg-white/80 p-4 shadow-sm">
              <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Agenda actif</p>
              <p className="mt-2 text-2xl font-bold text-foreground">{activeDoctorAppointments.length}</p>
              <p className="mt-1 text-xs text-muted-foreground">Rendez-vous en cours</p>
            </div>
            <div className="rounded-2xl border border-border/70 bg-white/80 p-4 shadow-sm">
              <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Confirmes</p>
              <p className="mt-2 text-2xl font-bold text-foreground">{confirmedAppointments.length}</p>
              <p className="mt-1 text-xs text-muted-foreground">Consultations validees</p>
            </div>
          </div>
        </div>
      </motion.div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {doctorCommunicationModules.map((item) => {
          const Icon = item.icon;
          return (
            <Card
              key={item.title}
              className="overflow-hidden border-primary/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(248,250,252,0.96))] shadow-[0_18px_40px_-28px_rgba(15,23,42,0.45)]"
            >
              <CardContent className="p-5">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-inner">
                  <Icon className="h-5 w-5" />
                </div>
                <h2 className="mt-4 text-sm font-semibold text-foreground">{item.title}</h2>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">{item.desc}</p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
        <div className="xl:sticky xl:top-6 xl:self-start">
          <Card className="overflow-hidden border-border/70 shadow-[0_22px_60px_-38px_rgba(15,23,42,0.45)]">
            <CardHeader className="border-b bg-[linear-gradient(180deg,rgba(248,250,252,0.95),rgba(255,255,255,0.88))]">
              <CardTitle className="flex items-center gap-2 text-base">
                <MessageCircle className="h-5 w-5" />
                Patients ({conversations.length})
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Selectionnez un patient pour afficher son contexte, son agenda et le fil de discussion.
              </p>
            </CardHeader>
            <CardContent className="space-y-2 p-3">
              {conversationsLoading ? (
                <div className="flex justify-center py-4">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : conversations.length === 0 ? (
                <div className="py-8 text-center">
                  <MessageCircle className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
                  <p className="text-muted-foreground">Aucune conversation active</p>
                </div>
              ) : (
                conversations.map((conversation) => {
                  const unreadCount = getUnreadCount(conversation);
                  return (
                    <button
                      key={conversation._id}
                      onClick={() => syncAppointmentDraftsForConversation(conversation)}
                      className={`w-full rounded-2xl border p-4 text-left transition-all ${
                        selectedConversation?._id === conversation._id
                          ? "border-primary/30 bg-primary/[0.08] shadow-[0_14px_30px_-24px_rgba(14,165,233,0.9)]"
                          : "border-transparent bg-muted/20 hover:border-border hover:bg-muted/50"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <Avatar className="h-11 w-11 ring-1 ring-border/60">
                          <AvatarFallback className="bg-primary/10 text-primary">
                            {conversation.patient.name.charAt(0).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between">
                            <p className="truncate text-sm font-semibold">{conversation.patient.name}</p>
                            {unreadCount > 0 && (
                              <Badge variant="destructive" className="text-xs">
                                {unreadCount}
                              </Badge>
                            )}
                          </div>
                          {conversation.lastMessage && (
                            <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                              {conversation.lastMessage.content}
                            </p>
                          )}
                          <p className="mt-2 truncate text-[11px] font-medium uppercase tracking-[0.16em] text-primary/80">
                            {conversation.patient.email}
                          </p>
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </CardContent>
          </Card>
        </div>

        <div className="min-w-0">
          {selectedConversation ? (
            <div className="space-y-6">
              <Card className="overflow-hidden border-border/70 shadow-[0_24px_60px_-38px_rgba(15,23,42,0.45)]">
                <CardHeader className="border-b bg-[linear-gradient(135deg,rgba(240,249,255,0.95),rgba(255,255,255,0.96))]">
                  <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
                    <CardTitle className="flex items-center gap-4">
                      <Avatar className="h-14 w-14 ring-1 ring-primary/20">
                      <AvatarFallback className="bg-primary/10 text-lg font-semibold text-primary">
                        {selectedConversation.patient.name.charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                      <div>
                        <p className="font-medium">{selectedConversation.patient.name}</p>
                        <p className="text-sm text-muted-foreground">{selectedConversation.patient.email}</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Badge variant="secondary" className="rounded-full px-3 py-1">
                            {messages.length} message{messages.length > 1 ? "s" : ""}
                          </Badge>
                          <Badge variant="secondary" className="rounded-full px-3 py-1">
                            {selectedPatientAppointments.length} rendez-vous lies
                          </Badge>
                        </div>
                      </div>
                    </CardTitle>

                    <div className="grid gap-3 sm:grid-cols-3 xl:min-w-[420px]">
                      <div className="rounded-2xl border border-white/70 bg-white/80 p-4">
                        <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Rendez-vous patient</p>
                        <p className="mt-2 text-xl font-bold text-foreground">{selectedPatientAppointments.length}</p>
                        <p className="mt-1 text-xs text-muted-foreground">Programmes avec ce patient</p>
                      </div>
                      <div className="rounded-2xl border border-white/70 bg-white/80 p-4">
                        <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Dernier statut</p>
                        <p className="mt-2 text-sm font-semibold text-foreground">
                          {selectedPatientAppointments[0]
                            ? getAppointmentStatusLabel(selectedPatientAppointments[0].status)
                            : "Aucun"}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">Suivi agenda</p>
                      </div>
                      <div className="rounded-2xl border border-white/70 bg-white/80 p-4">
                        <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Canal</p>
                        <p className="mt-2 text-sm font-semibold text-foreground">Conversation clinique</p>
                        <p className="mt-1 text-xs text-muted-foreground">Messagerie et planification</p>
                      </div>
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="grid gap-4 p-4 xl:grid-cols-2">
                  <div className="rounded-3xl border border-primary/10 bg-[linear-gradient(180deg,rgba(239,246,255,0.65),rgba(255,255,255,0.96))] p-5 xl:col-span-2">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-base font-semibold text-foreground">Plan de rendez-vous clinique</p>
                        <p className="mt-1 text-sm leading-6 text-muted-foreground">
                          Proposition professionnelle de suivi avec un maximum de 3 rendez-vous structures, duree de consultation et objectif clinique.
                        </p>
                      </div>
                      <div className="rounded-2xl bg-primary/10 p-3 text-primary">
                        <CalendarClock className="h-5 w-5" />
                      </div>
                    </div>
                    <div className="mt-4 grid gap-3 xl:grid-cols-3">
                      {appointmentDrafts.map((item, index) => (
                        <div
                          key={item.slot}
                          className={`rounded-2xl border p-4 shadow-sm ${
                            item.date && item.time ? "border-primary/20 bg-white" : "border-border/70 bg-background/85"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-sm font-semibold text-foreground">{item.slot}</p>
                            <Badge variant="secondary" className="rounded-full">{item.duration}</Badge>
                          </div>
                          <p className="mt-2 text-xs font-medium uppercase tracking-[0.18em] text-primary/80">{item.timing}</p>
                          <p className="mt-3 text-sm font-medium text-foreground">{item.title}</p>
                          <p className="mt-2 text-xs leading-5 text-muted-foreground">{item.desc}</p>
                          <div className="mt-4 grid gap-3">
                            <label className="space-y-2 text-xs text-muted-foreground">
                              <span>Date de consultation</span>
                              <Input
                                type="date"
                                value={item.date}
                                min={minDate}
                                onChange={(e) => handleAppointmentDraftChange(index, "date", e.target.value)}
                              />
                            </label>
                            <label className="space-y-2 text-xs text-muted-foreground">
                              <span>Heure de consultation</span>
                              <Input
                                type="time"
                                value={item.time}
                                min={item.date === minDate ? minTime : undefined}
                                onChange={(e) => handleAppointmentDraftChange(index, "time", e.target.value)}
                              />
                            </label>
                            <label className="space-y-2 text-xs text-muted-foreground">
                              <span>Duree de consultation</span>
                              <Input
                                value={item.duration}
                                onChange={(e) => handleAppointmentDraftChange(index, "duration", e.target.value)}
                                placeholder="Exemple: 45 min"
                              />
                            </label>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="mt-4 rounded-xl border border-dashed border-primary/20 bg-primary/5 p-3">
                      <p className="text-xs font-medium text-foreground">Cadre recommande</p>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        Limiter a trois rendez-vous initiaux permet de structurer la prise en charge, clarifier le stade clinique, coordonner la famille et ajuster les decisions therapeutiques sans surcharger le patient.
                      </p>
                    </div>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <Button type="button" variant="outline" className="w-full" onClick={handleInsertAppointmentPlan}>
                        Inserer le plan de rendez-vous
                      </Button>
                      <Button
                        type="button"
                        className="w-full"
                        onClick={handleScheduleAppointments}
                        disabled={createAppointmentsMutation.isPending}
                      >
                        {createAppointmentsMutation.isPending ? (
                          <span className="flex items-center gap-2">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Enregistrement...
                          </span>
                        ) : (
                          "Programmer et envoyer au patient"
                        )}
                      </Button>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-border bg-white/85 p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-foreground">Partage du scan</p>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                          Preparez les informations a transmettre avant relecture ou teleconsultation.
                        </p>
                      </div>
                      <div className="rounded-xl bg-primary/10 p-2 text-primary">
                        <ScanLine className="h-4 w-4" />
                      </div>
                    </div>
                    <div className="mt-4 space-y-2">
                      {scanShareChecklist.map((item) => (
                        <div key={item} className="flex items-center gap-2 text-sm text-muted-foreground">
                          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                          <span>{item}</span>
                        </div>
                      ))}
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      className="mt-4 w-full justify-between"
                      onClick={() =>
                        appendToComposer(
                          `Partage du scan confirme pour ${selectedConversation.patient.name}.\nMerci de verifier l'IRM jointe et le contexte clinique transmis.`
                        )
                      }
                    >
                      Ajouter au message
                      <ArrowUpRight className="h-4 w-4" />
                    </Button>
                  </div>

                  <div className="rounded-2xl border border-border bg-white/85 p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-foreground">Envoi du rapport</p>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                          Preparez une synthese a envoyer au patient.
                        </p>
                      </div>
                      <div className="rounded-xl bg-primary/10 p-2 text-primary">
                        <FileText className="h-4 w-4" />
                      </div>
                    </div>
                    <Textarea
                      value={reportNote}
                      onChange={(e) => setReportNote(e.target.value)}
                      placeholder="Resume du rapport, interpretation et prochaines etapes..."
                      className="mt-4 min-h-[110px] bg-background/80"
                    />
                    <Button type="button" className="mt-4 w-full" onClick={handleInsertReport}>
                      Inserer le rapport dans le message
                    </Button>
                  </div>

                  <div className="rounded-2xl border border-border bg-white/85 p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-foreground">Demande d'avis</p>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                          Rassemblez les points a soumettre pour un second avis.
                        </p>
                      </div>
                      <div className="rounded-xl bg-primary/10 p-2 text-primary">
                        <Stethoscope className="h-4 w-4" />
                      </div>
                    </div>
                    <Textarea
                      value={secondOpinionRequest}
                      onChange={(e) => setSecondOpinionRequest(e.target.value)}
                      placeholder="Question clinique, doute diagnostique, points a arbitrer..."
                      className="mt-4 min-h-[110px] bg-background/80"
                    />
                    <Button type="button" variant="secondary" className="mt-4 w-full" onClick={handleInsertSecondOpinion}>
                      Inserer la demande d'avis
                    </Button>
                  </div>

                  <div className="rounded-2xl border border-border bg-white/85 p-4 shadow-sm xl:col-span-2">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-foreground">Module Aidant/Famille</p>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                          Facilitez la coordination entre l'equipe medicale et les proches referents avec un acces encadre aux informations utiles, aux rendez-vous, aux consignes de prise en charge et au suivi a domicile.
                        </p>
                      </div>
                      <div className="rounded-xl bg-primary/10 p-2 text-primary">
                        <Users className="h-4 w-4" />
                      </div>
                    </div>
                    <div className="mt-4 space-y-2">
                      {familySupportChecklist.map((item) => (
                        <div key={item} className="flex items-center gap-2 text-sm text-muted-foreground">
                          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                          <span>{item}</span>
                        </div>
                      ))}
                    </div>
                    <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      {familyCoordinationFeatures.map((item) => {
                        const Icon = item.icon;
                        return (
                          <div key={item.title} className="rounded-xl border border-border bg-background/80 p-3">
                            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                              <Icon className="h-4 w-4" />
                            </div>
                            <p className="mt-3 text-sm font-medium text-foreground">{item.title}</p>
                            <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.desc}</p>
                          </div>
                        );
                      })}
                    </div>
                    <Textarea
                      value={familyGuidance}
                      onChange={(e) => setFamilyGuidance(e.target.value)}
                      placeholder="Consignes pour la famille, surveillance a domicile, rappel des rendez-vous, points d'alerte..."
                      className="mt-4 min-h-[110px] bg-background/80"
                    />
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      <Button type="button" variant="outline" className="w-full" onClick={handleInsertFamilyGuidance}>
                        Inserer le message aidant/famille
                      </Button>
                      <Button type="button" className="w-full" onClick={handleInsertFamilyCoordinationPlan}>
                        Inserer le plan de coordination
                      </Button>
                    </div>
                    <div className="mt-3 rounded-xl border border-dashed border-primary/20 bg-primary/5 p-3">
                      <p className="text-xs font-medium text-foreground">Fonctions professionnelles recommandees</p>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        Proches referents, partage securise des documents, calendrier de prise en charge,
                        journal d'observation a domicile et alertes ciblees pour les situations sensibles.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <div className={`grid gap-6 ${showDoctorAgenda ? "xl:grid-cols-[minmax(0,1.45fr)_minmax(340px,0.95fr)]" : ""}`}>
                <Card className="flex h-[680px] min-w-0 flex-col overflow-hidden border-border/70 shadow-[0_22px_60px_-38px_rgba(15,23,42,0.45)]">
                  <CardHeader className="border-b bg-[linear-gradient(180deg,rgba(248,250,252,0.95),rgba(255,255,255,0.95))]">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <CardTitle className="flex items-center gap-3">
                        <MessageCircle className="h-5 w-5 text-primary" />
                        <div>
                          <p className="font-medium">Fil d'echange clinique</p>
                          <p className="text-sm text-muted-foreground">
                            Conversation directe avec {selectedConversation.patient.name}
                          </p>
                        </div>
                      </CardTitle>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setShowDoctorAgenda((current) => !current)}
                      >
                        {showDoctorAgenda ? "Masquer l'agenda" : "Afficher l'agenda"}
                      </Button>
                    </div>
                  </CardHeader>

                  <CardContent className="flex min-h-0 flex-1 flex-col p-0">
                    <ScrollArea className="min-h-0 flex-1 bg-[linear-gradient(180deg,rgba(248,250,252,0.68),rgba(255,255,255,0.98))] p-4">
                      {messagesLoading ? (
                        <div className="flex justify-center py-8">
                          <Loader2 className="h-6 w-6 animate-spin" />
                        </div>
                      ) : messages.length === 0 ? (
                        <div className="py-8 text-center text-muted-foreground">
                          <MessageCircle className="mx-auto mb-2 h-8 w-8 opacity-50" />
                          <p>Aucun message dans cette conversation</p>
                          <p className="mt-1 text-xs">Demarrez la conversation avec le patient</p>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          {messages.map((message) => (
                            <div
                              key={message._id}
                              className={`flex ${
                                message.sender._id === user?.id ? "justify-end" : "justify-start"
                              }`}
                            >
                              <div className={`flex max-w-[76%] flex-col ${message.sender._id === user?.id ? "items-end" : "items-start"}`}>
                              <div
                                className={`whitespace-pre-wrap rounded-2xl px-4 py-3 shadow-sm ${
                                  message.sender._id === user?.id
                                    ? "bg-primary text-primary-foreground"
                                    : "border border-border/70 bg-white"
                                }`}
                              >
                                <p className="text-sm">{message.content}</p>
                              </div>
                              <p className="mt-2 px-1 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                                {message.sender._id === user?.id ? "Vous" : selectedConversation.patient.name} • {formatTime(message.createdAt)}
                              </p>
                              </div>
                            </div>
                          ))}
                          <div ref={messagesEndRef} />
                        </div>
                      )}
                    </ScrollArea>

                    <div className="border-t p-4">
                      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span className="rounded-full bg-muted px-2.5 py-1">Entrée pour envoyer</span>
                        <span className="rounded-full bg-muted px-2.5 py-1">Maj + Entrée pour une nouvelle ligne</span>
                      </div>
                      <div className="flex gap-2">
                        <Textarea
                          value={newMessage}
                          onChange={(e) => setNewMessage(e.target.value)}
                          placeholder="Tapez votre reponse, ou utilisez les modules ci-dessus pour pre-remplir le message..."
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                              e.preventDefault();
                              handleSendMessage();
                            }
                          }}
                          className="min-h-[92px] flex-1 resize-none"
                        />
                        <Button
                          onClick={handleSendMessage}
                          disabled={!newMessage.trim() || sendMessageMutation.isPending}
                          size="icon"
                          className="h-auto min-h-[92px] rounded-xl"
                        >
                          {sendMessageMutation.isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Send className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {showDoctorAgenda && (
                  <Card className="h-fit overflow-hidden border-border/70 xl:sticky xl:top-6">
                    <CardHeader className="border-b bg-[linear-gradient(180deg,rgba(248,250,252,0.95),rgba(255,255,255,0.95))]">
                      <CardTitle className="flex items-center gap-3">
                        <CalendarClock className="h-5 w-5 text-primary" />
                        <div>
                          <p className="font-medium">Agenda du medecin</p>
                          <p className="text-sm text-muted-foreground">
                            Visualisez les rendez-vous deja programmes pour eviter tout chevauchement.
                          </p>
                        </div>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3 p-4">
                      {selectedPatientAppointments.length > 0 && (
                        <div className="rounded-2xl border border-primary/15 bg-primary/5 p-4">
                          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Focus patient</p>
                          <p className="mt-2 text-sm font-semibold text-foreground">{selectedConversation.patient.name}</p>
                          <p className="mt-1 text-xs leading-5 text-muted-foreground">
                            {selectedPatientAppointments.length} rendez-vous deja relies a cette conversation.
                          </p>
                        </div>
                      )}
                      {appointmentsLoading ? (
                        <div className="flex justify-center py-6">
                          <Loader2 className="h-6 w-6 animate-spin text-primary" />
                        </div>
                      ) : doctorScheduledAppointments.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-border p-4 text-sm text-muted-foreground">
                          Aucun rendez-vous programme pour le moment.
                        </div>
                      ) : (
                        doctorScheduledAppointments.map((appointment) => (
                          <div
                            key={appointment._id}
                            className={`rounded-2xl border p-4 ${
                              appointment.patient?._id === selectedConversation.patient._id ||
                              appointment.patient?.email === selectedConversation.patient.email
                                ? "border-primary/20 bg-primary/[0.05]"
                                : "border-border bg-muted/20"
                            }`}
                          >
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div>
                                <p className="text-sm font-semibold text-foreground">{getAppointmentPatientName(appointment)}</p>
                                <p className="mt-1 text-xs text-muted-foreground">{appointment.title}</p>
                              </div>
                              <Badge className={`rounded-full border ${getAppointmentStatusClasses(appointment.status)}`}>
                                {getAppointmentStatusLabel(appointment.status)}
                              </Badge>
                            </div>
                            <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
                              <p>Date: <span className="font-medium text-foreground">{appointment.scheduledDate}</span></p>
                              <p>Debut: <span className="font-medium text-foreground">{appointment.startTime}</span></p>
                              <p>Fin: <span className="font-medium text-foreground">{appointment.endTime}</span></p>
                            </div>
                            <div className="mt-2 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                              <p>Duree: <span className="font-medium text-foreground">{appointment.durationMinutes} min</span></p>
                              <p>Stade actuel: <span className="font-medium text-foreground">{getAppointmentPrediction(appointment)}</span></p>
                            </div>
                            <div className="mt-4 grid gap-3 lg:grid-cols-3">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                  updateAppointmentStatusMutation.mutate({
                                    appointmentId: appointment._id,
                                    status: "confirmed",
                                  })
                                }
                              >
                                Confirmer
                              </Button>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                  updateAppointmentStatusMutation.mutate({
                                    appointmentId: appointment._id,
                                    status: "cancelled",
                                  })
                                }
                              >
                                Annuler
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                onClick={() =>
                                  rescheduleAppointmentMutation.mutate({
                                    appointmentId: appointment._id,
                                    date: rescheduleDrafts[appointment._id]?.date || appointment.scheduledDate,
                                    time: rescheduleDrafts[appointment._id]?.time || appointment.startTime,
                                    duration: rescheduleDrafts[appointment._id]?.duration || `${appointment.durationMinutes}`,
                                  })
                                }
                              >
                                Reporter
                              </Button>
                            </div>
                            <div className="mt-4 grid gap-3 lg:grid-cols-3">
                              <Input
                                type="date"
                                min={minDate}
                                value={rescheduleDrafts[appointment._id]?.date ?? appointment.scheduledDate}
                                onChange={(e) => handleRescheduleDraftChange(appointment._id, "date", e.target.value)}
                              />
                              <Input
                                type="time"
                                min={(rescheduleDrafts[appointment._id]?.date ?? appointment.scheduledDate) === minDate ? minTime : undefined}
                                value={rescheduleDrafts[appointment._id]?.time ?? appointment.startTime}
                                onChange={(e) => handleRescheduleDraftChange(appointment._id, "time", e.target.value)}
                              />
                              <Input
                                value={rescheduleDrafts[appointment._id]?.duration ?? `${appointment.durationMinutes}`}
                                onChange={(e) => handleRescheduleDraftChange(appointment._id, "duration", e.target.value)}
                                placeholder="45"
                              />
                            </div>
                          </div>
                        ))
                      )}
                    </CardContent>
                  </Card>
                )}
              </div>

              <Card className="overflow-hidden border-border/70 shadow-[0_22px_60px_-38px_rgba(15,23,42,0.45)]">
                <CardHeader className="border-b bg-[linear-gradient(180deg,rgba(248,250,252,0.95),rgba(255,255,255,0.95))]">
                  <CardTitle className="flex items-center gap-3">
                    <BookOpen className="h-5 w-5 text-primary" />
                    <div>
                      <p className="font-medium">Ressources cliniques</p>
                      <p className="text-sm text-muted-foreground">
                        Liens utiles pour aider a interpreter le stade de la maladie et la conduite a tenir.
                      </p>
                    </div>
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid gap-3 p-4">
                  {doctorResourceLinks.map((resource) => (
                    <a
                      key={resource.href}
                      href={resource.href}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-2xl border border-border bg-white/85 p-4 transition-colors hover:border-primary/30 hover:bg-primary/5"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-foreground">{resource.title}</p>
                          <p className="mt-2 text-xs leading-5 text-muted-foreground">{resource.desc}</p>
                        </div>
                        <ExternalLink className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      </div>
                    </a>
                  ))}
                </CardContent>
              </Card>
            </div>
          ) : (
            <Card className="flex h-[680px] items-center justify-center border-border/70 bg-[linear-gradient(180deg,rgba(248,250,252,0.92),rgba(255,255,255,0.98))]">
              <div className="text-center">
                <User className="mx-auto mb-4 h-16 w-16 text-muted-foreground" />
                <h3 className="mb-2 text-lg font-medium">Selectionnez un patient</h3>
                <p className="text-muted-foreground">Choisissez un patient pour voir votre conversation</p>
              </div>
            </Card>
          )}
        </div>
      </div>
      </div>
    </div>
  );
};

export default DoctorConversationsPage;
