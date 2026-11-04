import { motion } from "framer-motion";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, LineChart, Line, Legend
} from "recharts";
import { getPatients, getHistory } from "@/lib/api";
import { Loader2 } from "lucide-react";

const tooltipStyle = { borderRadius: "0.75rem", border: "1px solid hsl(214,20%,90%)", fontSize: "0.75rem" };

// Category of the VALIDATED diagnosis (patients without one are counted as "En attente", never as healthy)
const getPredictionCategory = (prediction?: string | null) => {
  if (!prediction) return "En attente";
  const normalized = String(prediction).toLowerCase();
  if (normalized.includes("very mild")) return "Very Mild";
  if (normalized.includes("mild")) return "Mild";
  if (normalized.includes("moderate")) return "Moderate";
  return "Non Demented";
};

const monthLabels = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const buildTrendData = (patients: any[]) => {
  const now = new Date();
  const months = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - (5 - index), 1);
    return { label: `${monthLabels[date.getMonth()]}`, year: date.getFullYear(), count: 0, highRisk: 0 };
  });

  patients.forEach((patient) => {
    const createdAt = new Date(patient.createdAt || patient.createdAtAt || Date.now());
    const monthIndex = months.findIndex((month) => month.year === createdAt.getFullYear() && monthLabels.indexOf(month.label) === createdAt.getMonth());
    if (monthIndex >= 0) {
      months[monthIndex].count += 1;
      const category = getPredictionCategory(patient.prediction);
      if (category === "Moderate") months[monthIndex].highRisk += 1;
    }
  });

  return months.map((month) => ({
    month: month.label,
    scans: month.count,
    detections: month.highRisk,
  }));
};

const AIInsights = () => {
  const { user } = useAuth();

  const { data: patients = [], isLoading: patientsLoading } = useQuery({
    queryKey: ["patients"],
    queryFn: () => getPatients(user?.token || ""),
    enabled: !!user?.token,
  });

  const { data: scans = [], isLoading: scansLoading } = useQuery({
    queryKey: ["scans"],
    queryFn: () => getHistory(user?.token || ""),
    enabled: !!user?.token,
  });

  const metrics = useMemo(() => {
    const totalPatients = patients.length;
    const totalScans = scans.length;
    const highRiskCount = patients.filter((p: any) => {
      const category = getPredictionCategory(p.prediction);
      return category === "Moderate";
    }).length;
    const assignedDoctors = new Set(patients.filter((p: any) => p.assignedDoctor?._id).map((p: any) => p.assignedDoctor._id)).size;
    const monthlyNewPatients = patients.filter((p: any) => {
      const createdAt = new Date(p.createdAt || Date.now());
      const monthAgo = new Date();
      monthAgo.setMonth(monthAgo.getMonth() - 1);
      return createdAt >= monthAgo;
    }).length;

    return [
      { metric: "Total Patients", value: totalPatients, suffix: "" },
      { metric: "Total Scans", value: totalScans, suffix: "" },
      { metric: "High Risk", value: totalPatients ? Math.round((highRiskCount / totalPatients) * 100) : 0, suffix: "%" },
      { metric: "New Patients", value: monthlyNewPatients, suffix: "" },
    ];
  }, [patients, scans]);

  const classDistribution = useMemo(() => {
    const dist: Record<string, number> = {
      "Non Demented": 0,
      "Very Mild": 0,
      "Mild": 0,
      "Moderate": 0,
      "En attente": 0,
    };

    patients.forEach((patient: any) => {
      const category = getPredictionCategory(patient.prediction);
      dist[category] += 1;
    });

    return [
      { name: "Non Demented", value: dist["Non Demented"], color: "hsl(142,71%,45%)" },
      { name: "Very Mild", value: dist["Very Mild"], color: "hsl(48,96%,53%)" },
      { name: "Mild", value: dist["Mild"], color: "hsl(25,95%,53%)" },
      { name: "Moderate", value: dist["Moderate"], color: "hsl(0,72%,51%)" },
      { name: "En attente", value: dist["En attente"], color: "hsl(215,16%,65%)" },
    ];
  }, [patients]);

  const trendData = useMemo(() => buildTrendData(patients), [patients]);

  if (patientsLoading || scansLoading) {
    return (
      <div className="p-6 flex items-center justify-center h-96">
        <div className="flex items-center gap-2">
          <Loader2 className="animate-spin" size={24} />
          <span className="text-muted-foreground">Loading AI insights...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="font-display text-2xl font-bold text-foreground">AI Insights</h1>
        <p className="text-sm text-muted-foreground mt-1">Tous les chiffres sont maintenant calculés à partir de vos données réelles.</p>
      </motion.div>

      <div className="grid gap-4 sm:grid-cols-4">
        {metrics.map((metric, i) => (
          <motion.div
            key={metric.metric}
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="rounded-2xl border border-border bg-card p-5 shadow-card"
          >
            <p className="text-xs text-muted-foreground">{metric.metric}</p>
            <p className="mt-1 font-display text-2xl font-bold text-foreground">
              {metric.value}
              {metric.suffix}
            </p>
          </motion.div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="rounded-2xl border border-border bg-card p-6 shadow-card"
        >
          <h3 className="mb-4 text-sm font-semibold text-foreground">Class Distribution</h3>
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={classDistribution} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} innerRadius={50} strokeWidth={2}>
                {classDistribution.map((e) => <Cell key={e.name} fill={e.color} />)}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex flex-wrap justify-center gap-3 mt-2">
            {classDistribution.map((d) => (
              <div key={d.name} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: d.color }} />
                {d.name} ({d.value})
              </div>
            ))}
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
          className="rounded-2xl border border-border bg-card p-6 shadow-card"
        >
          <h3 className="mb-4 text-sm font-semibold text-foreground">Prediction Distribution</h3>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={classDistribution} barCategoryGap="30%">
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(214,20%,90%)" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip contentStyle={tooltipStyle} />
              <Bar dataKey="value" radius={[8, 8, 0, 0]} fill="hsl(212,72%,48%)" />
            </BarChart>
          </ResponsiveContainer>
        </motion.div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="rounded-2xl border border-border bg-card p-6 shadow-card"
      >
        <h3 className="mb-4 text-sm font-semibold text-foreground">Trends Over Time</h3>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={trendData}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(214,20%,90%)" />
            <XAxis dataKey="month" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip contentStyle={tooltipStyle} />
            <Legend wrapperStyle={{ fontSize: "0.75rem" }} />
            <Line type="monotone" dataKey="scans" stroke="hsl(212,72%,48%)" strokeWidth={2} dot={{ r: 4 }} name="New Patients" />
            <Line type="monotone" dataKey="detections" stroke="hsl(0,72%,51%)" strokeWidth={2} dot={{ r: 4 }} name="High Risk" />
          </LineChart>
        </ResponsiveContainer>
      </motion.div>
    </div>
  );
};

export default AIInsights;
