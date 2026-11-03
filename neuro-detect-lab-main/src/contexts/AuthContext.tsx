import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import axios from "axios";
import { loginUser, registerUser } from "@/lib/api";

export type UserRole = "doctor" | "user";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  token: string;
}

interface AuthContextType {
  user: AuthUser | null;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string, role: UserRole, doctorKey?: string) => Promise<void>;
  logout: () => void;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be inside AuthProvider");
  return ctx;
};

// No demo bypass any more: the old code logged anyone in as "doctor@demo.com" when the login failed
// on localhost, with the email as token. Demo accounts now go through the real login (see README).

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem("alz_user");
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as AuthUser;
        // A real token is a JWT (header.payload.signature); anything else is an old session -> drop it
        if (typeof parsed.token === "string" && parsed.token.split(".").length === 3) {
          setUser(parsed);
        } else {
          localStorage.removeItem("alz_user");
        }
      } catch {
        localStorage.removeItem("alz_user");
      }
    }
    setIsLoading(false);

    // Expired/invalid token -> the API answers 401 -> log out instead of showing broken pages
    const interceptor = axios.interceptors.response.use(
      (response) => response,
      (error) => {
        const url: string = error?.config?.url ?? "";
        if (error?.response?.status === 401 && !url.includes("/users/login") && !url.includes("/users/register")) {
          localStorage.removeItem("alz_user");
          setUser(null);
        }
        return Promise.reject(error);
      }
    );
    return () => axios.interceptors.response.eject(interceptor);
  }, []);

  const login = async (email: string, password: string) => {
    const data = await loginUser(email, password);   // a failed login simply throws (no fallback)
    const authUser: AuthUser = {
      id: data.id,
      name: data.name,
      email: data.email,
      role: data.role,
      token: data.token,
    };
    localStorage.setItem("alz_user", JSON.stringify(authUser));
    setUser(authUser);
  };

  const register = async (name: string, email: string, password: string, role: UserRole, doctorKey?: string) => {
    const data = await registerUser(name, email, password, role, doctorKey);
    const authUser: AuthUser = {
      id: data.id,
      name: data.name,
      email: data.email,
      role: data.role,
      token: data.token,
    };
    localStorage.setItem("alz_user", JSON.stringify(authUser));
    setUser(authUser);
  };

  const logout = () => {
    localStorage.removeItem("alz_user");
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, register, logout, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
};
