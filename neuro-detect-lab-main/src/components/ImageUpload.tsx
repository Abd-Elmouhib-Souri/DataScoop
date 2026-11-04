import { useCallback, useState } from "react";
import { Upload, X, Image as ImageIcon } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

interface ImageUploadProps {
  onFileSelect: (file: File) => void;
  isLoading: boolean;
  onAnalyze: () => void;
  actionLabel?: string;   // button text (patient: "send to my doctor"; doctor: "analyse")
  loadingLabel?: string;
}

const ALLOWED = ["image/jpeg", "image/png", "image/webp"];

const ImageUpload = ({ onFileSelect, isLoading, onAnalyze, actionLabel = "Analyser l'image", loadingLabel = "Analyse…" }: ImageUploadProps) => {
  const [preview, setPreview] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [dragOver, setDragOver] = useState(false);

  const handleFile = useCallback(
    (file: File) => {
      if (!ALLOWED.includes(file.type)) {
        toast.error("Invalid file type. Please upload a JPG, PNG, or WebP image.");
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        toast.error("File too large. Maximum size is 10 MB.");
        return;
      }
      setFileName(file.name);
      setPreview(URL.createObjectURL(file));
      onFileSelect(file);
    },
    [onFileSelect]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  const clearFile = () => {
    setPreview(null);
    setFileName("");
  };

  return (
    <div className="mx-auto w-full max-w-lg">
      <AnimatePresence mode="wait">
        {!preview ? (
          <motion.label
            key="dropzone"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            className={`flex cursor-pointer flex-col items-center gap-4 rounded-2xl border-2 border-dashed p-12 transition-all ${
              dragOver
                ? "border-primary bg-primary/5 shadow-glow"
                : "border-border bg-card hover:border-primary/40 hover:bg-muted/50"
            }`}
          >
            <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10">
              <Upload className="h-7 w-7 text-primary" />
            </div>
            <div className="text-center">
              <p className="text-sm font-semibold text-foreground">
                Drop your MRI scan here
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                or click to browse · JPG, PNG, WebP · max 10 MB
              </p>
            </div>
            <input
              type="file"
              className="hidden"
              accept=".jpg,.jpeg,.png,.webp"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
              }}
            />
          </motion.label>
        ) : (
          <motion.div
            key="preview"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="flex flex-col items-center gap-5"
          >
            <div className="relative overflow-hidden rounded-2xl border border-border shadow-card">
              <img
                src={preview}
                alt="MRI Preview"
                className="h-64 w-full object-contain bg-muted/30"
              />
              <button
                onClick={clearFile}
                className="absolute right-2 top-2 rounded-full bg-card/80 p-1.5 text-muted-foreground backdrop-blur-sm hover:bg-destructive hover:text-destructive-foreground transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <ImageIcon className="h-3.5 w-3.5" />
              {fileName}
            </div>
            <Button
              size="lg"
              onClick={onAnalyze}
              disabled={isLoading}
              className="w-full rounded-xl gradient-medical text-primary-foreground shadow-elevated hover:opacity-90 transition-opacity"
            >
              {isLoading ? loadingLabel : actionLabel}
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default ImageUpload;
