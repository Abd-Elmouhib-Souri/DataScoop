import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Send, User, Languages, Loader2, ShieldAlert, BrainCircuit } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  generateChatbotReply,
  getLanguageChangedMessage,
  getWelcomeMessage,
  QUICK_QUESTIONS,
  type ChatbotReply,
  type ChatLanguage,
} from "@/lib/chatbotEngine";

type Message = {
  id: string;
  text: string;
  sender: "user" | "bot";
  timestamp: Date;
  language: ChatLanguage;
  meta?: {
    source?: string;
    confidence?: number;
    disclaimer?: string;
  };
};

const THINKING_MESSAGES: Record<ChatLanguage, string> = {
  fr: "L'assistant reflechit...",
  ar: "المساعد يفكر...",
  en: "The assistant is thinking...",
};

interface MedicalChatbotPanelProps {
  title?: string;
  subtitle?: string;
  className?: string;
  extraSuggestions?: string[];
}

const MedicalChatbotPanel = ({
  title = "Assistant FAQ Alzheimer",
  subtitle = "Réponses tirées d'une FAQ vérifiée (règles et mots-clés, pas un médecin)",
  className,
  extraSuggestions = [],
}: MedicalChatbotPanelProps) => {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      text: getWelcomeMessage("fr"),
      sender: "bot",
      timestamp: new Date(),
      language: "fr",
    },
  ]);
  const [language, setLanguage] = useState<ChatLanguage>("fr");
  const [inputMessage, setInputMessage] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  const appendBotResponse = (response: ChatbotReply) => {
    setMessages((prev) => [
      ...prev,
      {
        id: `${Date.now()}-bot`,
        text: response.answer,
        sender: "bot",
        timestamp: new Date(),
        language: response.language,
        meta: {
          source: response.source,
          confidence: response.confidence,
          disclaimer: response.disclaimer,
        },
      },
    ]);
  };

  const handleSendMessage = async (presetMessage?: string) => {
    const messageToSend = (presetMessage ?? inputMessage).trim();
    if (!messageToSend || isTyping) return;

    setMessages((prev) => [
      ...prev,
      {
        id: `${Date.now()}-user`,
        text: messageToSend,
        sender: "user",
        timestamp: new Date(),
        language,
      },
    ]);
    setInputMessage("");
    setIsTyping(true);

    window.setTimeout(() => {
      const response = generateChatbotReply(messageToSend, language);
      appendBotResponse(response);
      setIsTyping(false);
    }, 450);
  };

  const handleLanguageChange = (value: string) => {
    const nextLanguage = value as ChatLanguage;
    setLanguage(nextLanguage);
    setMessages((prev) => [
      ...prev,
      {
        id: `${Date.now()}-lang`,
        text: getLanguageChangedMessage(nextLanguage),
        sender: "bot",
        timestamp: new Date(),
        language: nextLanguage,
      },
    ]);
  };

  const handleKeyDown = async (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      await handleSendMessage();
    }
  };

  const suggestionButtons = [...QUICK_QUESTIONS[language], ...extraSuggestions];

  return (
    <Card className={`flex h-[calc(100vh-14rem)] min-h-[700px] flex-col overflow-hidden rounded-[30px] border border-border/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.98),rgba(241,245,249,0.95))] shadow-[0_24px_80px_rgba(15,23,42,0.08)] ${className ?? ""}`}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 border-b border-border/70 bg-white/80 pb-4 backdrop-blur-xl">
        <div>
          <CardTitle className="flex items-center gap-2">
            <BrainCircuit className="h-5 w-5 text-primary" />
            {title}
          </CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <Select value={language} onValueChange={handleLanguageChange}>
          <SelectTrigger className="w-20">
            <Languages className="h-4 w-4" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="fr">FR</SelectItem>
            <SelectItem value="ar">AR</SelectItem>
            <SelectItem value="en">EN</SelectItem>
          </SelectContent>
        </Select>
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 flex-col p-0">
        <div className="border-b border-border/70 bg-white/60 p-4">
          <p className="mb-2 text-sm font-medium">Questions rapides</p>
          <div className="flex flex-wrap gap-2">
            {suggestionButtons.map((question) => (
              <Badge
                key={`${language}-${question}`}
                variant="secondary"
                className="cursor-pointer transition-colors hover:bg-primary hover:text-primary-foreground"
                onClick={() => void handleSendMessage(question)}
              >
                {question}
              </Badge>
            ))}
          </div>
        </div>

        <ScrollArea className="min-h-0 flex-1 bg-[radial-gradient(circle_at_top,rgba(59,130,246,0.08),transparent_34%),linear-gradient(180deg,#f8fbff_0%,#f5f7fb_100%)]">
          <div className="space-y-4 px-5 py-5">
            {messages.map((message) => (
              <motion.div
                key={message.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className={`flex gap-3 ${message.sender === "user" ? "justify-end" : "justify-start"}`}
              >
                {message.sender === "bot" && (
                  <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-primary/10">
                    <BrainCircuit className="h-4 w-4 text-primary" />
                  </div>
                )}

                <div
                  className={`max-w-[85%] rounded-[26px] px-5 py-4 shadow-[0_16px_40px_rgba(15,23,42,0.08)] ${
                    message.sender === "user"
                      ? "border border-primary/10 bg-[linear-gradient(135deg,hsl(var(--primary)),hsl(213_73%_54%))] text-primary-foreground"
                      : "border border-white/70 bg-white/90 backdrop-blur-sm"
                  }`}
                >
                  <p className="whitespace-pre-wrap text-sm">{message.text}</p>

                  {message.sender === "bot" && message.meta && (
                    <div className="mt-3 space-y-1 border-t border-border/60 pt-2 text-xs text-muted-foreground">
                      {message.meta.source && (
                        <div className="flex items-center gap-1.5">
                          <ShieldAlert className="h-3.5 w-3.5" />
                          <span>Source: {message.meta.source}</span>
                          {/* No "confidence %": these values are fixed constants of keyword rules / word overlap
                              with the FAQ, not a medical confidence. Showing "100%" would overclaim. */}
                        </div>
                      )}
                      {message.meta.disclaimer && <p>{message.meta.disclaimer}</p>}
                    </div>
                  )}

                  <p
                    className={`mt-2 text-xs ${
                      message.sender === "user" ? "text-primary-foreground/70" : "text-muted-foreground"
                    }`}
                  >
                    {message.timestamp.toLocaleTimeString()}
                  </p>
                </div>

                {message.sender === "user" && (
                  <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-primary">
                    <User className="h-4 w-4 text-primary-foreground" />
                  </div>
                )}
              </motion.div>
            ))}

            {isTyping && (
              <div className="flex justify-start gap-3">
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-primary/10">
                  <BrainCircuit className="h-4 w-4 text-primary" />
                </div>
                <div className="rounded-[22px] border border-white/70 bg-white/90 px-4 py-3 shadow-sm">
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span className="text-sm text-muted-foreground">{THINKING_MESSAGES[language]}</span>
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </ScrollArea>

        <div className="border-t border-border/70 bg-white/80 p-4 backdrop-blur-xl">
          <div className="flex gap-2">
            <Input
              value={inputMessage}
              onChange={(event) => setInputMessage(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                language === "fr"
                  ? "Tapez votre question..."
                  : language === "ar"
                    ? "اكتب سؤالك..."
                    : "Type your question..."
              }
              className="flex-1 rounded-full border-white/80 bg-white/95 shadow-sm"
            />
            <Button onClick={() => void handleSendMessage()} disabled={!inputMessage.trim() || isTyping}>
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default MedicalChatbotPanel;
