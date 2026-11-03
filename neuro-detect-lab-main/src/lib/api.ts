import axios from "axios";

export type UserRole = "doctor" | "user";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

const resolveApiBase = () => {
  const defaultApiHost = typeof window !== "undefined"
    ? `${window.location.protocol}//${window.location.hostname}:5000/api`
    : "http://localhost:5000/api";

  const configuredApiUrl = import.meta.env.VITE_API_URL?.trim();
  if (!configuredApiUrl) return defaultApiHost;
  if (typeof window === "undefined") return configuredApiUrl;

  try {
    const configuredUrl = new URL(configuredApiUrl);
    const currentHost = window.location.hostname;

    if (LOCAL_HOSTS.has(configuredUrl.hostname) && !LOCAL_HOSTS.has(currentHost)) {
      configuredUrl.hostname = currentHost;
      configuredUrl.protocol = window.location.protocol;
    }

    return configuredUrl.toString().replace(/\/$/, "");
  } catch {
    return configuredApiUrl;
  }
};

const API_BASE = resolveApiBase();

export const getApiBaseUrl = () => API_BASE;

export interface ModelResult {
  prediction:        string;
  confidence:        number;
  probabilities:     Record<string, number>;
  inference_time_ms: number;
  mode:              "real" | "simulated" | "error";
  description:       string;
  error?:            string;
}

export interface StageRecommendations {
  title: string;
  summary: string;
  lifestyle: string[];
  cognitiveExercises: string[];
  sleep: string[];
  nutrition: string[];
  physicalActivity: string[];
  mentalStimulation: string[];
  dailyRoutine: string[];
  homeSupport: string[];
}

export interface PredictionResponse {
  prediction:    string;
  probabilities: Record<string, number>;
  heatmap_url?:  string;
  explanation?:  string;
  recommendations?: StageRecommendations;
  sentToDoctor?: boolean;
  // Resultats des modeles IA
  best_model?:    string;
  all_models?:    Record<string, ModelResult>;
  ranked_models?: string[];
  total_models?:  number;
  total_time_ms?: number;
}

export interface ReanalyzeResponse extends PredictionResponse {
  message: string;
  patientId: string;
  reanalyzed_at: string;
}

export interface AuthResponse {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  token: string;
}

export interface Patient {
  _id: string;
  name: string;
  age?: number;
  email: string;
  phone?: string;
  symptoms: string[];
  prediction?: string;
  probabilities?: Record<string, number>;
  bestModel?: string | null;
  allModels?: Record<string, ModelResult>;
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
    irmImage?: string | null;
    doctor: {
      _id: string;
      username: string;
      email: string;
    };
  }>;
  createdAt: string;
}

export const loginUser = async (email: string, password: string): Promise<AuthResponse> => {
  const { data } = await axios.post<AuthResponse>(`${API_BASE}/users/login`, { email, password });
  return data;
};

export const registerUser = async (
  name: string,
  email: string,
  password: string,
  role: UserRole,
  doctorKey?: string
): Promise<AuthResponse> => {
  const { data } = await axios.post<AuthResponse>(`${API_BASE}/users/register`, {
    name,
    email,
    password,
    role,
    doctorKey,
  });
  return data;
};

