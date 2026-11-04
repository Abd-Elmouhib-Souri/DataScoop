import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import MedicalChatbotPanel from "@/components/MedicalChatbotPanel";

interface ChatbotProps {
  isOpen: boolean;
  onClose: () => void;
}

const Chatbot: React.FC<ChatbotProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          onClick={(e) => e.stopPropagation()}
          className="relative h-[700px] w-full max-w-2xl rounded-lg bg-background shadow-xl"
        >
          <Button variant="ghost" size="sm" onClick={onClose} className="absolute right-3 top-3 z-10">
            <X className="h-4 w-4" />
          </Button>
          <MedicalChatbotPanel
            title="Assistant FAQ Alzheimer"
            subtitle="Réponses tirées d'une FAQ vérifiée (règles et mots-clés, pas un médecin)"
            className="h-full rounded-lg border-0 shadow-none"
          />
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
};

export default Chatbot;
