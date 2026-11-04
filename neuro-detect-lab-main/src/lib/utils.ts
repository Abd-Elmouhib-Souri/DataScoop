import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** "Dr. " prefix only when the stored name does not already have one (avoids "Dr. Dr. Sarah Mitchell"). */
export function formatDoctorName(name?: string | null): string {
  const n = (name ?? "").trim();
  if (!n) return "Médecin";
  return /^dr[\s._-]/i.test(n) ? n : `Dr. ${n}`;
}
