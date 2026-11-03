import { motion } from "framer-motion";
import { Users, ScanLine, Activity, TrendingUp, Loader2 } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { getPatientUsers, getPatients, getHistory } from "@/lib/api";
import { toast } from "sonner";

interface PatientUser {
  _id: string;
  username: string;
  email: string;
}

interface PatientRecord {
  _id: string;
  name: string;
  age: number;
  symptoms: string[];
  prediction: string;
  createdAt: string;
}

interface ScanRecord {
  id: string;
  date: string;
  prediction: string;
  probabilities: Record<string, number>;
  heatmap_url: string;
  explanation: string;
  createdAt?: string;
}

const getRiskLevel = (prediction: string): string => {
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
      return "Medium";
  }
};

const StatCard = ({ icon, label, value, delay }: { icon: React.ReactNode; label: string; value: string; delay: number }) => (
  <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay }}
    className="rounded-2xl border border-border bg-card p-5 shadow-card">
    <div className="flex items-center gap-3">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">{icon}</div>
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-lg font-bold font-display text-foreground">{value}</p>
      </div>
    </div>
  </motion.div>
);

const DoctorOverview = () => {
  const { user } = useAuth();

  const { data: patientUsers = [], isLoading: usersLoading, error: usersError } = useQuery({
    queryKey: ["patient-users", user?.token],
    queryFn: () => getPatientUsers(user?.token || ""),
    enabled: !!user?.token,
  });

  const { data: patients = [], isLoading: patientsLoading, error: patientsError } = useQuery({
    queryKey: ["patients", user?.token],
    queryFn: () => getPatients(user?.token || ""),
    enabled: !!user?.token,
  });

  const { data: scans = [], isLoading: scansLoading, error: scansError } = useQuery({
    queryKey: ["history", user?.token],
    queryFn: () => getHistory(user?.token || ""),
    enabled: !!user?.token,
  });

  if (usersError || patientsError || scansError) {
    toast.error("Failed to load dashboard data");
  }

  const isLoading = usersLoading || patientsLoading || scansLoading;

  // Distribution COUNTED from the patients' stored predictions (the old chart used Math.random)
  const countPrediction = (label: string) =>
    (patients as PatientRecord[]).filter((patient) => patient.prediction === label).length;
  const distribution = [
    { name: "Non Demented", value: countPrediction("Non Demented"), color: "hsl(142,71%,45%)" },
    { name: "Very Mild", value: countPrediction("Very Mild Demented"), color: "hsl(48,96%,53%)" },
    { name: "Mild", value: countPrediction("Mild Demented"), color: "hsl(25,95%,53%)" },
    { name: "Moderate", value: countPrediction("Moderate Demented"), color: "hsl(0,72%,51%)" },
  ];

  const highRiskCount = (patients as PatientRecord[]).filter((patient) => getRiskLevel(patient.prediction) === "High").length;
  const recentPatients = patients.slice(0, 4);
  const prioritizedPatients = [...(patients as PatientRecord[])]
    .sort((left, right) => {
      const riskOrder = { High: 3, Medium: 2, Low: 1 };
      const riskDelta =
        (riskOrder[getRiskLevel(right.prediction) as keyof typeof riskOrder] ?? 0) -
        (riskOrder[getRiskLevel(left.prediction) as keyof typeof riskOrder] ?? 0);

      if (riskDelta !== 0) return riskDelta;
      return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
    })
    .slice(0, 5);

  return (
    <div className="p-6 space-y-6">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="font-display text-2xl font-bold text-foreground">Welcome, {user?.name} 👋</h1>
        <p className="text-sm text-muted-foreground mt-1">Clinical overview and patient activity.</p>
      </motion.div>

      {isLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard icon={<Users className="h-5 w-5 text-primary" />} label="Total Patients" value={String(patientUsers.length)} delay={0.1} />
            <StatCard icon={<ScanLine className="h-5 w-5 text-primary" />} label="Total Scans" value={String(scans.length)} delay={0.15} />
            <StatCard icon={<Activity className="h-5 w-5 text-primary" />} label="High Risk" value={String(highRiskCount)} delay={0.2} />
            <StatCard icon={<TrendingUp className="h-5 w-5 text-primary" />} label="This Month" value={String(patients.filter((p: PatientRecord) => {
              const monthAgo = new Date();
              monthAgo.setMonth(monthAgo.getMonth() - 1);
              return new Date(p.createdAt) > monthAgo;
            }).length)} delay={0.25} />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            {/* Distribution */}
            <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
              className="rounded-2xl border border-border bg-card p-6 shadow-card">
              <h3 className="mb-4 text-sm font-semibold text-foreground">Detection Distribution</h3>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={distribution} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={85} innerRadius={50} strokeWidth={2}>
                    {distribution.map((e) => <Cell key={e.name} fill={e.color} />)}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: "0.75rem", border: "1px solid hsl(214,20%,90%)", fontSize: "0.75rem" }} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap justify-center gap-3 mt-2">
                {distribution.map((d) => (
                  <div key={d.name} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <div className={`h-2.5 w-2.5 rounded-full ${
                      d.name === "Non Demented" ? "bg-severity-healthy" :
                      d.name === "Very Mild" ? "bg-severity-mild" :
                      d.name === "Mild" ? "bg-severity-moderate" :
                      "bg-severity-severe"
                    }`} />
                    {d.name}
                  </div>
                ))}
              </div>
            </motion.div>

            {/* Recent Activity */}
            <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}
              className="rounded-2xl border border-border bg-card p-6 shadow-card">
              <h3 className="mb-4 text-sm font-semibold text-foreground">Recent Activity</h3>
              <div className="space-y-3">
                {recentPatients.map((p: PatientUser) => (
                  <div key={p._id} className="flex items-center justify-between rounded-xl bg-muted/40 p-3">
                    <div>
                      <p className="text-sm font-medium text-foreground">{p.username}</p>
                      <p className="text-xs text-muted-foreground">{p.email}</p>
                    </div>
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary">Patient</span>
                  </div>
                ))}
                {recentPatients.length === 0 && (
                  <p className="text-center text-sm text-muted-foreground py-4">No patients yet</p>
                )}
              </div>
            </motion.div>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="rounded-2xl border border-border bg-card p-6 shadow-card"
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Patients a suivre en priorite</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Classement clinique simple selon le niveau de risque et la recence du dossier.
                </p>
              </div>
              <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                Priorisation active
              </span>
            </div>

            <div className="space-y-3">
              {prioritizedPatients.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">Aucun patient prioritaire pour le moment</p>
              ) : (
                prioritizedPatients.map((patient) => {
                  const riskLevel = getRiskLevel(patient.prediction);
                  const riskClasses =
                    riskLevel === "High"
                      ? "bg-red-100 text-red-700"
                      : riskLevel === "Medium"
                        ? "bg-amber-100 text-amber-700"
                        : "bg-emerald-100 text-emerald-700";

                  return (
                    <div key={patient._id} className="rounded-xl border border-border bg-muted/30 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-foreground">{patient.name}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Derniere activite: {new Date(patient.createdAt).toLocaleDateString("fr-FR")}
                          </p>
                        </div>
                        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${riskClasses}`}>
                          {riskLevel}
                        </span>
                      </div>
                      <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                        <p>Prediction: <span className="font-medium text-foreground">{patient.prediction || "Indisponible"}</span></p>
                        <p>Symptomes: <span className="font-medium text-foreground">{patient.symptoms?.length ?? 0}</span></p>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </motion.div>
        </>
      )}
    </div>
  );
};

export default DoctorOverview;
