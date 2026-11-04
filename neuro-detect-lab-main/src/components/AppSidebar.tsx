import {
  LayoutDashboard, Upload, History, User, Brain,
  Users, BarChart3, FileText, Scan, LogOut, MessageCircle, Bot, NotebookPen, BookOpen
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useAuth } from "@/contexts/AuthContext";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";

const userNav = [
  { title: "Dashboard", url: "/patient", icon: LayoutDashboard },
  { title: "Upload Scan", url: "/patient/upload", icon: Upload },
  { title: "History", url: "/patient/history", icon: History },
  { title: "Journal", url: "/patient/journal", icon: NotebookPen },
  { title: "Conversations", url: "/patient/conversations", icon: MessageCircle },
  { title: "Learn more", url: "/patient/learn-more", icon: BookOpen },
  { title: "Assistant FAQ", url: "/patient/chatbot", icon: Bot },
  { title: "Profile", url: "/patient/profile", icon: User },
];

const doctorNav = [
  { title: "Overview", url: "/doctor", icon: LayoutDashboard },
  { title: "Patients", url: "/doctor/patients", icon: Users },
  { title: "Conversations", url: "/doctor/conversations", icon: MessageCircle },
  { title: "Assistant FAQ", url: "/doctor/chatbot", icon: Bot },
  { title: "Analysis", url: "/doctor/analysis", icon: Scan },
  { title: "AI Insights", url: "/doctor/insights", icon: BarChart3 },
  { title: "Reports", url: "/doctor/reports", icon: FileText },
];

export function AppSidebar() {
  const { user, logout } = useAuth();
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const items = user?.role === "doctor" ? doctorNav : userNav;

  return (
    <Sidebar collapsible="icon">
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>
            <div className="flex items-center gap-2">
              <Brain className="h-4 w-4 text-primary" />
              {!collapsed && <span className="font-display text-xs font-bold">Data<span className="text-primary">Scoop</span></span>}
            </div>
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.url}
                      end={item.url === "/patient" || item.url === "/doctor"}
                      className="hover:bg-muted/50"
                      activeClassName="bg-primary/10 text-primary font-medium"
                    >
                      <item.icon className="mr-2 h-4 w-4" />
                      {!collapsed && <span>{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          {!collapsed && user && (
            <div className="px-3 py-2 mb-1">
              <p className="text-xs font-medium text-foreground truncate">{user.name}</p>
              <p className="text-[10px] text-muted-foreground truncate">{user.email}</p>
            </div>
          )}
          <SidebarMenuItem>
            <SidebarMenuButton onClick={logout} className="text-destructive hover:bg-destructive/10">
              <LogOut className="mr-2 h-4 w-4" />
              {!collapsed && <span>Logout</span>}
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
