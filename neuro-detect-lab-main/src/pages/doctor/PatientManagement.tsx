import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Search, ChevronRight, Loader2, Filter, Users, CalendarClock } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { getPatients } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import EmptyState from "@/components/ui/empty-state";

interface PatientRecord {
  _id: string;
  name: string;
  age: number;
  symptoms: string[];
  prediction: string;
  createdAt: string;
}

const riskBadge: Record<string, string> = {
  Low: "bg-severity-healthy/10 text-severity-healthy",
  Medium: "bg-severity-mild/10 text-severity-mild",
  High: "bg-severity-severe/10 text-severity-severe",
  Pending: "bg-muted text-muted-foreground",
};

// Risk from the diagnosis VALIDATED by the doctor; none yet -> "Pending" (never guessed)
const getRiskLevel = (prediction?: string | null): string => {
  switch (prediction) {
    case "Non Demented":
      return "Low";
    case "Very Mild Demented":
      return "Low";
    case "Mild Demented":
      return "Medium";
    case "Moderate Demented":
    case "Severe Demented":
      return "High";
    default:
      return "Pending";
  }
};

const PatientManagement = () => {
  const [search, setSearch] = useState("");
  const [riskFilter, setRiskFilter] = useState("all");
  const [recentFilter, setRecentFilter] = useState("all");
  const navigate = useNavigate();
  const { user } = useAuth();

  const { data: patients = [], isLoading, error } = useQuery({
    queryKey: ["patients", user?.token],
    queryFn: () => getPatients(user?.token || ""),
    enabled: !!user?.token,
  });

  if (error) {
    toast.error("Failed to load patients");
  }

  const filtered = useMemo(() => {
    return (patients as PatientRecord[]).filter((patient) => {
      const term = search.trim().toLowerCase();
      const risk = getRiskLevel(patient.prediction);
      const matchesSearch = !term || (
        patient.name.toLowerCase().includes(term) ||
        patient.prediction?.toLowerCase().includes(term) ||
        patient.symptoms?.some((symptom) => symptom.toLowerCase().includes(term))
      );
      const matchesRisk = riskFilter === "all" || risk.toLowerCase() === riskFilter;
      const matchesRecent = recentFilter === "all" || (() => {
        const createdAt = new Date(patient.createdAt).getTime();
        const now = Date.now();
        const diffDays = Math.floor((now - createdAt) / (1000 * 60 * 60 * 24));
        if (recentFilter === "7d") return diffDays <= 7;
        if (recentFilter === "30d") return diffDays <= 30;
        return true;
      })();

      return matchesSearch && matchesRisk && matchesRecent;
    });
  }, [patients, recentFilter, riskFilter, search]);

  const typedPatients = patients as PatientRecord[];
  const counts = {
    total: typedPatients.length,
    highRisk: typedPatients.filter((patient) => getRiskLevel(patient.prediction) === "High").length,
    newThisMonth: typedPatients.filter((patient) => {
      const monthAgo = new Date();
      monthAgo.setMonth(monthAgo.getMonth() - 1);
      return new Date(patient.createdAt) > monthAgo;
    }).length,
  };

  return (
    <div className="p-6">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mb-6">
        <h1 className="font-display text-2xl font-bold text-foreground">Patient Management</h1>
        <p className="text-sm text-muted-foreground mt-1">Search, filter, and manage your patients.</p>
      </motion.div>

      <div className="mb-4 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-2xl border border-border bg-card p-4 shadow-card">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name, symptom, or diagnosis..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="rounded-xl pl-9"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2">
                <Filter className="h-4 w-4 text-muted-foreground" />
                <select
                  aria-label="Filter by risk"
                  value={riskFilter}
                  onChange={(e) => setRiskFilter(e.target.value)}
                  className="bg-transparent text-sm text-foreground outline-none"
                >
                  <option value="all">All risks</option>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="pending">En attente</option>
                </select>
              </div>
              <div className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2">
                <CalendarClock className="h-4 w-4 text-muted-foreground" />
                <select
                  aria-label="Filter by recency"
                  value={recentFilter}
                  onChange={(e) => setRecentFilter(e.target.value)}
                  className="bg-transparent text-sm text-foreground outline-none"
                >
                  <option value="all">Any date</option>
                  <option value="7d">Last 7 days</option>
                  <option value="30d">Last 30 days</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
          <div className="rounded-2xl border border-border bg-card p-4 shadow-card">
            <p className="text-xs text-muted-foreground">Total patients</p>
            <p className="mt-1 text-2xl font-bold text-foreground">{counts.total}</p>
          </div>
          <div className="rounded-2xl border border-border bg-card p-4 shadow-card">
            <p className="text-xs text-muted-foreground">High risk</p>
            <p className="mt-1 text-2xl font-bold text-red-500">{counts.highRisk}</p>
          </div>
          <div className="rounded-2xl border border-border bg-card p-4 shadow-card">
            <p className="text-xs text-muted-foreground">New this month</p>
            <p className="mt-1 text-2xl font-bold text-primary">{counts.newThisMonth}</p>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="rounded-2xl border border-border bg-card shadow-card overflow-hidden">
          <div className="grid grid-cols-[1fr_1fr_80px_80px_40px] gap-4 px-5 py-3 border-b border-border bg-muted/30 text-xs font-medium text-muted-foreground">
            <span>Name</span>
            <span>Symptoms</span>
            <span>Age</span>
            <span>Risk</span>
            <span></span>
          </div>
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="grid grid-cols-[1fr_1fr_80px_80px_40px] gap-4 px-5 py-4 items-center border-b border-border last:border-0 animate-pulse">
              <div className="h-4 w-28 rounded bg-muted" />
              <div className="h-4 w-40 rounded bg-muted" />
              <div className="h-4 w-10 rounded bg-muted" />
              <div className="h-6 w-14 rounded-full bg-muted" />
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-card shadow-card overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-[1fr_1fr_80px_80px_40px] gap-4 px-5 py-3 border-b border-border bg-muted/30 text-xs font-medium text-muted-foreground">
            <span>Name</span>
            <span>Symptoms</span>
            <span>Age</span>
            <span>Risk</span>
            <span></span>
          </div>

          {filtered.map((p: PatientRecord, i: number) => (
            <motion.button
              key={p._id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: i * 0.03 }}
              onClick={() => navigate(`/doctor/patients/${p._id}`)}
              className="grid grid-cols-[1fr_1fr_80px_80px_40px] gap-4 px-5 py-3.5 items-center w-full text-left border-b border-border last:border-0 hover:bg-muted/30 transition-colors"
            >
              <span className="text-sm font-medium text-foreground truncate">{p.name}</span>
              <span className="text-xs text-muted-foreground truncate">
                {p.symptoms?.length > 0 ? p.symptoms.join(", ") : "No symptoms"}
              </span>
              <span className="text-xs text-muted-foreground">{p.age}</span>
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full w-fit ${riskBadge[getRiskLevel(p.prediction)]}`}>
                {getRiskLevel(p.prediction)}
              </span>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </motion.button>
          ))}

          {filtered.length === 0 && (
            <div className="p-6">
              <EmptyState
                icon={<Users className="h-5 w-5" />}
                title={typedPatients.length === 0 ? "No patients yet" : "No patient matches these filters"}
                description={typedPatients.length === 0
                  ? "New MRI analyses will appear here as soon as patients submit scans."
                  : "Try removing one filter or searching with a broader keyword."}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default PatientManagement;
