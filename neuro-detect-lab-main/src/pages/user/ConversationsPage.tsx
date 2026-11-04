import { formatDoctorName } from "@/lib/utils";
import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import {
  getDoctors,
  getConversations,
  createConversation,
  getMessages,
  getApiBaseUrl,
  sendMessage,
  type Conversation,
  type Doctor,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Send,
  User,
  MessageCircle,
  Loader2,
  RefreshCw,
  Circle,
  CheckCheck,
  AlertCircle,
  FileText,
  ScanLine,
  Users,
} from "lucide-react";
import { toast } from "sonner";

const careJourneyHighlights = [
  {
    icon: MessageCircle,
    title: "Message patient-medecin",
    desc: "Posez vos questions, signalez un symptome ou preparez une teleconsultation.",
  },
  {
    icon: ScanLine,
    title: "Partage du scan",
    desc: "Envoyez votre IRM et laissez le medecin la relire avec votre dossier.",
  },
  {
    icon: FileText,
    title: "Envoi du rapport",
    desc: "Recevez un compte rendu simple a partager et a conserver.",
  },
  {
    icon: Users,
    title: "Module Aidant/Famille",
    desc: "Impliquez un proche dans le suivi, les rendez-vous et les consignes utiles.",
  },
];

const ConversationsPage = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [newMessage, setNewMessage] = useState("");
  const [showDoctorSelection, setShowDoctorSelection] = useState(false);
  const [doctorSearch, setDoctorSearch] = useState("");
  const [isTyping, setIsTyping] = useState(false);

  // Gestionnaire d'erreurs global pour éviter les écrans blancs
  useEffect(() => {
    const handleError = (error: ErrorEvent) => {
      console.error('Global error caught:', error);
      toast.error("Une erreur inattendue s'est produite. Veuillez rafraîchir la page.");
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      console.error('Unhandled promise rejection:', event);
      toast.error("Une erreur de réseau s'est produite. Veuillez réessayer.");
    };

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, []);

  // Récupérer les médecins disponibles
  const doctorsQuery = useQuery({
    queryKey: ["doctors"],
    queryFn: () => getDoctors(user?.token || ""),
    enabled: !!user?.token,
    refetchOnWindowFocus: true,
    refetchOnMount: 'always',
  });
  const { data: doctors = [], isLoading: doctorsLoading, refetch: refetchDoctors, error: doctorsError } = doctorsQuery;
  const filteredDoctors = doctors.filter((doctor) =>
    doctor.username.toLowerCase().includes(doctorSearch.toLowerCase()) ||
    doctor.email.toLowerCase().includes(doctorSearch.toLowerCase())
  );

  // Récupérer les conversations
  const { data: conversations = [], isLoading: conversationsLoading } = useQuery({
    queryKey: ["conversations"],
    queryFn: () => getConversations(user?.token || ""),
    enabled: !!user?.token,
  });

  // Récupérer les messages de la conversation sélectionnée
  const { data: messages = [], isLoading: messagesLoading, error: messagesError } = useQuery({
    queryKey: ["messages", selectedConversation?._id],
    queryFn: () => getMessages(selectedConversation!._id, user?.token || ""),
    enabled: !!selectedConversation && !!user?.token && !!selectedConversation._id,
  });

  // Mutation pour créer une conversation
  const createConversationMutation = useMutation({
    mutationFn: ({ patientEmail, doctorId }: { patientEmail: string; doctorId: string }) =>
      createConversation(patientEmail, doctorId, user?.token || ""),
    onSuccess: (conversation) => {
      setShowDoctorSelection(false);
      setSelectedConversation(conversation as Conversation);
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      toast.success("Conversation créée avec succès!");
    },
    onError: () => {
      toast.error("Erreur lors de la création de la conversation");
    },
  });

  // Mutation pour envoyer un message
  const sendMessageMutation = useMutation({
    mutationFn: async ({ conversationId, receiverId, content }: {
      conversationId: string;
      receiverId: string;
      content: string;
    }) => {
      try {
        return await sendMessage(conversationId, receiverId, content, user?.token || "");
      } catch (error) {
        console.error('Error sending message:', error);
        throw error;
      }
    },
    onSuccess: (data) => {
      console.log('Message sent successfully:', data);
      queryClient.invalidateQueries({ queryKey: ["messages", selectedConversation?._id] });
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      setNewMessage("");
      setIsTyping(false);
      toast.success("Message envoyé");
    },
    onError: (error: any) => {
      console.error('Failed to send message:', error);
      const errorMessage = error?.response?.data?.message || error?.message || "Erreur lors de l'envoi du message";
      toast.error(errorMessage);
    },
  });

  // Mutation pour marquer les messages comme lus
  const markMessagesAsReadMutation = useMutation({
    mutationFn: async (conversationId: string) => {
      try {
        // Récupérer tous les messages non lus de cette conversation
        const messagesResponse = await fetch(`${getApiBaseUrl()}/api/messages/conversations/${conversationId}/messages`, {
          headers: {
            'Authorization': `Bearer ${user?.token}`,
          },
        });

        if (!messagesResponse.ok) throw new Error('Failed to fetch messages');

        const messages = await messagesResponse.json();
        const unreadMessages = messages.filter((msg: any) => !msg.isRead && msg.sender._id !== user?.id);

        // Marquer chaque message non lu comme lu
        const markPromises = unreadMessages.map((msg: any) =>
          fetch(`${getApiBaseUrl()}/api/messages/messages/${msg._id}/read`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${user?.token}`,
            },
          })
        );

        await Promise.all(markPromises);
        return { markedCount: unreadMessages.length };
      } catch (error) {
        console.error('Error marking messages as read:', error);
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      // Invalider toutes les requêtes de messages pour être sûr
      queryClient.invalidateQueries({ queryKey: ["messages"] });
    },
    onError: (error) => {
      console.error('Failed to mark messages as read:', error);
    },
  });

  const handleSelectConversation = (conversation: Conversation) => {
    if (!conversation || !conversation._id || !conversation.doctor) {
      console.error('Invalid conversation data:', conversation);
      toast.error("Conversation invalide");
      return;
    }

    setSelectedConversation(conversation);
    // Marquer les messages comme lus
    markMessagesAsReadMutation.mutate(conversation._id);
  };

  const handleSendMessage = () => {
    try {
      if (!selectedConversation) {
        toast.error("Aucune conversation sélectionnée");
        return;
      }

      if (!newMessage.trim()) {
        toast.error("Le message ne peut pas être vide");
        return;
      }

      if (!user?.token) {
        toast.error("Utilisateur non authentifié");
        return;
      }

      if (!selectedConversation.doctor?._id) {
        toast.error("Destinataire invalide");
        return;
      }

      const receiverId = selectedConversation.doctor._id;

      sendMessageMutation.mutate({
        conversationId: selectedConversation._id,
        receiverId,
        content: newMessage.trim(),
      });
    } catch (error) {
      console.error('Error in handleSendMessage:', error);
      toast.error("Une erreur inattendue s'est produite");
    }
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInMinutes = Math.floor((now.getTime() - date.getTime()) / (1000 * 60));

    if (diffInMinutes < 1) return "À l'instant";
    if (diffInMinutes < 60) return `Il y a ${diffInMinutes} min`;

    const diffInHours = Math.floor(diffInMinutes / 60);
    if (diffInHours < 24) return `Il y a ${diffInHours}h`;

    const diffInDays = Math.floor(diffInHours / 24);
    if (diffInDays < 7) return `Il y a ${diffInDays}j`;

    return date.toLocaleDateString('fr-FR', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const handleChooseDoctor = (doctorId: string) => {
    if (!user?.email) return;

    // Créer la conversation et assigner le médecin
    createConversationMutation.mutate({
      patientEmail: user.email,
      doctorId,
    });
  };


  return (
    <div className="container mx-auto px-4 py-8">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8"
      >
        <h1 className="text-3xl font-bold text-foreground mb-2">Mes Conversations</h1>
        <p className="text-muted-foreground">
          Communiquez avec vos médecins professionnels
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4"
      >
        {careJourneyHighlights.map((item) => {
          const Icon = item.icon;
          return (
            <Card key={item.title} className="border-primary/10 bg-[linear-gradient(180deg,hsl(var(--card)),hsl(var(--muted)/0.45))]">
              <CardContent className="p-5">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" />
                </div>
                <h2 className="mt-4 text-base font-semibold text-foreground">{item.title}</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.desc}</p>
              </CardContent>
            </Card>
          );
        })}
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Liste des conversations */}
        <div className="lg:col-span-1">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageCircle className="h-5 w-5" />
                Conversations
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {conversationsLoading ? (
                <div className="flex justify-center py-4">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : conversations.length === 0 ? (
                <div className="text-center py-8">
                  <MessageCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <p className="text-muted-foreground mb-4">
                    Aucune conversation trouvée
                  </p>
                  <Button
                    onClick={() => setShowDoctorSelection(true)}
                    className="w-full"
                  >
                    Démarrer une conversation
                  </Button>
                </div>
              ) : (
                <>
                  {conversations.map((conversation) => {
                    const unreadCount = conversation.messages?.filter(
                      (msg) => !msg.isRead && msg.sender?._id !== user?.id   // sender is a populated user object, compare its id
                    ).length || 0;

                    return (
                      <motion.button
                        key={conversation._id}
                        onClick={() => handleSelectConversation(conversation)}
                        className={`w-full p-4 rounded-xl text-left transition-all duration-200 group ${
                          selectedConversation?._id === conversation._id
                            ? "bg-primary/10 border border-primary/20 shadow-sm"
                            : "hover:bg-muted border border-transparent"
                        }`}
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                      >
                        <div className="flex items-center gap-3">
                          <div className="relative">
                            <Avatar className="h-12 w-12">
                              <AvatarFallback className="bg-primary/10 text-primary font-semibold">
                                {conversation.doctor.username.charAt(0).toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <Circle className="absolute -bottom-1 -right-1 h-3 w-3 fill-green-500 text-green-500" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between mb-1">
                              <p className="font-semibold text-foreground truncate">
                                {formatDoctorName(conversation.doctor.username)}
                              </p>
                              <div className="flex items-center gap-2">
                                {conversation.lastMessage && (
                                  <span className="text-xs text-muted-foreground">
                                    {formatTime(conversation.lastMessage.createdAt)}
                                  </span>
                                )}
                                {unreadCount > 0 && (
                                  <Badge variant="destructive" className="h-5 w-5 p-0 flex items-center justify-center text-xs">
                                    {unreadCount}
                                  </Badge>
                                )}
                              </div>
                            </div>
                            {conversation.lastMessage ? (
                              <p className="text-sm text-muted-foreground truncate">
                                {conversation.lastMessage.content}
                              </p>
                            ) : (
                              <p className="text-sm text-muted-foreground italic">
                                Nouvelle conversation
                              </p>
                            )}
                          </div>
                        </div>
                      </motion.button>
                    );
                  })}
                  <Button
                    onClick={() => setShowDoctorSelection(true)}
                    variant="outline"
                    className="w-full mt-4"
                  >
                    Nouvelle conversation
                  </Button>
                </>
              )}
            </CardContent>
          </Card>

          <Card className="mt-6">
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <User className="h-5 w-5" />
                  Médecins disponibles
                </div>
                <Button
                  onClick={() => refetchDoctors()}
                  variant="ghost"
                  size="sm"
                  disabled={doctorsLoading}
                >
                  <RefreshCw className={`h-4 w-4 ${doctorsLoading ? 'animate-spin' : ''}`} />
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input
                value={doctorSearch}
                onChange={(e) => setDoctorSearch(e.target.value)}
                placeholder="Rechercher un médecin..."
                className="mb-3"
              />
              {doctorsLoading ? (
                <div className="flex justify-center py-4">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : doctorsError ? (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  Impossible de charger les médecins. Vérifiez que l'API est accessible depuis votre navigateur et que vous êtes connecté.
                </div>
              ) : filteredDoctors.length === 0 ? (
                <p className="text-muted-foreground">
                  Aucun médecin ne correspond à la recherche.
                </p>
              ) : (
                filteredDoctors.map((doctor) => (
                  <button
                    key={doctor._id}
                    onClick={() => handleChooseDoctor(doctor._id)}
                    disabled={createConversationMutation.isPending}
                    className="w-full p-4 rounded-xl border hover:bg-muted transition-all duration-200 text-left group"
                  >
                    <div className="flex items-center gap-3">
                      <div className="relative">
                        <Avatar className="h-12 w-12">
                          <AvatarFallback className="bg-primary/10 text-primary font-semibold">
                            {doctor.username.charAt(0).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <Circle className="absolute -bottom-1 -right-1 h-4 w-4 fill-green-500 text-green-500" />
                      </div>
                      <div className="flex-1">
                        <p className="font-semibold text-foreground group-hover:text-primary transition-colors">
                          {formatDoctorName(doctor.username)}
                        </p>
                        <p className="text-sm text-muted-foreground">{doctor.email}</p>
                        <p className="text-xs text-green-600 mt-1">✓ Disponible</p>
                      </div>
                    </div>
                  </button>
                ))
              )}
            </CardContent>
          </Card>
        </div>

        {/* Zone de chat */}
        <div className="lg:col-span-2 min-h-0">
          {selectedConversation && selectedConversation.doctor ? (
            <Card className="flex h-[calc(100vh-13rem)] min-h-[620px] flex-col overflow-hidden rounded-[30px] border border-border/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(241,245,249,0.94))] shadow-[0_24px_80px_rgba(15,23,42,0.08)]">
              <CardHeader className="border-b border-border/70 bg-white/75 backdrop-blur-xl">
                <CardTitle className="flex items-center gap-3">
                  <div className="relative">
                    <Avatar className="h-10 w-10">
                      <AvatarFallback className="bg-primary/10 text-primary font-semibold">
                        {selectedConversation.doctor.username?.charAt(0).toUpperCase() || '?'}
                      </AvatarFallback>
                    </Avatar>
                    <Circle className="absolute -bottom-1 -right-1 h-3 w-3 fill-green-500 text-green-500" />
                  </div>
                  <div>
                    <p className="font-semibold text-foreground">
                      {formatDoctorName(selectedConversation.doctor.username)}
                    </p>
                    <p className="text-sm text-muted-foreground flex items-center gap-2">
                      <Circle className="h-2 w-2 fill-green-500 text-green-500 animate-pulse" />
                      En ligne • Réponse en ~5 min • Neurologue
                    </p>
                  </div>
                </CardTitle>
              </CardHeader>

              <CardContent className="flex min-h-0 flex-1 flex-col p-0">
                <ScrollArea className="min-h-0 flex-1 bg-[radial-gradient(circle_at_top,rgba(59,130,246,0.08),transparent_34%),linear-gradient(180deg,#f8fbff_0%,#f5f7fb_100%)]">
                  {messagesLoading ? (
                    <div className="flex justify-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin" />
                    </div>
                  ) : messagesError ? (
                    <div className="flex flex-col items-center justify-center py-12">
                      <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-6">
                        <AlertCircle className="h-8 w-8 text-red-500" />
                      </div>
                      <h3 className="text-lg font-semibold text-red-700 mb-2">
                        Erreur de chargement
                      </h3>
                      <p className="text-red-600 text-center mb-4">
                        Impossible de charger les messages. Veuillez réessayer.
                      </p>
                      <Button
                        onClick={() => queryClient.invalidateQueries({ queryKey: ["messages", selectedConversation?._id] })}
                        variant="outline"
                      >
                        Réessayer
                      </Button>
                    </div>
                  ) : messages.length === 0 ? (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="text-center py-12"
                    >
                      <div className="w-16 h-16 bg-gradient-to-br from-primary/20 to-primary/10 rounded-full flex items-center justify-center mx-auto mb-6">
                        <MessageCircle className="h-8 w-8 text-primary" />
                      </div>
                      <h3 className="text-lg font-semibold text-foreground mb-2">
                        Commencez une conversation
                      </h3>
                      <p className="text-muted-foreground mb-6 max-w-sm mx-auto">
                        Sélectionnez un médecin pour commencer à discuter de vos analyses médicales,
                        poser des questions ou obtenir des conseils personnalisés.
                      </p>
                      <div className="grid grid-cols-1 gap-3 max-w-xs mx-auto text-sm text-muted-foreground">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                          <span>Consultation en ligne</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                          <span>Réponses rapides</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 bg-purple-500 rounded-full"></div>
                          <span>Confidentialité assurée</span>
                        </div>
                      </div>
                    </motion.div>
                  ) : (
                    <div className="space-y-4 px-5 py-5">
                      {messages.map((message, index) => (
                        <motion.div
                          key={message._id}
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: index * 0.05, duration: 0.3 }}
                          className={`flex ${
                            message.sender._id === user?.id ? "justify-end" : "justify-start"
                          }`}
                        >
                          <div
                            className={`max-w-[78%] rounded-[26px] px-5 py-4 shadow-[0_16px_40px_rgba(15,23,42,0.08)] ${
                              message.sender._id === user?.id
                                ? "ml-12 border border-primary/10 bg-[linear-gradient(135deg,hsl(var(--primary)),hsl(213_73%_54%))] text-primary-foreground"
                                : "mr-12 border border-white/70 bg-white/90 text-foreground backdrop-blur-sm"
                            }`}
                          >
                            <p className="text-sm leading-relaxed">{message.content}</p>
                            <div className={`flex items-center justify-end gap-1 mt-2 ${
                              message.sender._id === user?.id ? "text-primary-foreground/70" : "text-muted-foreground"
                            }`}>
                              <span className="text-xs">
                                {formatTime(message.createdAt)}
                              </span>
                              {message.sender._id === user?.id && (
                                <CheckCheck className="h-3 w-3" />
                              )}
                            </div>
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  )}
                </ScrollArea>

                <div className="border-t border-border/70 bg-white/80 p-4 backdrop-blur-xl">
                  {isTyping && (
                    <motion.div
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 10 }}
                      className="flex items-center gap-2 mb-3 text-sm text-muted-foreground"
                    >
                      <div className="flex gap-1">
                        <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                        <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                        <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                      </div>
                      <span>{formatDoctorName(selectedConversation?.doctor.username)} tape un message...</span>
                    </motion.div>
                  )}
                  <div className="flex items-end gap-3">
                    <div className="flex-1 relative">
                      <Input
                        value={newMessage}
                        onChange={(e) => {
                          setNewMessage(e.target.value);
                          setIsTyping(e.target.value.length > 0);
                        }}
                        placeholder="Tapez votre message ici..."
                        onKeyPress={(e) => e.key === "Enter" && !e.shiftKey && handleSendMessage()}
                        className="rounded-full border-white/80 bg-white/95 pr-12 shadow-sm transition-colors focus:border-primary"
                        disabled={sendMessageMutation.isPending}
                      />
                      {newMessage.trim() && (
                        <div className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                          Appuyez sur Entrée pour envoyer
                        </div>
                      )}
                    </div>
                    <Button
                      onClick={handleSendMessage}
                      disabled={!newMessage.trim() || sendMessageMutation.isPending}
                      size="icon"
                      className="rounded-full h-10 w-10 shrink-0"
                    >
                      {sendMessageMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card className="flex h-[calc(100vh-13rem)] min-h-[620px] items-center justify-center rounded-[30px] border border-border/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(241,245,249,0.94))] shadow-[0_24px_80px_rgba(15,23,42,0.08)]">
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="text-center max-w-md mx-auto p-8"
              >
                <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
                  <MessageCircle className="h-8 w-8 text-primary" />
                </div>
                <h3 className="text-xl font-semibold mb-2">Commencez une conversation</h3>
                <p className="text-muted-foreground mb-6">
                  Sélectionnez un médecin dans la liste pour commencer à discuter et obtenir des conseils médicaux personnalisés.
                </p>
                <div className="flex flex-col gap-2 text-sm text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <Circle className="h-2 w-2 fill-green-500 text-green-500" />
                    <span>Consultation 24/7</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Circle className="h-2 w-2 fill-blue-500 text-blue-500" />
                    <span>Réponse rapide</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Circle className="h-2 w-2 fill-purple-500 text-purple-500" />
                    <span>Confidentiel et sécurisé</span>
                  </div>
                </div>
              </motion.div>
            </Card>
          )}
        </div>
      </div>

      {/* Modal de sélection de médecin */}
      {showDoctorSelection && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <Card className="w-full max-w-md mx-4">
            <CardHeader>
              <CardTitle>Choisir un médecin</CardTitle>
            </CardHeader>
            <CardContent>
              {doctorsLoading ? (
                <div className="flex justify-center py-4">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredDoctors.map((doctor) => (
                    <button
                      key={doctor._id}
                      onClick={() => handleChooseDoctor(doctor._id)}
                      disabled={createConversationMutation.isPending}
                      className="w-full p-3 rounded-lg border hover:bg-muted transition-colors text-left"
                    >
                      <div className="flex items-center gap-3">
                        <Avatar>
                          <AvatarFallback>
                            {doctor.username.charAt(0).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="font-medium">{formatDoctorName(doctor.username)}</p>
                          <p className="text-sm text-muted-foreground">{doctor.email}</p>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              <div className="flex gap-2 mt-4">
                <Button
                  onClick={() => setShowDoctorSelection(false)}
                  variant="outline"
                  className="flex-1"
                >
                  Annuler
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
};

export default ConversationsPage;
