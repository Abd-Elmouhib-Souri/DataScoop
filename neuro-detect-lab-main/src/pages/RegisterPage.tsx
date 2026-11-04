import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Brain, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { useAuth, type UserRole } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const RegisterPage = () => {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");   // typing it twice catches typos before the account exists
  const [showPassword, setShowPassword] = useState(false);
  const [role, setRole] = useState<UserRole>("user");
  const [doctorKey, setDoctorKey] = useState("");
  const [showDoctorKey, setShowDoctorKey] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !email) { toast.error("All fields required"); return; }
    // Same rules as the server (which re-checks them): 8+ characters, both entries identical
    if (password.length < 8) { toast.error("Mot de passe : 8 caractères minimum"); return; }
    if (password !== confirmPassword) { toast.error("Les deux mots de passe ne correspondent pas"); return; }
    if (role === "doctor" && !doctorKey.trim()) { toast.error("Code d'invitation médecin requis"); return; }
    setLoading(true);
    try {
      await register(name, email, password, role, doctorKey);
      navigate(role === "doctor" ? "/doctor" : "/patient");
      toast.success("Account created!");
    } catch (error: any) {
      const msg = error.response?.data?.message || "Registration failed";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center gradient-hero px-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-elevated"
      >
        <div className="mb-6 flex flex-col items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl gradient-medical">
            <Brain className="h-6 w-6 text-primary-foreground" />
          </div>
          <h1 className="font-display text-xl font-bold text-foreground">Create Account</h1>
          <p className="text-xs text-muted-foreground">Join the DataScoop platform</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-foreground">Full Name</Label>
            <Input placeholder="Dr. Sarah Mitchell" value={name} onChange={(e) => setName(e.target.value)} className="rounded-xl" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-foreground">Email</Label>
            <Input type="email" placeholder="email@example.com" value={email} onChange={(e) => setEmail(e.target.value)} className="rounded-xl" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-foreground">Password</Label>
            <div className="relative">
              <Input 
                type={showPassword ? "text" : "password"} 
                placeholder="••••••••" 
                value={password} 
                onChange={(e) => setPassword(e.target.value)} 
                className="rounded-xl pr-10" 
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-foreground">Confirmer le mot de passe</Label>
            <Input
              type={showPassword ? "text" : "password"}
              placeholder="••••••••"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="rounded-xl"
            />
            {confirmPassword && confirmPassword !== password && (
              <p className="text-[11px] text-destructive">Les mots de passe ne correspondent pas.</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-foreground">I am a…</Label>
            <div className="grid grid-cols-2 gap-3">
              {(["user", "doctor"] as UserRole[]).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRole(r)}
                  className={`rounded-xl border p-3 text-xs font-medium transition-all ${
                    role === r
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-card text-muted-foreground hover:border-primary/30"
                  }`}
                >
                  {r === "doctor" ? "🩺 Medical Professional" : "👤 Patient / Family"}
                </button>
              ))}
            </div>
          </div>

          {/* Champ Clé Secrète - Version Pro */}
          {role === "doctor" && (
            <div className="space-y-1.5 p-3 rounded-xl border border-primary/30 bg-primary/5 animate-in fade-in zoom-in duration-300">
              <Label className="text-xs font-semibold text-primary">Code d'invitation médecin</Label>
              <div className="relative">
                <Input 
                  type={showDoctorKey ? "text" : "password"} 
                  placeholder="••••••••" 
                  value={doctorKey} 
                  onChange={(e) => setDoctorKey(e.target.value)}
                  className="rounded-xl border-primary/20 bg-background pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowDoctorKey(!showDoctorKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-primary/60 hover:text-primary transition-colors"
                >
                  {showDoctorKey ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <p className="text-[10px] text-muted-foreground italic">Code à usage unique fourni par l'administrateur de la plateforme.</p>
            </div>
          )}

          <Button type="submit" disabled={loading} className="w-full rounded-xl gradient-medical text-primary-foreground">
            {loading ? "Creating…" : "Create Account"}
          </Button>
        </form>

        <p className="mt-5 text-center text-xs text-muted-foreground">
          Already have an account?{" "}
          <Link to="/login" className="font-medium text-primary hover:underline">Sign in</Link>
        </p>
      </motion.div>
    </div>
  );
};

export default RegisterPage;