export const predictImage = async (file: File, token?: string): Promise<PredictionResponse> => {
  const form = new FormData();
  form.append("file", file);
  const headers: Record<string, string> = { "Content-Type": "multipart/form-data" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const { data } = await axios.post<PredictionResponse>(`${API_BASE}/predict`, form, { headers });
  return data;
};


export const getHistory = async (token: string) => {
  const { data } = await axios.get(`${API_BASE}/history`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return data;
};

export const getPatients = async (token: string) => {
  const { data } = await axios.get(`${API_BASE}/patients`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return data;
};

export const getPatient = async (id: string, token: string) => {
  const { data } = await axios.get(`${API_BASE}/patient/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return data;
};

export const reanalyzePatientScan = async (
  patientId: string,
  token: string
): Promise<ReanalyzeResponse> => {
  const { data } = await axios.post<ReanalyzeResponse>(
    `${API_BASE}/patient/${patientId}/reanalyze`,
    {},
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return data;
};

/**
 * Recupere uniquement l'image IRM et les metadonnees de scan d'un patient.
 * Endpoint leger dedie: ne charge pas tout le dossier patient.
 */
export interface PatientIrmData {
  _id:           string;
  name:          string;
  irmImage:      string | null;
  lastScanDate:  string | null;
  probabilities: Record<string, number>;
  prediction:    string | null;
  bestModel?:    string | null;
  allModels?:    Record<string, ModelResult>;
  rankedModels?: string[];
  totalModels?:  number;
  explanation?:  string;
  createdAt:     string;
}

export const getPatientIrmImage = async (
  patientId: string,
  token: string
): Promise<PatientIrmData> => {
  const { data } = await axios.get<PatientIrmData>(
    `${API_BASE}/patients/${patientId}/irm`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return data;
};

// Types pour les messages et conversations
export interface Doctor {
  _id: string;
  username: string;
  email: string;
}

export interface Conversation {
  _id: string;
  participants: string[];
  patient: {
    _id: string;
    name: string;
    email: string;
  };
  doctor: {
    _id: string;
    username: string;
    email: string;
  };
  lastMessage?: {
    content: string;
    sender: string;
    createdAt: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  _id: string;
  conversationId: string;
  sender: {
    _id: string;
    username: string;
    email: string;
    role: UserRole;
  };
  receiver: {
    _id: string;
    username: string;
    email: string;
    role: UserRole;
  };
  content: string;
  messageType: "text" | "image" | "file";
  isRead: boolean;
  createdAt: string;
}

export interface Appointment {
  _id: string;
  patient: {
    _id: string;
    name: string;
    email: string;
    prediction?: string;
    lastScanDate?: string | null;
  };
  doctor: {
    _id: string;
    username: string;
    email: string;
  };
  scheduledDate: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  slotLabel: string;
  timingLabel: string;
  title: string;
  description: string;
  status: "scheduled" | "confirmed" | "cancelled" | "rescheduled" | "completed";
  notes?: string;
  createdBy: {
    _id: string;
    username: string;
    email: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface ScientificArticle {
  id: string;
  title: string;
  summary: string;
  journal: string;
  publishedAt: string;
  articleUrl: string;
  authors: string[];
  source: string;
  imageUrl: string;
}

export interface ScientificArticlesResponse {
  articles: ScientificArticle[];
  source: string;
  fallback: boolean;
  fetchedAt: string;
}

export interface AssistantProfile {
  patientName: string;
  age: string;
  diagnosis: string;
  emergencyContact: string;
  emergencyPhone: string;
  dailyNotes: string;
}

export interface FamilyMember {
  id: string;
  name: string;
  relation: string;
  phone: string;
  notes: string;
  imageUrl: string;
}

export interface AssistantReminder {
  id: string;
  title: string;
  time: string;
  details: string;
  done: boolean;
  lastNotifiedOn?: string | null;
}

export interface AssistantDataResponse {
  profile: AssistantProfile;
  familyMembers: FamilyMember[];
  reminders: AssistantReminder[];
}

export interface JournalEntry {
  id: string;
  createdAt: string;
  scanPrediction: string;
  memory: string;
  sleep: string;
  mood: string;
  confusion: string;
  autonomy: string;
  forgetfulness: string;
  fatigue: string;
  riskLevel: string;
  note: string;
}

export interface JournalEntriesResponse {
  entries: JournalEntry[];
}

const journalFallbackStorageKey = (token: string) => `patient-journal-fallback:${token || "anonymous"}`;

const readJournalFallbackEntries = (token: string): JournalEntry[] => {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(journalFallbackStorageKey(token));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const writeJournalFallbackEntries = (token: string, entries: JournalEntry[]) => {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(journalFallbackStorageKey(token), JSON.stringify(entries));
  } catch {
    // Ignore storage write failures and keep the UI responsive.
  }
};

// API pour les messages et conversations
export const getDoctors = async (token: string): Promise<Doctor[]> => {
  const { data } = await axios.get(`${API_BASE}/messages/doctors`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return data;
};

export const getConversations = async (token: string): Promise<Conversation[]> => {
  const { data } = await axios.get(`${API_BASE}/messages/conversations`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return data;
};

export const createConversation = async (
  patientEmail: string,
  doctorId: string,
  token: string
): Promise<Conversation> => {
  const { data } = await axios.post(
    `${API_BASE}/messages/conversations`,
    { patientEmail, doctorId },
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return data;
};

export const getMessages = async (
  conversationId: string,
  token: string
): Promise<Message[]> => {
  const { data } = await axios.get(
    `${API_BASE}/messages/conversations/${conversationId}/messages`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return data;
};

export const sendMessage = async (
  conversationId: string,
  receiverId: string,
  content: string,
  token: string,
  messageType: "text" | "image" | "file" = "text"
): Promise<Message> => {
  try {
    const { data } = await axios.post(
      `${API_BASE}/messages/messages`,
      { conversationId, receiverId, content, messageType },
      { headers: { Authorization: `Bearer ${token}` } }
    );
    return data;
  } catch (error) {
    console.error('Error sending message:', error);
    throw error;
  }
};

export const createAppointments = async (
  payload: {
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
  },
  token: string
): Promise<Appointment[]> => {
  const { data } = await axios.post(`${API_BASE}/appointments`, payload, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return data;
};

export const getDoctorAppointments = async (doctorId: string, token: string): Promise<Appointment[]> => {
  const { data } = await axios.get(`${API_BASE}/appointments/doctor/${doctorId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return data;
};

export const getPatientAppointments = async (token: string): Promise<Appointment[]> => {
  const { data } = await axios.get(`${API_BASE}/appointments/patient/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return data;
};

export const getLatestAlzheimerArticles = async (
  token: string
): Promise<ScientificArticlesResponse> => {
  const { data } = await axios.get<ScientificArticlesResponse>(`${API_BASE}/articles/alzheimer`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return data;
};

export const getPatientAssistantData = async (token: string): Promise<AssistantDataResponse> => {
  const { data } = await axios.get<AssistantDataResponse>(`${API_BASE}/assistant/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return data;
};

export const updatePatientAssistantProfile = async (
  profile: AssistantProfile,
  token: string
): Promise<AssistantDataResponse> => {
  const { data } = await axios.put<AssistantDataResponse>(`${API_BASE}/assistant/profile`, profile, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return data;
};

export const createFamilyMember = async (
  payload: Omit<FamilyMember, "id">,
  token: string
): Promise<AssistantDataResponse> => {
  const { data } = await axios.post<AssistantDataResponse>(`${API_BASE}/assistant/family`, payload, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return data;
};

export const deleteFamilyMember = async (
  memberId: string,
  token: string
): Promise<AssistantDataResponse> => {
  const { data } = await axios.delete<AssistantDataResponse>(`${API_BASE}/assistant/family/${memberId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return data;
};

export const createAssistantReminder = async (
  payload: { title: string; time: string; details: string },
  token: string
): Promise<AssistantDataResponse> => {
  const { data } = await axios.post<AssistantDataResponse>(`${API_BASE}/assistant/reminders`, payload, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return data;
};

export const updateAssistantReminder = async (
  reminderId: string,
  payload: Partial<AssistantReminder>,
  token: string
): Promise<AssistantDataResponse> => {
  const { data } = await axios.patch<AssistantDataResponse>(`${API_BASE}/assistant/reminders/${reminderId}`, payload, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return data;
};

export const deleteAssistantReminder = async (
  reminderId: string,
  token: string
): Promise<AssistantDataResponse> => {
  const { data } = await axios.delete<AssistantDataResponse>(`${API_BASE}/assistant/reminders/${reminderId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return data;
};

export const getPatientJournalEntries = async (token: string): Promise<JournalEntriesResponse> => {
  try {
    const { data } = await axios.get<JournalEntriesResponse>(`${API_BASE}/assistant/journal`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return data;
  } catch {
    return { entries: readJournalFallbackEntries(token) };
  }
};

export const createPatientJournalEntry = async (
  payload: Omit<JournalEntry, "id" | "createdAt">,
  token: string
): Promise<JournalEntriesResponse> => {
  try {
    const { data } = await axios.post<JournalEntriesResponse>(`${API_BASE}/assistant/journal`, payload, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return data;
  } catch {
    const nextEntry: JournalEntry = {
      id:
        typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
          ? crypto.randomUUID()
          : `journal-${Date.now()}`,
      createdAt: new Date().toISOString(),
      scanPrediction: payload.scanPrediction,
      memory: payload.memory,
      sleep: payload.sleep,
      mood: payload.mood,
      confusion: payload.confusion,
      autonomy: payload.autonomy,
      forgetfulness: payload.forgetfulness,
      fatigue: payload.fatigue,
      riskLevel: payload.riskLevel,
      note: payload.note,
    };

    const fallbackEntries = [nextEntry, ...readJournalFallbackEntries(token)].slice(0, 30);
    writeJournalFallbackEntries(token, fallbackEntries);
    return { entries: fallbackEntries };
  }
};

export const updateAppointmentStatus = async (
  appointmentId: string,
  payload: { status: "confirmed" | "cancelled" | "completed"; notes?: string },
  token: string
): Promise<Appointment> => {
  const { data } = await axios.patch(`${API_BASE}/appointments/${appointmentId}/status`, payload, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return data;
};

export const rescheduleAppointment = async (
  appointmentId: string,
  payload: { date: string; time: string; duration?: string; notes?: string },
  token: string
): Promise<Appointment> => {
  const { data } = await axios.patch(`${API_BASE}/appointments/${appointmentId}/reschedule`, payload, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return data;
};

export const markMessageAsRead = async (
  messageId: string,
  token: string
): Promise<void> => {
  await axios.put(
    `${API_BASE}/messages/messages/${messageId}/read`,
    {},
    { headers: { Authorization: `Bearer ${token}` } }
  );
};

export const assignDoctorToPatient = async (
  patientEmail: string,
  doctorId: string,
  token: string
) => {
  const { data } = await axios.put(
    `${API_BASE}/messages/patients/assign-doctor`,
    { patientEmail, doctorId },
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return data;
};

export const updatePatient = async (
  patientId: string,
  patientData: any,
  token: string
) => {
  const { data } = await axios.put(
    `${API_BASE}/patients/${patientId}`,
    patientData,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return data;
};

export const getPatientCount = async (token: string): Promise<{ count: number }> => {
  const { data } = await axios.get(`${API_BASE}/users/patient-count`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return data;
};

export const getPatientsByDoctor = async (doctorId: string, token: string): Promise<Patient[]> => {
  const { data } = await axios.get(`${API_BASE}/patients/doctor/${doctorId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return data;
};

export const getPatientUsers = async (token: string): Promise<User[]> => {
  const { data } = await axios.get(`${API_BASE}/users/patient-users`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return data;
};

