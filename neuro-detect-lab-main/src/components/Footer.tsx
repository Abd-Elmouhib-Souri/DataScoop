import { Brain } from "lucide-react";

const Footer = () => (
  <footer className="border-t border-border bg-card">
    <div className="container mx-auto flex flex-col items-center gap-4 px-4 py-8 text-center md:flex-row md:justify-between md:text-left">
      <div className="flex items-center gap-2">
        <Brain className="h-5 w-5 text-primary" />
        <span className="font-display text-sm font-semibold text-foreground">
          DataScoop
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        © {new Date().getFullYear()} DataScoop. For research purposes only — not a clinical diagnostic tool.
      </p>
    </div>
  </footer>
);

export default Footer;
