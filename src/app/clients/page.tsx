"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { useAuth } from "@/context/AuthContext";
import {
  Users,
  UserPlus,
  MailCheck,
  Building2,
  Globe,
  ExternalLink,
  Plus,
  Check,
  X,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  Trash2,
  Edit3,
  Eye,
  Pause,
  Play,
  Briefcase,
  Workflow,
  Bot,
  Mail,
  Phone,
  Clock,
  ShieldCheck,
  Key,
  MessageSquare,
  Code2,
  Link2,
  Copy,
  RotateCcw,
  Hash,
  Cpu,
  BarChart3,
  Zap,
  Receipt,
  DollarSign,
  CheckCircle,
  TrendingUp,
  Sparkles,
  Lock,
} from "lucide-react";

interface Client {
  id: string;
  display_name: string;
  website_url: string | null;
  status: "active" | "inactive";
  credit_limit_monthly: number | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  workspace?: {
    id: string;
    name: string;
  } | null;
}


interface ClientApiKey {
  id: string;
  provider: "openai" | "google" | "anthropic" | string;
  label: string;
  key_hint: string;
  is_active: boolean;
  created_at: string;
}

interface ClientAiConfig {
  client_id: string;
  mode: "nextex_keys" | "byok";
  default_model: string;
  model_allowlist: string[];
  monthly_token_cap: number | null;
}


interface BlueprintCredentialSpec {
  key: string;
  label?: string;
  type?: "password" | "text" | "oauth" | string;
  help?: string;
  required?: boolean;
}

interface Blueprint {
  slug: string;
  name: string;
  description: string;
  category: string;
  required_credentials: BlueprintCredentialSpec[];
  default_config: Record<string, any>;
}

interface ClientIntegration {
  id: string;
  blueprint_slug: string;
  blueprint_name: string;
  label: string;
  is_active: boolean;
  created_at: string;
}


interface ClientSiteKey {
  id: string;
  name: string;
  key_prefix: string;
  is_active: boolean;
  last_used_at: string | null;
  created_at: string;
}

interface ClientIdBinding {
  id: string;
  client_id: string;
  external_id: string;
  phone: string | null;
  channel: "web" | "whatsapp" | "instagram" | "other";
  is_active: boolean;
  created_at: string;
  updated_at: string;
}


interface ClientWidget {
  id: string;
  client_id: string;
  name: string;
  embed_key: string;
  allowed_sources: string[];
  theme: {
    primary_color?: string;
    primaryColor?: string;
    position?: "bottom-right" | "bottom-left" | string;
  };
  greeting: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}


interface WorkspaceMemberItem {
  user_id: string;
  email: string;
  role: "owner" | "admin" | "member";
  created_at: string;
}

interface WorkspaceInviteItem {
  id: string;
  workspace_id: string;
  email: string;
  role: "owner" | "admin" | "member";
  invited_by: string;
  token: string;
  expires_at: string;
  created_at: string;
  invite_link: string;
}


type PermRole = "owner" | "admin" | "member";
type PermSection = "conversaciones" | "automatizaciones" | "consumo" | "config_ia" | "usuarios";
type PermAction = "ver" | "responder" | "pausar" | "editar" | "invitar";

type ClientPermissionsMatrix = {
  roles: {
    [R in PermRole]: {
      [S in PermSection]: {
        [A in PermAction]: boolean;
      };
    };
  };
};


interface ClientConsumptionData {
  month: string;
  total_tokens: number;
  by_model: Array<{ model: string; tokens: number }>;
  by_day: Array<{ day: string; tokens: number }>;
  cache_hits: number;
  cache_hit_rate: number;
  budget: {
    cap: number | null;
    used: number;
    exceeded: boolean;
  };
}


interface ModelBillingItem {
  model: string;
  input_tokens: number;
  output_tokens: number;
  cost: number;
  unpriced?: boolean;
}

interface ClientBillingEstimate {
  period: string;
  billable: boolean;
  reason?: string;
  tokens_total: number;
  amount_estimate: number;
  currency: string;
  by_model: ModelBillingItem[];
}

interface ClientInvoiceItem {
  id: string;
  client_id: string;
  period: string;
  tokens_total: number;
  amount: number;
  currency: string;
  status: "pending" | "paid" | "cancelled";
  created_at: string;
  updated_at: string;
}

interface ClientDetailData {
  client: Client;
  workspace?: { id: string; name: string; slug?: string; owner_id?: string };
  counts: {
    automations: number;
    jobs: number;
    agents: number;
  };
}

export default function ClientsPage() {
  const { user, isLoading: isAuthLoading } = useAuth();
  const router = useRouter();

  // Estados principales
  const [clients, setClients] = useState<Client[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Notificaciones globales
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // Verificación Web
  const [verifyResults, setVerifyResults] = useState<Record<string, { ok: boolean; status?: number; error?: string }>>({});
  const [verifyingIds, setVerifyingIds] = useState<Record<string, boolean>>({});

  // Modal Crear
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [creditLimitMonthly, setCreditLimitMonthly] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);


  // Estados Pestaña IA (IA-3)
  const [activeDetailTab, setActiveDetailTab] = useState<"general" | "ai" | "integrations" | "connections" | "widget" | "users" | "permissions" | "consumption" | "billing">("general");

  // Estados Pestaña Facturación (BILL-3)
  const [billingEstimate, setBillingEstimate] = useState<ClientBillingEstimate | null>(null);
  const [isLoadingBilling, setIsLoadingBilling] = useState(false);
  const [billingError, setBillingError] = useState<string | null>(null);

  const [invoices, setInvoices] = useState<ClientInvoiceItem[]>([]);
  const [isLoadingInvoices, setIsLoadingInvoices] = useState(false);
  const [isGeneratingInvoice, setIsGeneratingInvoice] = useState(false);
  const [confirmInvoiceAction, setConfirmInvoiceAction] = useState<{ invoice: ClientInvoiceItem; nextStatus: "paid" | "cancelled" } | null>(null);
  const [isUpdatingInvoice, setIsUpdatingInvoice] = useState(false);

  // Estados Pestaña Consumo (EFIC-3)
  const [consumptionData, setConsumptionData] = useState<ClientConsumptionData | null>(null);
  const [isLoadingConsumption, setIsLoadingConsumption] = useState(false);
  const [consumptionError, setConsumptionError] = useState<string | null>(null);

  // Estados Pestaña Permisos (PERM-3)
  const [permissionsMatrix, setPermissionsMatrix] = useState<ClientPermissionsMatrix | null>(null);
  const [isLoadingPermissions, setIsLoadingPermissions] = useState(false);
  const [permissionsError, setPermissionsError] = useState<string | null>(null);
  const [selectedPermRole, setSelectedPermRole] = useState<PermRole>("owner");
  const [confirmingPreset, setConfirmingPreset] = useState<"dueno" | "empleado" | "lectura" | null>(null);
  const [isApplyingPreset, setIsApplyingPreset] = useState(false);

  // Estados Pestaña Usuarios (ROLES-3)
  const [members, setMembers] = useState<WorkspaceMemberItem[]>([]);
  const [isLoadingMembers, setIsLoadingMembers] = useState(false);
  const [membersError, setMembersError] = useState<string | null>(null);

  const [invites, setInvites] = useState<WorkspaceInviteItem[]>([]);
  const [isLoadingInvites, setIsLoadingInvites] = useState(false);
  const [invitesError, setInvitesError] = useState<string | null>(null);

  // Modal Invitar Usuario
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"owner" | "admin" | "member">("member");
  const [isSubmittingInvite, setIsSubmittingInvite] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [createdInviteResult, setCreatedInviteResult] = useState<WorkspaceInviteItem | null>(null);
  const [hasCopiedInviteLink, setHasCopiedInviteLink] = useState(false);
  const [copiedInviteToken, setCopiedInviteToken] = useState<string | null>(null);

  // Estados Pestaña Widget (WIDGET-3)
  const [widgets, setWidgets] = useState<ClientWidget[]>([]);
  const [isLoadingWidgets, setIsLoadingWidgets] = useState(false);
  const [widgetsError, setWidgetsError] = useState<string | null>(null);

  // Modal Crear Widget
  const [isCreateWidgetOpen, setIsCreateWidgetOpen] = useState(false);
  const [widgetName, setWidgetName] = useState("");
  const [widgetGreeting, setWidgetGreeting] = useState("¡Hola! ¿En qué podemos ayudarte hoy?");
  const [widgetPrimaryColor, setWidgetPrimaryColor] = useState("#4f46e5");
  const [widgetPosition, setWidgetPosition] = useState<"bottom-right" | "bottom-left">("bottom-right");
  const [widgetAllowedSources, setWidgetAllowedSources] = useState<string[]>(["web"]);
  const [isCreatingWidget, setIsCreatingWidget] = useState(false);
  const [createWidgetError, setCreateWidgetError] = useState<string | null>(null);

  // Modal Confirmar Desactivar Widget
  const [deletingWidget, setDeletingWidget] = useState<ClientWidget | null>(null);
  const [isDeletingWidget, setIsDeletingWidget] = useState(false);
  const [copiedSnippetId, setCopiedSnippetId] = useState<string | null>(null);

  // Modal Editar Widget (WIDGET-4)
  const [editingWidget, setEditingWidget] = useState<ClientWidget | null>(null);
  const [editWidgetName, setEditWidgetName] = useState("");
  const [editWidgetGreeting, setEditWidgetGreeting] = useState("");
  const [editWidgetPrimaryColor, setEditWidgetPrimaryColor] = useState("#4f46e5");
  const [editWidgetPosition, setEditWidgetPosition] = useState<"bottom-right" | "bottom-left">("bottom-right");
  const [editWidgetAllowedSources, setEditWidgetAllowedSources] = useState<string[]>(["web"]);
  const [isUpdatingWidget, setIsUpdatingWidget] = useState(false);
  const [editWidgetError, setEditWidgetError] = useState<string | null>(null);

  // Estados Pestaña Conexiones (CONEX-3)
  const [siteKeys, setSiteKeys] = useState<ClientSiteKey[]>([]);
  const [isLoadingSiteKeys, setIsLoadingSiteKeys] = useState(false);
  const [siteKeysError, setSiteKeysError] = useState<string | null>(null);

  const [bindings, setBindings] = useState<ClientIdBinding[]>([]);
  const [isLoadingBindings, setIsLoadingBindings] = useState(false);
  const [bindingsError, setBindingsError] = useState<string | null>(null);

  // Modales Site Keys
  const [isGenerateKeyOpen, setIsGenerateKeyOpen] = useState(false);
  const [newSiteKeyName, setNewSiteKeyName] = useState("");
  const [isGeneratingKey, setIsGeneratingKey] = useState(false);
  const [generatedKeyResult, setGeneratedKeyResult] = useState<{ id: string; name: string; key: string; key_prefix: string; warning: string } | null>(null);
  const [hasCopiedKey, setHasCopiedKey] = useState(false);

  const [regeneratingKey, setRegeneratingKey] = useState<ClientSiteKey | null>(null);
  const [isRegeneratingKey, setIsRegeneratingKey] = useState(false);

  const [revokingKey, setRevokingKey] = useState<ClientSiteKey | null>(null);
  const [isRevokingKey, setIsRevokingKey] = useState(false);

  // Modales ID Bindings
  const [isCreateBindingOpen, setIsCreateBindingOpen] = useState(false);
  const [bindingExternalId, setBindingExternalId] = useState("");
  const [bindingPhone, setBindingPhone] = useState("");
  const [bindingChannel, setBindingChannel] = useState<"web" | "whatsapp" | "instagram" | "other">("web");
  const [isCreatingBinding, setIsCreatingBinding] = useState(false);
  const [createBindingError, setCreateBindingError] = useState<string | null>(null);

  const [editingBinding, setEditingBinding] = useState<ClientIdBinding | null>(null);
  const [editBindingPhone, setEditBindingPhone] = useState("");
  const [editBindingIsActive, setEditBindingIsActive] = useState(true);
  const [isUpdatingBinding, setIsUpdatingBinding] = useState(false);

  const [deletingBinding, setDeletingBinding] = useState<ClientIdBinding | null>(null);
  const [isDeletingBinding, setIsDeletingBinding] = useState(false);

  // Estados Pestaña Integraciones (BLUEPRINTS-3)
  const [blueprints, setBlueprints] = useState<Blueprint[]>([]);
  const [clientIntegrations, setClientIntegrations] = useState<ClientIntegration[]>([]);
  const [isLoadingIntegrations, setIsLoadingIntegrations] = useState(false);
  const [integrationsError, setIntegrationsError] = useState<string | null>(null);

  // Modal Dinámico de Instalación
  const [installingBlueprint, setInstallingBlueprint] = useState<Blueprint | null>(null);
  const [installLabel, setInstallLabel] = useState("");
  const [installCredentials, setInstallCredentials] = useState<Record<string, string>>({});
  const [oauthPending, setOauthPending] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);

  // Modal Confirmar Desinstalación
  const [uninstallingIntegration, setUninstallingIntegration] = useState<ClientIntegration | null>(null);
  const [isUninstalling, setIsUninstalling] = useState(false);
  const [aiConfig, setAiConfig] = useState<ClientAiConfig | null>(null);
  const [aiKeys, setAiKeys] = useState<ClientApiKey[]>([]);
  const [isLoadingAi, setIsLoadingAi] = useState(false);

  // Selector de Modo & Confirmación
  const [pendingModeChange, setPendingModeChange] = useState<"nextex_keys" | "byok" | null>(null);
  const [isChangingMode, setIsChangingMode] = useState(false);

  // Modal Agregar Clave BYOK
  const [isAddKeyOpen, setIsAddKeyOpen] = useState(false);
  const [newKeyProvider, setNewKeyProvider] = useState<"openai" | "google" | "anthropic">("openai");
  const [newKeyLabel, setNewKeyLabel] = useState("");
  const [newKeySecret, setNewKeySecret] = useState("");
  const [isSubmittingKey, setIsSubmittingKey] = useState(false);
  const [createKeyError, setCreateKeyError] = useState<string | null>(null);

  // Modal Confirmar Eliminar Clave
  const [deletingKey, setDeletingKey] = useState<ClientApiKey | null>(null);
  const [isDeletingKey, setIsDeletingKey] = useState(false);

  // Configuración de Modelos y Límites
  const [cfgDefaultModel, setCfgDefaultModel] = useState("gemini-1.5-flash");
  const [cfgAllowlistStr, setCfgAllowlistStr] = useState("gemini-1.5-flash, gemini-1.5-pro");
  const [cfgMonthlyCap, setCfgMonthlyCap] = useState<string>("");
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [aiActionError, setAiActionError] = useState<string | null>(null);

  // Modal Detalle
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [clientDetail, setClientDetail] = useState<ClientDetailData | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);

  // Modal Editar
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [editDisplayName, setEditDisplayName] = useState("");
  const [editWebsiteUrl, setEditWebsiteUrl] = useState("");
  const [editContactName, setEditContactName] = useState("");
  const [editContactEmail, setEditContactEmail] = useState("");
  const [editContactPhone, setEditContactPhone] = useState("");
  const [editCreditLimitMonthly, setEditCreditLimitMonthly] = useState<string>("");
  const [editNotes, setEditNotes] = useState("");
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);

  // Modal Eliminar
  const [deletingClient, setDeletingClient] = useState<Client | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Modal Pausar / Reanudar
  const [statusToggleClient, setStatusToggleClient] = useState<Client | null>(null);
  const [isTogglingStatus, setIsTogglingStatus] = useState(false);

  // Protección de ruta
  useEffect(() => {
    if (!isAuthLoading && !user) {
      router.push("/login?redirect=/clients");
    }
  }, [user, isAuthLoading, router]);

  const loadClients = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/clients");
      if (res.ok) {
        const data = await res.json();
        setClients(Array.isArray(data) ? data : []);
      }
    } catch {
      // Fallback
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) {
      loadClients();
    }
  }, [user, loadClients]);

  const loadClientDetail = async (clientId: string) => {
    setIsLoadingDetail(true);
    try {
      const res = await fetch(`/api/clients/${clientId}`);
      if (res.ok) {
        const data = await res.json();
        setClientDetail(data);
      }
    } catch {
      // Fallback
    } finally {
      setIsLoadingDetail(false);
    }
  };


  const loadClientAiData = useCallback(async (clientId: string) => {
    setIsLoadingAi(true);
    setAiActionError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/ai`);
      if (res.ok) {
        const data = await res.json();
        if (data.config) {
          setAiConfig(data.config);
          setCfgDefaultModel(data.config.default_model || "gemini-1.5-flash");
          setCfgAllowlistStr(Array.isArray(data.config.model_allowlist) ? data.config.model_allowlist.join(", ") : "");
          setCfgMonthlyCap(data.config.monthly_token_cap != null ? String(data.config.monthly_token_cap) : "");
        }
        if (Array.isArray(data.keys)) {
          setAiKeys(data.keys.filter((k: ClientApiKey) => k.is_active !== false));
        }
      }
    } catch (err: any) {
      console.error("Error al cargar configuración de IA:", err);
    } finally {
      setIsLoadingAi(false);
    }
  }, []);

  const handleConfirmModeChange = async () => {
    if (!selectedClient || !pendingModeChange) return;
    setIsChangingMode(true);
    setAiActionError(null);
    try {
      const res = await fetch(`/api/clients/${selectedClient.id}/ai`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: pendingModeChange }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAiActionError(data?.error?.message || "No se pudo actualizar el modo de IA.");
      } else {
        setAiConfig((prev) => (prev ? { ...prev, mode: pendingModeChange } : null));
        setFeedback({
          type: "success",
          message: pendingModeChange === "byok" ? "Modo cambiado a Claves propias (BYOK)." : "Modo cambiado a Claves NEXTEX (premium).",
        });
      }
    } catch (err: any) {
      setAiActionError(err?.message || "Error al cambiar el modo.");
    } finally {
      setIsChangingMode(false);
      setPendingModeChange(null);
    }
  };

  const handleAddApiKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClient || !newKeySecret.trim()) return;

    setIsSubmittingKey(true);
    setCreateKeyError(null);
    try {
      const res = await fetch(`/api/clients/${selectedClient.id}/ai/keys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: newKeyProvider,
          label: newKeyLabel.trim() || undefined,
          api_key: newKeySecret.trim(),
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const errorMsg = typeof data.error === "string" ? data.error : data?.error?.message || "La clave de API no es válida.";
        setCreateKeyError(errorMsg);
        return;
      }

      await loadClientAiData(selectedClient.id);
      setIsAddKeyOpen(false);
      setNewKeySecret("");
      setNewKeyLabel("");
      setFeedback({ type: "success", message: `Clave para ${newKeyProvider.toUpperCase()} agregada correctamente.` });
    } catch (err: any) {
      setCreateKeyError(err?.message || "Error inesperado al registrar la clave.");
    } finally {
      setIsSubmittingKey(false);
    }
  };

  const handleConfirmDeleteKey = async () => {
    if (!selectedClient || !deletingKey) return;
    setIsDeletingKey(true);
    try {
      const res = await fetch(`/api/clients/${selectedClient.id}/ai/keys/${deletingKey.id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setAiKeys((prev) => prev.filter((k) => k.id !== deletingKey.id));
        setFeedback({ type: "success", message: `Clave "${deletingKey.label}" eliminada exitosamente.` });
      } else {
        const data = await res.json().catch(() => ({}));
        setAiActionError(data?.error?.message || "Error al eliminar la clave.");
      }
    } catch (err: any) {
      setAiActionError(err?.message || "Error de red al eliminar la clave.");
    } finally {
      setIsDeletingKey(false);
      setDeletingKey(null);
    }
  };

  const handleSaveAiConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClient) return;

    setIsSavingConfig(true);
    setAiActionError(null);
    try {
      const allowlist = cfgAllowlistStr
        .split(",")
        .map((m) => m.trim())
        .filter(Boolean);

      const tokenCap = cfgMonthlyCap.trim() === "" ? null : Number(cfgMonthlyCap);

      const res = await fetch(`/api/clients/${selectedClient.id}/ai`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          default_model: cfgDefaultModel.trim() || "gemini-1.5-flash",
          model_allowlist: allowlist.length > 0 ? allowlist : ["gemini-1.5-flash"],
          monthly_token_cap: tokenCap,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAiActionError(data?.error?.message || "Error al guardar la configuración de IA.");
      } else {
        setFeedback({ type: "success", message: "Configuración de IA actualizada correctamente." });
        await loadClientAiData(selectedClient.id);
      }
    } catch (err: any) {
      setAiActionError(err?.message || "Error al guardar la configuración.");
    } finally {
      setIsSavingConfig(false);
    }
  };


  const loadBlueprints = useCallback(async () => {
    try {
      const res = await fetch("/api/blueprints");
      if (res.ok) {
        const data = await res.json();
        setBlueprints(Array.isArray(data) ? data : []);
      }
    } catch (err: any) {
      console.error("Error al cargar blueprints:", err);
    }
  }, []);

  const loadClientIntegrations = useCallback(async (clientId: string) => {
    setIsLoadingIntegrations(true);
    setIntegrationsError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/integrations`);
      if (res.ok) {
        const data = await res.json();
        setClientIntegrations(Array.isArray(data) ? data : []);
      } else {
        const data = await res.json().catch(() => ({}));
        setIntegrationsError(data?.error?.message || "No se pudieron cargar las integraciones.");
      }
    } catch (err: any) {
      setIntegrationsError(err?.message || "Error al consultar integraciones.");
    } finally {
      setIsLoadingIntegrations(false);
    }
  }, []);

  const handleInstallIntegration = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClient || !installingBlueprint) return;

    setIsInstalling(true);
    setInstallError(null);

    try {
      const payload: any = {
        blueprint_slug: installingBlueprint.slug,
        label: installLabel.trim() || undefined,
        credentials: { ...installCredentials },
      };

      if (oauthPending) {
        payload.credentials.oauth_pending = true;
      }

      const res = await fetch(`/api/clients/${selectedClient.id}/integrations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        // Regla: si falla 400 mostrar mensaje visible dentro del modal SIN cerrarlo
        const errorMsg =
          typeof data.error === "string"
            ? data.error
            : data?.error?.message || "Error al instalar la integración.";
        setInstallError(errorMsg);
        return;
      }

      // Éxito: refrescar lista, cerrar modal y limpiar
      await loadClientIntegrations(selectedClient.id);
      setInstallingBlueprint(null);
      setInstallLabel("");
      setInstallCredentials({});
      setOauthPending(false);
      setFeedback({
        type: "success",
        message: `Integración "${installingBlueprint.name}" instalada exitosamente.`,
      });
    } catch (err: any) {
      setInstallError(err?.message || "Error inesperado al conectar con el servidor.");
    } finally {
      setIsInstalling(false);
    }
  };

  const handleConfirmUninstall = async () => {
    if (!selectedClient || !uninstallingIntegration) return;

    setIsUninstalling(true);
    try {
      const res = await fetch(
        `/api/clients/${selectedClient.id}/integrations/${uninstallingIntegration.id}`,
        { method: "DELETE" }
      );

      if (res.ok) {
        await loadClientIntegrations(selectedClient.id);
        setFeedback({
          type: "success",
          message: `Integración "${uninstallingIntegration.label}" desinstalada correctamente.`,
        });
        setUninstallingIntegration(null);
      } else {
        const data = await res.json().catch(() => ({}));
        setFeedback({
          type: "error",
          message: data?.error?.message || "No se pudo desinstalar la integración.",
        });
      }
    } catch (err: any) {
      setFeedback({
        type: "error",
        message: err?.message || "Error de red al desinstalar.",
      });
    } finally {
      setIsUninstalling(false);
    }
  };


  const loadSiteKeys = useCallback(async (clientId: string) => {
    setIsLoadingSiteKeys(true);
    setSiteKeysError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/site-keys`);
      if (res.ok) {
        const data = await res.json();
        setSiteKeys(Array.isArray(data) ? data : []);
      } else {
        const data = await res.json().catch(() => ({}));
        setSiteKeysError(data?.error?.message || "No se pudieron cargar las site keys.");
      }
    } catch (err: any) {
      setSiteKeysError(err?.message || "Error al consultar site keys.");
    } finally {
      setIsLoadingSiteKeys(false);
    }
  }, []);

  const loadBindings = useCallback(async (clientId: string) => {
    setIsLoadingBindings(true);
    setBindingsError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/bindings`);
      if (res.ok) {
        const data = await res.json();
        setBindings(Array.isArray(data) ? data : []);
      } else {
        const data = await res.json().catch(() => ({}));
        setBindingsError(data?.error?.message || "No se pudieron cargar los bindings.");
      }
    } catch (err: any) {
      setBindingsError(err?.message || "Error al consultar bindings.");
    } finally {
      setIsLoadingBindings(false);
    }
  }, []);

  const handleGenerateSiteKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClient) return;

    setIsGeneratingKey(true);
    try {
      const res = await fetch(`/api/clients/${selectedClient.id}/site-keys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newSiteKeyName.trim() || undefined }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setFeedback({ type: "error", message: data?.error?.message || "Error al generar site key." });
        return;
      }

      setGeneratedKeyResult(data);
      setNewSiteKeyName("");
      setHasCopiedKey(false);
    } catch (err: any) {
      setFeedback({ type: "error", message: err?.message || "Error inesperado al generar site key." });
    } finally {
      setIsGeneratingKey(false);
    }
  };

  const handleConfirmRegenerateKey = async () => {
    if (!selectedClient || !regeneratingKey) return;

    setIsRegeneratingKey(true);
    try {
      const res = await fetch(`/api/clients/${selectedClient.id}/site-keys/${regeneratingKey.id}/regenerate`, {
        method: "POST",
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setFeedback({ type: "error", message: data?.error?.message || "Error al regenerar site key." });
        return;
      }

      setRegeneratingKey(null);
      setGeneratedKeyResult(data);
      setHasCopiedKey(false);
      setIsGenerateKeyOpen(true);
    } catch (err: any) {
      setFeedback({ type: "error", message: err?.message || "Error inesperado al regenerar site key." });
    } finally {
      setIsRegeneratingKey(false);
    }
  };

  const handleConfirmRevokeKey = async () => {
    if (!selectedClient || !revokingKey) return;

    setIsRevokingKey(true);
    try {
      const res = await fetch(`/api/clients/${selectedClient.id}/site-keys/${revokingKey.id}`, {
        method: "DELETE",
      });

      if (res.ok) {
        await loadSiteKeys(selectedClient.id);
        setFeedback({ type: "success", message: `Site key "${revokingKey.name}" revocada exitosamente.` });
        setRevokingKey(null);
      } else {
        const data = await res.json().catch(() => ({}));
        setFeedback({ type: "error", message: data?.error?.message || "Error al revocar site key." });
      }
    } catch (err: any) {
      setFeedback({ type: "error", message: err?.message || "Error de red al revocar site key." });
    } finally {
      setIsRevokingKey(false);
    }
  };

  const handleCreateBinding = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClient || !bindingExternalId.trim()) return;

    setIsCreatingBinding(true);
    setCreateBindingError(null);

    try {
      const res = await fetch(`/api/clients/${selectedClient.id}/bindings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          external_id: bindingExternalId.trim(),
          phone: bindingPhone.trim() || undefined,
          channel: bindingChannel,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (res.status === 409) {
        setCreateBindingError("Ese ID ya está vinculado en ese canal.");
        return;
      }

      if (!res.ok) {
        setCreateBindingError(data?.error?.message || "Error al vincular ID.");
        return;
      }

      await loadBindings(selectedClient.id);
      setIsCreateBindingOpen(false);
      setBindingExternalId("");
      setBindingPhone("");
      setFeedback({ type: "success", message: "ID vinculado correctamente." });
    } catch (err: any) {
      setCreateBindingError(err?.message || "Error inesperado al vincular ID.");
    } finally {
      setIsCreatingBinding(false);
    }
  };

  const handleUpdateBinding = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClient || !editingBinding) return;

    setIsUpdatingBinding(true);
    try {
      const res = await fetch(`/api/clients/${selectedClient.id}/bindings/${editingBinding.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: editBindingPhone.trim() || null,
          is_active: editBindingIsActive,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setFeedback({ type: "error", message: data?.error?.message || "Error al actualizar binding." });
        return;
      }

      await loadBindings(selectedClient.id);
      setEditingBinding(null);
      setFeedback({ type: "success", message: "ID binding actualizado correctamente." });
    } catch (err: any) {
      setFeedback({ type: "error", message: err?.message || "Error inesperado al actualizar binding." });
    } finally {
      setIsUpdatingBinding(false);
    }
  };

  const handleConfirmDeleteBinding = async () => {
    if (!selectedClient || !deletingBinding) return;

    setIsDeletingBinding(true);
    try {
      const res = await fetch(`/api/clients/${selectedClient.id}/bindings/${deletingBinding.id}`, {
        method: "DELETE",
      });

      if (res.ok) {
        await loadBindings(selectedClient.id);
        setFeedback({ type: "success", message: "ID liberado exitosamente." });
        setDeletingBinding(null);
      } else {
        const data = await res.json().catch(() => ({}));
        setFeedback({ type: "error", message: data?.error?.message || "Error al liberar ID." });
      }
    } catch (err: any) {
      setFeedback({ type: "error", message: err?.message || "Error de red al liberar ID." });
    } finally {
      setIsDeletingBinding(false);
    }
  };


  const loadWidgets = useCallback(async (clientId: string) => {
    setIsLoadingWidgets(true);
    setWidgetsError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/widgets`);
      if (res.ok) {
        const data = await res.json();
        setWidgets(Array.isArray(data) ? data : []);
      } else {
        const data = await res.json().catch(() => ({}));
        setWidgetsError(data?.error?.message || "No se pudieron cargar los widgets.");
      }
    } catch (err: any) {
      setWidgetsError(err?.message || "Error al consultar widgets.");
    } finally {
      setIsLoadingWidgets(false);
    }
  }, []);

  const handleCreateWidget = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClient) return;

    setIsCreatingWidget(true);
    setCreateWidgetError(null);

    try {
      const res = await fetch(`/api/clients/${selectedClient.id}/widgets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: widgetName.trim() || undefined,
          greeting: widgetGreeting.trim() || undefined,
          theme: {
            primary_color: widgetPrimaryColor,
            position: widgetPosition,
          },
          allowed_sources: widgetAllowedSources,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setCreateWidgetError(data?.error?.message || "Error al crear widget.");
        return;
      }

      await loadWidgets(selectedClient.id);
      setIsCreateWidgetOpen(false);
      setWidgetName("");
      setWidgetGreeting("¡Hola! ¿En qué podemos ayudarte hoy?");
      setWidgetPrimaryColor("#4f46e5");
      setWidgetPosition("bottom-right");
      setWidgetAllowedSources(["web"]);
      setFeedback({ type: "success", message: `Widget "${data.name}" creado exitosamente.` });
    } catch (err: any) {
      setCreateWidgetError(err?.message || "Error inesperado al crear widget.");
    } finally {
      setIsCreatingWidget(false);
    }
  };

  const handleConfirmDeleteWidget = async () => {
    if (!selectedClient || !deletingWidget) return;

    setIsDeletingWidget(true);
    try {
      const res = await fetch(
        `/api/clients/${selectedClient.id}/widgets/${deletingWidget.id}`,
        { method: "DELETE" }
      );

      if (res.ok) {
        await loadWidgets(selectedClient.id);
        setFeedback({ type: "success", message: `Widget "${deletingWidget.name}" desactivado exitosamente.` });
        setDeletingWidget(null);
      } else {
        const data = await res.json().catch(() => ({}));
        setFeedback({ type: "error", message: data?.error?.message || "No se pudo desactivar el widget." });
      }
    } catch (err: any) {
      setFeedback({ type: "error", message: err?.message || "Error de red al desactivar widget." });
    } finally {
      setIsDeletingWidget(false);
    }
  };

  const handleOpenEditWidget = (w: ClientWidget) => {
    setEditingWidget(w);
    setEditWidgetName(w.name || "");
    setEditWidgetGreeting(w.greeting || "¡Hola! ¿En qué podemos ayudarte hoy?");
    setEditWidgetPrimaryColor(w.theme?.primary_color || w.theme?.primaryColor || "#4f46e5");
    setEditWidgetPosition((w.theme?.position as any) || "bottom-right");
    setEditWidgetAllowedSources(Array.isArray(w.allowed_sources) ? w.allowed_sources : ["web"]);
    setEditWidgetError(null);
  };

  const handleUpdateWidget = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClient || !editingWidget) return;

    setIsUpdatingWidget(true);
    setEditWidgetError(null);

    try {
      const res = await fetch(`/api/clients/${selectedClient.id}/widgets/${editingWidget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editWidgetName.trim() || undefined,
          greeting: editWidgetGreeting.trim() || undefined,
          theme: {
            primary_color: editWidgetPrimaryColor,
            primaryColor: editWidgetPrimaryColor,
            position: editWidgetPosition,
          },
          allowed_sources: editWidgetAllowedSources,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setEditWidgetError(data?.error?.message || "Error al actualizar widget.");
        return;
      }

      await loadWidgets(selectedClient.id);
      setEditingWidget(null);
      setFeedback({ type: "success", message: `Widget "${data.name}" actualizado exitosamente.` });
    } catch (err: any) {
      setEditWidgetError(err?.message || "Error inesperado al actualizar widget.");
    } finally {
      setIsUpdatingWidget(false);
    }
  };


  const loadMembers = useCallback(async (clientId: string) => {
    setIsLoadingMembers(true);
    setMembersError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/members`);
      if (res.ok) {
        const data = await res.json();
        setMembers(Array.isArray(data) ? data : []);
      } else {
        const data = await res.json().catch(() => ({}));
        setMembersError(data?.error?.message || "No se pudieron cargar los miembros del workspace.");
      }
    } catch (err: any) {
      setMembersError(err?.message || "Error al consultar miembros.");
    } finally {
      setIsLoadingMembers(false);
    }
  }, []);

  const loadInvites = useCallback(async (clientId: string) => {
    setIsLoadingInvites(true);
    setInvitesError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/invites`);
      if (res.ok) {
        const data = await res.json();
        setInvites(Array.isArray(data) ? data : []);
      } else {
        const data = await res.json().catch(() => ({}));
        setInvitesError(data?.error?.message || "No se pudieron cargar las invitaciones.");
      }
    } catch (err: any) {
      setInvitesError(err?.message || "Error al consultar invitaciones.");
    } finally {
      setIsLoadingInvites(false);
    }
  }, []);

  const handleCreateInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClient || !inviteEmail.trim()) return;

    setIsSubmittingInvite(true);
    setInviteError(null);

    try {
      const res = await fetch(`/api/clients/${selectedClient.id}/invites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: inviteEmail.trim(),
          role: inviteRole,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setInviteError(data?.error?.message || "Error al generar invitación.");
        return;
      }

      setCreatedInviteResult(data);
      setInviteEmail("");
      setInviteRole("member");
      setHasCopiedInviteLink(false);
      await loadInvites(selectedClient.id);
    } catch (err: any) {
      setInviteError(err?.message || "Error inesperado al generar invitación.");
    } finally {
      setIsSubmittingInvite(false);
    }
  };


  const loadPermissions = useCallback(async (clientId: string) => {
    setIsLoadingPermissions(true);
    setPermissionsError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/permissions`);
      if (res.ok) {
        const data = await res.json();
        setPermissionsMatrix(data);
      } else {
        const errData = await res.json().catch(() => ({}));
        setPermissionsError(errData?.error?.message || "No se pudo cargar la matriz de permisos.");
      }
    } catch (err: any) {
      setPermissionsError(err?.message || "Error al consultar permisos.");
    } finally {
      setIsLoadingPermissions(false);
    }
  }, []);

  const handleTogglePermission = async (section: PermSection, action: PermAction, currentVal: boolean) => {
    if (!selectedClient || !permissionsMatrix) return;
    const newVal = !currentVal;

    // Actualización optimista local
    setPermissionsMatrix((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        roles: {
          ...prev.roles,
          [selectedPermRole]: {
            ...prev.roles[selectedPermRole],
            [section]: {
              ...prev.roles[selectedPermRole][section],
              [action]: newVal,
            },
          },
        },
      };
    });

    try {
      const res = await fetch(`/api/clients/${selectedClient.id}/permissions`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: selectedPermRole,
          section,
          action,
          allowed: newVal,
        }),
      });

      if (!res.ok) {
        // Revertir ante error
        setPermissionsMatrix((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            roles: {
              ...prev.roles,
              [selectedPermRole]: {
                ...prev.roles[selectedPermRole],
                [section]: {
                  ...prev.roles[selectedPermRole][section],
                  [action]: currentVal,
                },
              },
            },
          };
        });
        setFeedback({ type: "error", message: "Error al actualizar el permiso en el servidor." });
      }
    } catch (err: any) {
      setFeedback({ type: "error", message: err?.message || "Error de red al guardar permiso." });
    }
  };

  const handleConfirmApplyPreset = async () => {
    if (!selectedClient || !confirmingPreset) return;

    setIsApplyingPreset(true);
    try {
      const res = await fetch(`/api/clients/${selectedClient.id}/permissions/preset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          preset: confirmingPreset,
          role: selectedPermRole,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (res.ok) {
        await loadPermissions(selectedClient.id);
        setFeedback({
          type: "success",
          message: `Preset "${confirmingPreset}" aplicado exitosamente al rol ${selectedPermRole.toUpperCase()}.`,
        });
        setConfirmingPreset(null);
      } else {
        setFeedback({
          type: "error",
          message: data?.error?.message || "Error al aplicar el preset.",
        });
      }
    } catch (err: any) {
      setFeedback({
        type: "error",
        message: err?.message || "Error inesperado al aplicar preset.",
      });
    } finally {
      setIsApplyingPreset(false);
    }
  };


  const loadConsumption = useCallback(async (clientId: string) => {
    setIsLoadingConsumption(true);
    setConsumptionError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/consumption`);
      if (res.ok) {
        const data = await res.json();
        setConsumptionData(data);
      } else {
        const errData = await res.json().catch(() => ({}));
        setConsumptionError(errData?.error?.message || "No se pudieron cargar las métricas de consumo.");
      }
    } catch (err: any) {
      setConsumptionError(err?.message || "Error al consultar consumo.");
    } finally {
      setIsLoadingConsumption(false);
    }
  }, []);


  const loadBillingEstimate = useCallback(async (clientId: string) => {
    setIsLoadingBilling(true);
    setBillingError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/billing`);
      if (res.ok) {
        const data = await res.json();
        setBillingEstimate(data);
      } else {
        const errData = await res.json().catch(() => ({}));
        setBillingError(errData?.error?.message || "No se pudo cargar la estimación de facturación.");
      }
    } catch (err: any) {
      setBillingError(err?.message || "Error al consultar facturación.");
    } finally {
      setIsLoadingBilling(false);
    }
  }, []);

  const loadInvoices = useCallback(async (clientId: string) => {
    setIsLoadingInvoices(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/billing/invoices`);
      if (res.ok) {
        const data = await res.json();
        setInvoices(Array.isArray(data) ? data : []);
      }
    } catch (err: any) {
      console.error("Error al cargar facturas:", err);
    } finally {
      setIsLoadingInvoices(false);
    }
  }, []);

  const handleGenerateInvoice = async () => {
    if (!selectedClient) return;

    setIsGeneratingInvoice(true);
    try {
      const res = await fetch(`/api/clients/${selectedClient.id}/billing/invoices`, {
        method: "POST",
      });

      const data = await res.json().catch(() => ({}));

      if (res.status === 409) {
        setFeedback({ type: "error", message: data?.error?.message || "Ya existe una factura para este período." });
        return;
      }

      if (!res.ok) {
        setFeedback({ type: "error", message: data?.error?.message || "Error al generar factura del mes." });
        return;
      }

      await loadInvoices(selectedClient.id);
      setFeedback({ type: "success", message: `Factura para el período ${data.period} generada correctamente.` });
    } catch (err: any) {
      setFeedback({ type: "error", message: err?.message || "Error inesperado al generar factura." });
    } finally {
      setIsGeneratingInvoice(false);
    }
  };

  const handleUpdateInvoiceStatus = async () => {
    if (!selectedClient || !confirmInvoiceAction) return;

    setIsUpdatingInvoice(true);
    try {
      const res = await fetch(`/api/clients/${selectedClient.id}/billing/invoices/${confirmInvoiceAction.invoice.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: confirmInvoiceAction.nextStatus }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setFeedback({ type: "error", message: data?.error?.message || "Error al actualizar estado de la factura." });
        return;
      }

      await loadInvoices(selectedClient.id);
      const actionLabel = confirmInvoiceAction.nextStatus === "paid" ? "marcada como pagada" : "cancelada";
      setFeedback({ type: "success", message: `Factura ${confirmInvoiceAction.invoice.period} ${actionLabel} exitosamente.` });
      setConfirmInvoiceAction(null);
    } catch (err: any) {
      setFeedback({ type: "error", message: err?.message || "Error inesperado al actualizar factura." });
    } finally {
      setIsUpdatingInvoice(false);
    }
  };

  const handleOpenDetail = (client: Client) => {
    setSelectedClient(client);
    loadClientDetail(client.id);
    loadClientAiData(client.id);
    loadBlueprints();
    loadClientIntegrations(client.id);
    loadSiteKeys(client.id);
    loadBindings(client.id);
    loadWidgets(client.id);
    loadMembers(client.id);
    loadInvites(client.id);
    loadPermissions(client.id);
    loadConsumption(client.id);
    loadBillingEstimate(client.id);
    loadInvoices(client.id);
    setActiveDetailTab("general");
  };

  // 1. Crear Cliente
  const handleCreateClient = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError(null);

    if (!displayName.trim()) {
      setCreateError("El nombre del negocio es obligatorio.");
      return;
    }

    setIsCreating(true);
    try {
      const res = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          display_name: displayName.trim(),
          website_url: websiteUrl.trim() || undefined,
          contact_name: contactName.trim() || undefined,
          contact_email: contactEmail.trim() || undefined,
          contact_phone: contactPhone.trim() || undefined,
          credit_limit_monthly: creditLimitMonthly ? Number(creditLimitMonthly) : null,
          notes: notes.trim() || undefined,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setCreateError(data?.error?.message || "Error al registrar el cliente.");
        return;
      }

      setFeedback({ type: "success", message: `Cliente "${displayName.trim()}" creado exitosamente.` });
      setIsCreateOpen(false);
      setDisplayName("");
      setWebsiteUrl("");
      setContactName("");
      setContactEmail("");
      setContactPhone("");
      setCreditLimitMonthly("");
      setNotes("");
      loadClients();
    } catch (err: any) {
      setCreateError(err?.message || "Ocurrió un error inesperado al registrar el cliente.");
    } finally {
      setIsCreating(false);
    }
  };

  // 2. Verificar Web
  const handleVerifyWebsite = async (client: Client) => {
    if (!client.website_url) return;

    setVerifyingIds((prev) => ({ ...prev, [client.id]: true }));
    try {
      const res = await fetch(`/api/clients/${client.id}/verify`, { method: "POST" });
      const data = await res.json().catch(() => ({}));

      if (res.ok && data.ok) {
        setVerifyResults((prev) => ({
          ...prev,
          [client.id]: { ok: true, status: data.status || 200 },
        }));
      } else {
        setVerifyResults((prev) => ({
          ...prev,
          [client.id]: { ok: false, error: data.error || "No respondió" },
        }));
      }
    } catch (err: any) {
      setVerifyResults((prev) => ({
        ...prev,
        [client.id]: { ok: false, error: err?.message || "Error de red" },
      }));
    } finally {
      setVerifyingIds((prev) => ({ ...prev, [client.id]: false }));
      setTimeout(() => {
        setVerifyResults((prev) => {
          const next = { ...prev };
          delete next[client.id];
          return next;
        });
      }, 7000);
    }
  };

  // 3. Editar Cliente
  const handleOpenEdit = (client: Client) => {
    setEditingClient(client);
    setEditDisplayName(client.display_name || "");
    setEditWebsiteUrl(client.website_url || "");
    setEditContactName(client.contact_name || "");
    setEditContactEmail(client.contact_email || "");
    setEditContactPhone(client.contact_phone || "");
    setEditCreditLimitMonthly(client.credit_limit_monthly != null ? String(client.credit_limit_monthly) : "");
    setEditNotes(client.notes || "");
    setUpdateError(null);
  };

  const handleUpdateClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingClient) return;
    setUpdateError(null);

    if (!editDisplayName.trim()) {
      setUpdateError("El nombre del negocio no puede estar vacío.");
      return;
    }

    setIsUpdating(true);
    try {
      const res = await fetch(`/api/clients/${editingClient.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          display_name: editDisplayName.trim(),
          website_url: editWebsiteUrl.trim() || null,
          contact_name: editContactName.trim() || null,
          contact_email: editContactEmail.trim() || null,
          contact_phone: editContactPhone.trim() || null,
          credit_limit_monthly: editCreditLimitMonthly ? Number(editCreditLimitMonthly) : null,
          notes: editNotes.trim() || null,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setUpdateError(data?.error?.message || "Error al actualizar los datos del cliente.");
        return;
      }

      setFeedback({ type: "success", message: `Cliente "${editDisplayName.trim()}" actualizado correctamente.` });
      setEditingClient(null);

      if (selectedClient && selectedClient.id === editingClient.id) {
        setSelectedClient(data);
        loadClientDetail(data.id);
      }

      loadClients();
    } catch (err: any) {
      setUpdateError(err?.message || "Ocurrió un error inesperado al actualizar.");
    } finally {
      setIsUpdating(false);
    }
  };

  // 4. Pausar / Reanudar Cliente
  const handleToggleStatus = async () => {
    if (!statusToggleClient) return;
    const nextStatus = statusToggleClient.status === "active" ? "inactive" : "active";

    setIsTogglingStatus(true);
    try {
      const res = await fetch(`/api/clients/${statusToggleClient.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFeedback({ type: "error", message: data?.error?.message || "No se pudo cambiar el estado del cliente." });
      } else {
        setFeedback({
          type: "success",
          message: `Cliente "${statusToggleClient.display_name}" ${nextStatus === "active" ? "reanudado (activo)" : "pausado (inactivo)"}.`,
        });

        if (selectedClient && selectedClient.id === statusToggleClient.id) {
          setSelectedClient(data);
          if (clientDetail) {
            setClientDetail({ ...clientDetail, client: data });
          }
        }
        loadClients();
      }
    } catch (err: any) {
      setFeedback({ type: "error", message: err?.message || "Error al cambiar estado." });
    } finally {
      setIsTogglingStatus(false);
      setStatusToggleClient(null);
    }
  };

  // 5. Eliminar Cliente
  const handleConfirmDelete = async () => {
    if (!deletingClient) return;
    setIsDeleting(true);
    setDeleteError(null);

    try {
      const res = await fetch(`/api/clients/${deletingClient.id}`, {
        method: "DELETE",
      });

      const data = await res.json().catch(() => ({}));

      if (res.status === 409 || data?.error?.code === "ACTIVE_RUNS_EXIST") {
        setDeleteError("tiene ejecuciones activas");
        return;
      }

      if (!res.ok) {
        setDeleteError(data?.error?.message || "Error al eliminar el cliente.");
        return;
      }

      setFeedback({ type: "success", message: `Cliente "${deletingClient.display_name}" eliminado correctamente.` });
      if (selectedClient && selectedClient.id === deletingClient.id) {
        setSelectedClient(null);
        setClientDetail(null);
      }
      setDeletingClient(null);
      loadClients();
    } catch (err: any) {
      setDeleteError(err?.message || "Error inesperado al intentar eliminar el cliente.");
    } finally {
      setIsDeleting(false);
    }
  };

  // Contadores
  const activeCount = clients.filter((c) => c.status === "active").length;
  const inactiveCount = clients.filter((c) => c.status === "inactive").length;

  return (
    <DashboardShell
      title="Gestión de Clientes"
      subtitle="Administración de cuentas de clientes, workspaces dedicados y verificación web"
    >
      <div className="space-y-6">
        {/* ENCABEZADO CON CONTADORES */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-texter-border pb-5">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="p-3.5 rounded-2xl bg-texter-surface border border-texter-border flex items-center gap-3 min-w-[140px]">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
              <div>
                <p className="text-[11px] font-mono text-texter-text-muted uppercase tracking-wider">Activos</p>
                <p className="text-xl font-bold font-mono text-white">{activeCount}</p>
              </div>
            </div>

            <div className="p-3.5 rounded-2xl bg-texter-surface border border-texter-border flex items-center gap-3 min-w-[140px]">
              <span className="w-2.5 h-2.5 rounded-full bg-texter-text-dim" />
              <div>
                <p className="text-[11px] font-mono text-texter-text-muted uppercase tracking-wider">Inactivos</p>
                <p className="text-xl font-bold font-mono text-white">{inactiveCount}</p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={loadClients} disabled={isLoading}>
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
              <span>Refrescar</span>
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                setIsCreateOpen(true);
                setCreateError(null);
              }}
              className="flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" />
              <span>Nuevo cliente</span>
            </Button>
          </div>
        </div>

        {/* Notificaciones globales */}
        {feedback && (
          <div
            className={`p-3.5 rounded-xl text-xs flex items-center justify-between border ${
              feedback.type === "success"
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                : "bg-texter-rose/10 border-texter-rose/30 text-rose-300"
            }`}
          >
            <span className="flex items-center gap-2 font-mono">
              {feedback.type === "success" ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-texter-rose shrink-0" />
              )}
              {feedback.message}
            </span>
            <button onClick={() => setFeedback(null)} className="text-texter-text-dim hover:text-white">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* TABLA DE CLIENTES */}
        <Card variant="elevated" className="space-y-4">
          <div className="flex items-center gap-2.5 border-b border-texter-border pb-3">
            <Building2 className="w-5 h-5 text-texter-cyan" />
            <div>
              <h2 className="text-base font-bold text-white">Directorio de Clientes</h2>
              <p className="text-xs text-texter-text-muted">
                Cuentas registradas con aislamiento de datos y cuotas de consumo
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-texter-surface-subtle text-texter-text-muted border-b border-texter-border uppercase tracking-wider font-mono">
                <tr>
                  <th className="p-3">Negocio</th>
                  <th className="p-3">Web</th>
                  <th className="p-3">Contacto</th>
                  <th className="p-3">Estado</th>
                  <th className="p-3">Límite mensual</th>
                  <th className="p-3 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-texter-border/50">
                {clients.map((client) => {
                  const verifyInfo = verifyResults[client.id];
                  const isVerifyingThis = verifyingIds[client.id];

                  return (
                    <tr key={client.id} className="hover:bg-texter-surface-hover/50 transition-colors">
                      <td className="p-3">
                        <div className="font-semibold text-white flex items-center gap-2">
                          <Users className="w-3.5 h-3.5 text-texter-indigo" />
                          <span>{client.display_name}</span>
                        </div>
                        {client.workspace?.name && (
                          <span className="text-[10px] text-texter-text-dim font-mono">
                            WS: {client.workspace.name}
                          </span>
                        )}
                      </td>

                      <td className="p-3 font-mono">
                        {client.website_url ? (
                          <div className="flex items-center gap-2">
                            <a
                              href={client.website_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-texter-cyan hover:underline flex items-center gap-1 truncate max-w-[200px]"
                              title={client.website_url}
                            >
                              <span>{client.website_url.replace(/^https?:\/\//, "")}</span>
                              <ExternalLink className="w-3 h-3 shrink-0" />
                            </a>
                            {verifyInfo && (
                              verifyInfo.ok ? (
                                <Badge variant="success" size="sm" className="text-[10px] whitespace-nowrap">
                                  ✓ Web OK ({verifyInfo.status || 200})
                                </Badge>
                              ) : (
                                <Badge variant="danger" size="sm" className="text-[10px] whitespace-nowrap" title={verifyInfo.error}>
                                  ✗ Error: {verifyInfo.error?.slice(0, 20)}...
                                </Badge>
                              )
                            )}
                          </div>
                        ) : (
                          <span className="text-texter-text-dim">—</span>
                        )}
                      </td>

                      <td className="p-3 text-texter-text-muted">
                        <div>{client.contact_name || client.contact_email || "—"}</div>
                        {client.contact_phone && (
                          <div className="text-[10px] font-mono text-texter-text-dim">
                            {client.contact_phone}
                          </div>
                        )}
                      </td>

                      <td className="p-3">
                        {client.status === "active" ? (
                          <Badge variant="success" size="sm" dot>Activo</Badge>
                        ) : (
                          <Badge variant="default" size="sm" dot>Inactivo</Badge>
                        )}
                      </td>

                      <td className="p-3 font-mono text-texter-text-secondary">
                        {client.credit_limit_monthly != null ? (
                          <span>{client.credit_limit_monthly.toLocaleString()} créditos</span>
                        ) : (
                          <span className="text-texter-text-dim">Sin límite</span>
                        )}
                      </td>

                      <td className="p-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleOpenDetail(client)}
                            className="text-[11px] h-7 px-2.5"
                          >
                            <Eye className="w-3 h-3 text-texter-cyan mr-1" />
                            Ver
                          </Button>

                          {client.website_url && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleVerifyWebsite(client)}
                              disabled={isVerifyingThis}
                              className="text-[11px] h-7 px-2 text-texter-text-secondary hover:text-white"
                              title="Verificar disponibilidad web"
                            >
                              <Globe className={`w-3 h-3 ${isVerifyingThis ? "animate-spin text-texter-cyan" : ""}`} />
                            </Button>
                          )}

                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setDeletingClient(client);
                              setDeleteError(null);
                            }}
                            className="text-[11px] h-7 px-2 text-texter-text-dim hover:text-rose-400"
                            title="Eliminar cliente"
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}

                {clients.length === 0 && !isLoading && (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-texter-text-dim">
                      No hay clientes registrados en este sistema. Haz clic en "Nuevo cliente" para crear uno.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        {/* DETALLE DEL CLIENTE */}
        {selectedClient && (
          <Card variant="elevated" className="space-y-5 border-texter-indigo/40 bg-texter-surface">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-texter-border pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-bold text-white">{selectedClient.display_name}</h3>
                  {selectedClient.status === "active" ? (
                    <Badge variant="success" size="sm" dot>Activo</Badge>
                  ) : (
                    <Badge variant="default" size="sm" dot>Inactivo</Badge>
                  )}
                </div>
                <p className="text-xs font-mono text-texter-text-muted mt-1">
                  ID: {selectedClient.id} • Creado: {new Date(selectedClient.created_at).toLocaleDateString()}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleOpenEdit(selectedClient)}
                  className="flex items-center gap-1.5 text-xs"
                >
                  <Edit3 className="w-3.5 h-3.5 text-texter-cyan" />
                  Editar
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setStatusToggleClient(selectedClient)}
                  className="flex items-center gap-1.5 text-xs"
                >
                  {selectedClient.status === "active" ? (
                    <>
                      <Pause className="w-3.5 h-3.5 text-amber-400" />
                      <span>Pausar</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Reanudar</span>
                    </>
                  )}
                </Button>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSelectedClient(null);
                    setClientDetail(null);
                  }}
                >
                  Cerrar
                </Button>
              </div>
            </div>

            {/* Selector de Pestañas */}
            <div className="flex items-center gap-2 border-b border-texter-border pb-2">
              <button
                type="button"
                onClick={() => setActiveDetailTab("general")}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                  activeDetailTab === "general"
                    ? "bg-texter-indigo text-white shadow-sm"
                    : "text-texter-text-muted hover:text-white hover:bg-texter-surface-hover"
                }`}
              >
                <Briefcase className="w-3.5 h-3.5" />
                <span>General & Recursos</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setActiveDetailTab("ai");
                  if (selectedClient) loadClientAiData(selectedClient.id);
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                  activeDetailTab === "ai"
                    ? "bg-texter-cyan text-texter-bg shadow-sm font-bold"
                    : "text-texter-text-muted hover:text-white hover:bg-texter-surface-hover"
                }`}
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Configuración de IA</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setActiveDetailTab("integrations");
                  if (selectedClient) {
                    loadBlueprints();
                    loadClientIntegrations(selectedClient.id);
                  }
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                  activeDetailTab === "integrations"
                    ? "bg-purple-600 text-white shadow-sm font-bold"
                    : "text-texter-text-muted hover:text-white hover:bg-texter-surface-hover"
                }`}
              >
                <Workflow className="w-3.5 h-3.5" />
                <span>Integraciones</span>
                {clientIntegrations.filter((i) => i.is_active).length > 0 && (
                  <Badge variant="cyan" size="sm" className="ml-1 text-[10px] px-1.5 py-0 font-mono">
                    {clientIntegrations.filter((i) => i.is_active).length}
                  </Badge>
                )}
              </button>

              <button
                type="button"
                onClick={() => {
                  setActiveDetailTab("connections");
                  if (selectedClient) {
                    loadSiteKeys(selectedClient.id);
                    loadBindings(selectedClient.id);
                  }
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                  activeDetailTab === "connections"
                    ? "bg-emerald-600 text-white shadow-sm font-bold"
                    : "text-texter-text-muted hover:text-white hover:bg-texter-surface-hover"
                }`}
              >
                <Link2 className="w-3.5 h-3.5" />
                <span>Conexiones</span>
                {siteKeys.filter((k) => k.is_active).length > 0 && (
                  <Badge variant="success" size="sm" className="ml-1 text-[10px] px-1.5 py-0 font-mono">
                    {siteKeys.filter((k) => k.is_active).length}
                  </Badge>
                )}
              </button>

              <button
                type="button"
                onClick={() => {
                  setActiveDetailTab("widget");
                  if (selectedClient) {
                    loadWidgets(selectedClient.id);
                  }
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                  activeDetailTab === "widget"
                    ? "bg-blue-600 text-white shadow-sm font-bold"
                    : "text-texter-text-muted hover:text-white hover:bg-texter-surface-hover"
                }`}
              >
                <Bot className="w-3.5 h-3.5" />
                <span>Widget</span>
                {widgets.filter((w) => w.is_active).length > 0 && (
                  <Badge variant="cyan" size="sm" className="ml-1 text-[10px] px-1.5 py-0 font-mono">
                    {widgets.filter((w) => w.is_active).length}
                  </Badge>
                )}
              </button>

              <button
                type="button"
                onClick={() => {
                  setActiveDetailTab("users");
                  if (selectedClient) {
                    loadMembers(selectedClient.id);
                    loadInvites(selectedClient.id);
                  }
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                  activeDetailTab === "users"
                    ? "bg-amber-600 text-white shadow-sm font-bold"
                    : "text-texter-text-muted hover:text-white hover:bg-texter-surface-hover"
                }`}
              >
                <Users className="w-3.5 h-3.5" />
                <span>Usuarios</span>
                {members.length > 0 && (
                  <Badge variant="warning" size="sm" className="ml-1 text-[10px] px-1.5 py-0 font-mono">
                    {members.length}
                  </Badge>
                )}
              </button>

              <button
                type="button"
                onClick={() => {
                  setActiveDetailTab("permissions");
                  if (selectedClient) {
                    loadPermissions(selectedClient.id);
                  }
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                  activeDetailTab === "permissions"
                    ? "bg-rose-600 text-white shadow-sm font-bold"
                    : "text-texter-text-muted hover:text-white hover:bg-texter-surface-hover"
                }`}
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Permisos</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setActiveDetailTab("consumption");
                  if (selectedClient) {
                    loadConsumption(selectedClient.id);
                  }
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                  activeDetailTab === "consumption"
                    ? "bg-cyan-600 text-white shadow-sm font-bold"
                    : "text-texter-text-muted hover:text-white hover:bg-texter-surface-hover"
                }`}
              >
                <Zap className="w-3.5 h-3.5" />
                <span>Consumo</span>
                {consumptionData?.budget?.exceeded && (
                  <span className="w-2 h-2 rounded-full bg-texter-rose animate-pulse" title="Presupuesto excedido" />
                )}
              </button>

              <button
                type="button"
                onClick={() => {
                  setActiveDetailTab("billing");
                  if (selectedClient) {
                    loadBillingEstimate(selectedClient.id);
                    loadInvoices(selectedClient.id);
                  }
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                  activeDetailTab === "billing"
                    ? "bg-emerald-600 text-white shadow-sm font-bold"
                    : "text-texter-text-muted hover:text-white hover:bg-texter-surface-hover"
                }`}
              >
                <Receipt className="w-3.5 h-3.5" />
                <span>Facturación</span>
                {invoices.some((i) => i.status === "pending") && (
                  <span className="w-2 h-2 rounded-full bg-amber-400" title="Factura pendiente" />
                )}
              </button>
            </div>

            {/* PESTAÑA 1: GENERAL */}
            {activeDetailTab === "general" && (
              <div className="space-y-5">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="p-3.5 rounded-xl bg-texter-surface-subtle border border-texter-border flex items-center justify-between">
                    <div>
                      <span className="text-[11px] text-texter-text-muted uppercase font-mono">Automatizaciones</span>
                      <p className="text-xl font-bold font-mono text-texter-cyan mt-1">
                        {isLoadingDetail ? "..." : clientDetail?.counts?.automations ?? 0}
                      </p>
                    </div>
                    <Workflow className="w-6 h-6 text-texter-cyan/40" />
                  </div>

                  <div className="p-3.5 rounded-xl bg-texter-surface-subtle border border-texter-border flex items-center justify-between">
                    <div>
                      <span className="text-[11px] text-texter-text-muted uppercase font-mono">Trabajos (Jobs)</span>
                      <p className="text-xl font-bold font-mono text-texter-indigo mt-1">
                        {isLoadingDetail ? "..." : clientDetail?.counts?.jobs ?? 0}
                      </p>
                    </div>
                    <Briefcase className="w-6 h-6 text-texter-indigo/40" />
                  </div>

                  <div className="p-3.5 rounded-xl bg-texter-surface-subtle border border-texter-border flex items-center justify-between">
                    <div>
                      <span className="text-[11px] text-texter-text-muted uppercase font-mono">Agentes Autónomos</span>
                      <p className="text-xl font-bold font-mono text-emerald-400 mt-1">
                        {isLoadingDetail ? "..." : clientDetail?.counts?.agents ?? 0}
                      </p>
                    </div>
                    <Bot className="w-6 h-6 text-emerald-400/40" />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 p-4 rounded-xl bg-texter-surface-subtle border border-texter-border text-xs">
                  <div className="space-y-1">
                    <span className="text-texter-text-dim font-mono">Sitio Web:</span>
                    <p className="text-white font-mono break-all">
                      {selectedClient.website_url ? (
                        <a
                          href={selectedClient.website_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-texter-cyan hover:underline inline-flex items-center gap-1"
                        >
                          {selectedClient.website_url}
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      ) : (
                        "No configurado"
                      )}
                    </p>
                  </div>

                  <div className="space-y-1">
                    <span className="text-texter-text-dim font-mono">Contacto:</span>
                    <p className="text-white">{selectedClient.contact_name || "—"}</p>
                    {selectedClient.contact_email && (
                      <p className="text-texter-text-muted font-mono">{selectedClient.contact_email}</p>
                    )}
                    {selectedClient.contact_phone && (
                      <p className="text-texter-text-muted font-mono">{selectedClient.contact_phone}</p>
                    )}
                  </div>

                  <div className="space-y-1">
                    <span className="text-texter-text-dim font-mono">Límite de Créditos:</span>
                    <p className="text-white font-mono">
                      {selectedClient.credit_limit_monthly != null
                        ? `${selectedClient.credit_limit_monthly.toLocaleString()} / mes`
                        : "Sin límite mensual"}
                    </p>
                  </div>

                  <div className="space-y-1">
                    <span className="text-texter-text-dim font-mono">Workspace Vinculado:</span>
                    <p className="text-white font-mono truncate">
                      {clientDetail?.workspace?.name || selectedClient.workspace?.name || "Workspace Dedicado"}
                    </p>
                  </div>

                  {selectedClient.notes && (
                    <div className="col-span-full pt-2 border-t border-texter-border space-y-1">
                      <span className="text-texter-text-dim font-mono">Notas del Cliente:</span>
                      <p className="text-texter-text-secondary leading-relaxed bg-texter-surface p-2.5 rounded-lg border border-texter-border">
                        {selectedClient.notes}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* PESTAÑA 2: CONFIGURACIÓN DE IA */}
            {activeDetailTab === "ai" && (
              <div className="space-y-5">
                {aiActionError && (
                  <div className="p-3 rounded-xl bg-texter-rose/10 border border-texter-rose/30 text-xs text-rose-300 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-texter-rose shrink-0 mt-0.5" />
                    <span>{aiActionError}</span>
                  </div>
                )}

                {/* 1. Selector de Modo IA */}
                <div className="p-4 rounded-xl bg-texter-surface-subtle border border-texter-border space-y-3">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                    <div>
                      <h4 className="text-sm font-bold text-white flex items-center gap-2">
                        <Cpu className="w-4 h-4 text-texter-cyan" />
                        Modo de Facturación de IA
                      </h4>
                      <p className="text-xs text-texter-text-muted">
                        Define si el cliente consume la cuenta central de NEXTEX o utiliza sus propias claves (BYOK).
                      </p>
                    </div>
                    <Badge variant={aiConfig?.mode === "byok" ? "indigo" : "cyan"} size="md">
                      {aiConfig?.mode === "byok" ? "Claves Propias (BYOK)" : "NEXTEX Premium"}
                    </Badge>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                    <div
                      onClick={() => {
                        if (aiConfig?.mode !== "nextex_keys") setPendingModeChange("nextex_keys");
                      }}
                      className={`p-3.5 rounded-xl border cursor-pointer transition-all flex flex-col justify-between gap-2 ${
                        aiConfig?.mode === "nextex_keys"
                          ? "bg-texter-cyan/10 border-cyan-500/50 shadow-sm"
                          : "bg-texter-surface border-texter-border hover:border-texter-hover"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-xs text-white">Claves NEXTEX (Premium)</span>
                        {aiConfig?.mode === "nextex_keys" && <Check className="w-4 h-4 text-texter-cyan" />}
                      </div>
                      <p className="text-[11px] text-texter-text-dim">
                        Las peticiones de IA se canalizan por la infraestructura central de NEXTEX según el plan.
                      </p>
                    </div>

                    <div
                      onClick={() => {
                        if (aiConfig?.mode !== "byok") setPendingModeChange("byok");
                      }}
                      className={`p-3.5 rounded-xl border cursor-pointer transition-all flex flex-col justify-between gap-2 ${
                        aiConfig?.mode === "byok"
                          ? "bg-texter-indigo/15 border-indigo-500/50 shadow-sm"
                          : "bg-texter-surface border-texter-border hover:border-texter-hover"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-xs text-white">Claves Propias (BYOK)</span>
                        {aiConfig?.mode === "byok" && <Check className="w-4 h-4 text-texter-indigo" />}
                      </div>
                      <p className="text-[11px] text-texter-text-dim">
                        El cliente aporta sus propias API Keys de OpenAI, Gemini o Anthropic cifradas en la bóveda AES-GCM.
                      </p>
                    </div>
                  </div>
                </div>

                {/* 2. Bóveda de Claves de Proveedor (BYOK) */}
                <div className="p-4 rounded-xl bg-texter-surface-subtle border border-texter-border space-y-3">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 border-b border-texter-border pb-3">
                    <div>
                      <h4 className="text-sm font-bold text-white flex items-center gap-2">
                        <Key className="w-4 h-4 text-amber-400" />
                        Bóveda de Claves de Proveedores (BYOK)
                      </h4>
                      <p className="text-xs text-texter-text-muted">
                        Claves validadas contra las APIs oficiales y cifradas en reposo con AES-256-GCM.
                      </p>
                    </div>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => {
                        setIsAddKeyOpen(true);
                        setCreateKeyError(null);
                        setNewKeySecret("");
                        setNewKeyLabel("");
                      }}
                      className="flex items-center gap-1.5"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Agregar Clave</span>
                    </Button>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs font-mono">
                      <thead className="text-texter-text-muted uppercase border-b border-texter-border">
                        <tr>
                          <th className="py-2.5 px-3">Proveedor</th>
                          <th className="py-2.5 px-3">Etiqueta</th>
                          <th className="py-2.5 px-3">Terminación</th>
                          <th className="py-2.5 px-3">Fecha</th>
                          <th className="py-2.5 px-3 text-right">Acción</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-texter-border/50">
                        {aiKeys.map((k) => (
                          <tr key={k.id} className="hover:bg-texter-surface-hover/50 transition-colors">
                            <td className="py-2.5 px-3 uppercase text-texter-cyan font-bold">{k.provider}</td>
                            <td className="py-2.5 px-3 text-white font-sans">{k.label}</td>
                            <td className="py-2.5 px-3 text-texter-text-muted">••••{k.key_hint}</td>
                            <td className="py-2.5 px-3 text-texter-text-dim text-[11px]">
                              {new Date(k.created_at).toLocaleDateString()}
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              <button
                                type="button"
                                onClick={() => setDeletingKey(k)}
                                className="p-1 text-texter-text-dim hover:text-rose-400 transition-colors rounded"
                                title="Eliminar clave"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))}
                        {aiKeys.length === 0 && !isLoadingAi && (
                          <tr>
                            <td colSpan={5} className="py-6 text-center text-texter-text-dim font-sans">
                              No hay claves configuradas para este cliente. Haz clic en "Agregar Clave" para registrar una.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* 3. Configuración de Modelos y Cuotas */}
                <form onSubmit={handleSaveAiConfig} className="p-4 rounded-xl bg-texter-surface-subtle border border-texter-border space-y-4">
                  <h4 className="text-sm font-bold text-white flex items-center gap-2 border-b border-texter-border pb-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    Parámetros de Modelo y Control de Cuota
                  </h4>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Input
                      label="Modelo por Defecto"
                      value={cfgDefaultModel}
                      onChange={(e) => setCfgDefaultModel(e.target.value)}
                      placeholder="gemini-1.5-flash"
                      required
                    />

                    <Input
                      label="Límite Mensual de Tokens (opcional)"
                      type="number"
                      value={cfgMonthlyCap}
                      onChange={(e) => setCfgMonthlyCap(e.target.value)}
                      placeholder="ej: 1000000 (vacío para sin límite)"
                    />
                  </div>

                  <Input
                    label="Modelos Permitidos (Allowlist separados por coma)"
                    value={cfgAllowlistStr}
                    onChange={(e) => setCfgAllowlistStr(e.target.value)}
                    placeholder="gemini-1.5-flash, gemini-1.5-pro, gpt-4o"
                    required
                  />

                  <div className="flex justify-end pt-2 border-t border-texter-border">
                    <Button variant="primary" size="sm" type="submit" isLoading={isSavingConfig}>
                      Guardar Configuración de IA
                    </Button>
                  </div>
                </form>
              </div>
            )}

            {/* PESTAÑA 4: CONEXIONES (CONEX-3) */}
            {activeDetailTab === "connections" && (
              <div className="space-y-8">
                {/* 1. SECCIÓN: API KEYS DEL SITIO */}
                <div className="space-y-3">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 border-b border-texter-border pb-2.5">
                    <div>
                      <h4 className="text-sm font-bold text-white flex items-center gap-2">
                        <Key className="w-4 h-4 text-texter-cyan" />
                        API Keys del Sitio
                      </h4>
                      <p className="text-xs text-texter-text-muted">
                        Credenciales de autenticación para que la web del cliente invoque el backend de nextex
                      </p>
                    </div>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => {
                        setIsGenerateKeyOpen(true);
                        setGeneratedKeyResult(null);
                        setNewSiteKeyName("");
                      }}
                      className="flex items-center gap-1.5 text-xs"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Generar key
                    </Button>
                  </div>

                  {siteKeysError && (
                    <div className="p-3 rounded-xl bg-texter-rose/10 border border-texter-rose/30 text-xs text-rose-300 flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-texter-rose shrink-0 mt-0.5" />
                      <span>{siteKeysError}</span>
                    </div>
                  )}

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs font-mono">
                      <thead className="bg-texter-surface-subtle text-texter-text-muted border-b border-texter-border uppercase tracking-wider">
                        <tr>
                          <th className="p-2.5">Nombre</th>
                          <th className="p-2.5">Prefijo</th>
                          <th className="p-2.5">Estado</th>
                          <th className="p-2.5">Último Uso</th>
                          <th className="p-2.5 text-right">Acciones</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-texter-border/50">
                        {siteKeys.map((k) => (
                          <tr key={k.id} className="hover:bg-texter-surface-hover/50 transition-colors">
                            <td className="p-2.5 font-bold text-white font-sans">{k.name}</td>
                            <td className="p-2.5 text-texter-cyan font-bold">{k.key_prefix}...</td>
                            <td className="p-2.5">
                              {k.is_active ? (
                                <Badge variant="success" size="sm" dot>Activa</Badge>
                              ) : (
                                <Badge variant="default" size="sm" dot>Revocada</Badge>
                              )}
                            </td>
                            <td className="p-2.5 text-texter-text-dim text-[11px]">
                              {k.last_used_at ? new Date(k.last_used_at).toLocaleString() : "Nunca"}
                            </td>
                            <td className="p-2.5 text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setRegeneratingKey(k)}
                                  className="text-[11px] h-7 px-2"
                                  title="Regenerar clave"
                                >
                                  <RotateCcw className="w-3 h-3 mr-1" />
                                  <span>Regenerar</span>
                                </Button>
                                {k.is_active && (
                                  <Button
                                    variant="danger"
                                    size="sm"
                                    onClick={() => setRevokingKey(k)}
                                    className="text-[11px] h-7 px-2"
                                    title="Revocar clave"
                                  >
                                    <Trash2 className="w-3 h-3 mr-1" />
                                    <span>Revocar</span>
                                  </Button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                        {siteKeys.length === 0 && !isLoadingSiteKeys && (
                          <tr>
                            <td colSpan={5} className="p-6 text-center text-texter-text-dim font-sans">
                              No hay API keys generadas para este cliente. Haz clic en "Generar key" para habilitar el acceso web.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* 2. SECCIÓN: IDs VINCULADOS */}
                <div className="space-y-3">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 border-b border-texter-border pb-2.5">
                    <div>
                      <h4 className="text-sm font-bold text-white flex items-center gap-2">
                        <Hash className="w-4 h-4 text-purple-400" />
                        IDs Vinculados (Web ↔ Teléfono)
                      </h4>
                      <p className="text-xs text-texter-text-muted">
                        Mapeo de identificadores externos de visitantes web a números telefónicos del cliente
                      </p>
                    </div>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => {
                        setIsCreateBindingOpen(true);
                        setBindingExternalId("");
                        setBindingPhone("");
                        setBindingChannel("web");
                        setCreateBindingError(null);
                      }}
                      className="flex items-center gap-1.5 text-xs"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Vincular ID
                    </Button>
                  </div>

                  {bindingsError && (
                    <div className="p-3 rounded-xl bg-texter-rose/10 border border-texter-rose/30 text-xs text-rose-300 flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-texter-rose shrink-0 mt-0.5" />
                      <span>{bindingsError}</span>
                    </div>
                  )}

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs font-mono">
                      <thead className="bg-texter-surface-subtle text-texter-text-muted border-b border-texter-border uppercase tracking-wider">
                        <tr>
                          <th className="p-2.5">External ID</th>
                          <th className="p-2.5">Teléfono</th>
                          <th className="p-2.5">Canal</th>
                          <th className="p-2.5">Estado</th>
                          <th className="p-2.5 text-right">Acciones</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-texter-border/50">
                        {bindings.map((b) => (
                          <tr key={b.id} className="hover:bg-texter-surface-hover/50 transition-colors">
                            <td className="p-2.5 font-bold text-white text-xs">{b.external_id}</td>
                            <td className="p-2.5 text-texter-text-secondary">{b.phone || "—"}</td>
                            <td className="p-2.5">
                              <Badge
                                variant={
                                  b.channel === "web"
                                    ? "cyan"
                                    : b.channel === "whatsapp"
                                    ? "success"
                                    : b.channel === "instagram"
                                    ? "indigo"
                                    : "default"
                                }
                                size="sm"
                                className="uppercase text-[10px]"
                              >
                                {b.channel}
                              </Badge>
                            </td>
                            <td className="p-2.5">
                              {b.is_active ? (
                                <Badge variant="success" size="sm" dot>Activo</Badge>
                              ) : (
                                <Badge variant="default" size="sm" dot>Inactivo</Badge>
                              )}
                            </td>
                            <td className="p-2.5 text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => {
                                    setEditingBinding(b);
                                    setEditBindingPhone(b.phone || "");
                                    setEditBindingIsActive(b.is_active);
                                  }}
                                  className="text-[11px] h-7 px-2"
                                  title="Editar binding"
                                >
                                  <Edit3 className="w-3 h-3 mr-1" />
                                  <span>Editar</span>
                                </Button>
                                <Button
                                  variant="danger"
                                  size="sm"
                                  onClick={() => setDeletingBinding(b)}
                                  className="text-[11px] h-7 px-2"
                                  title="Liberar ID"
                                >
                                  <Trash2 className="w-3 h-3 mr-1" />
                                  <span>Liberar</span>
                                </Button>
                              </div>
                            </td>
                          </tr>
                        ))}
                        {bindings.length === 0 && !isLoadingBindings && (
                          <tr>
                            <td colSpan={5} className="p-6 text-center text-texter-text-dim font-sans">
                              No hay IDs vinculados para este cliente. Haz clic en "Vincular ID" para asociar visitantes web a teléfonos.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* PESTAÑA 5: WIDGET (WIDGET-3) */}
            {activeDetailTab === "widget" && (
              <div className="space-y-6">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 border-b border-texter-border pb-2.5">
                  <div>
                    <h4 className="text-sm font-bold text-white flex items-center gap-2">
                      <Bot className="w-4 h-4 text-blue-400" />
                      Widget de Chat Web Embebible
                    </h4>
                    <p className="text-xs text-texter-text-muted">
                      Incrusta un agente de atención inteligente en la web del cliente mediante un snippet HTML
                    </p>
                  </div>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => {
                      setIsCreateWidgetOpen(true);
                      setCreateWidgetError(null);
                    }}
                    className="flex items-center gap-1.5 text-xs"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Crear widget
                  </Button>
                </div>

                {widgetsError && (
                  <div className="p-3 rounded-xl bg-texter-rose/10 border border-texter-rose/30 text-xs text-rose-300 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-texter-rose shrink-0 mt-0.5" />
                    <span>{widgetsError}</span>
                  </div>
                )}

                <div className="space-y-4">
                  {widgets.map((w) => {
                    const snippet = `<script src="https://nextex-seven.vercel.app/widget/nextex-chat.js" data-key="${w.embed_key}"></script>`;

                    return (
                      <div
                        key={w.id}
                        className="p-4 rounded-xl bg-texter-surface-subtle border border-texter-border space-y-3.5"
                      >
                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 border-b border-texter-border/50 pb-2.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-white text-sm">{w.name}</span>
                            {w.is_active ? (
                              <Badge variant="success" size="sm" dot>Activo</Badge>
                            ) : (
                              <Badge variant="default" size="sm" dot>Inactivo</Badge>
                            )}
                            <div className="flex items-center gap-1.5 font-mono text-xs bg-texter-surface px-2 py-0.5 rounded border border-texter-border">
                              <span className="text-texter-text-dim text-[11px]">Key:</span>
                              <span className="text-texter-cyan">{w.embed_key}</span>
                              <button
                                type="button"
                                onClick={() => {
                                  navigator.clipboard.writeText(w.embed_key);
                                  setCopiedSnippetId("key_" + w.id);
                                  setTimeout(() => setCopiedSnippetId(null), 2500);
                                }}
                                className="text-texter-text-dim hover:text-white ml-1"
                                title="Copiar embed_key"
                              >
                                {copiedSnippetId === "key_" + w.id ? (
                                  <Check className="w-3 h-3 text-emerald-400" />
                                ) : (
                                  <Copy className="w-3 h-3" />
                                )}
                              </button>
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleOpenEditWidget(w)}
                              className="text-[11px] h-7 px-2"
                              title="Editar widget"
                            >
                              <Edit3 className="w-3 h-3 mr-1" />
                              <span>Editar</span>
                            </Button>
                            {w.is_active && (
                              <Button
                                variant="danger"
                                size="sm"
                                onClick={() => setDeletingWidget(w)}
                                className="text-[11px] h-7 px-2"
                                title="Desactivar widget"
                              >
                                <Trash2 className="w-3 h-3 mr-1" />
                                <span>Eliminar</span>
                              </Button>
                            )}
                          </div>
                        </div>

                        {/* Bloque: Instalar en tu web */}
                        <div className="p-3.5 rounded-xl bg-texter-surface border border-texter-border space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-white flex items-center gap-1.5">
                              <Code2 className="w-3.5 h-3.5 text-texter-cyan" />
                              Instalar en tu web
                            </span>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                navigator.clipboard.writeText(snippet);
                                setCopiedSnippetId(w.id);
                                setTimeout(() => setCopiedSnippetId(null), 2500);
                              }}
                              className="text-[11px] h-7 px-2.5 flex items-center gap-1.5"
                            >
                              {copiedSnippetId === w.id ? (
                                <>
                                  <Check className="w-3 h-3 text-emerald-400" />
                                  <span className="text-emerald-400 font-bold">¡Copiado!</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3 h-3 text-texter-cyan" />
                                  <span>Copiar Snippet</span>
                                </>
                              )}
                            </Button>
                          </div>
                          <p className="text-[11px] text-texter-text-muted">
                            Pega esta etiqueta antes del cierre de <code className="text-texter-cyan">&lt;/body&gt;</code> en el HTML del cliente:
                          </p>
                          <div className="p-2.5 rounded-lg bg-black/40 border border-texter-border/70 font-mono text-[11px] text-emerald-300 break-all select-all">
                            {snippet}
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  {widgets.length === 0 && !isLoadingWidgets && (
                    <div className="p-8 text-center text-texter-text-dim text-xs bg-texter-surface-subtle rounded-xl border border-texter-border">
                      No hay widgets de chat configurados para este cliente. Haz clic en "Crear widget" para generar el código de integración.
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* PESTAÑA 6: USUARIOS Y ROLES (ROLES-3) */}
            {activeDetailTab === "users" && (
              <div className="space-y-8">
                {/* 1. SECCIÓN: MIEMBROS ACTUALES */}
                <div className="space-y-3">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 border-b border-texter-border pb-2.5">
                    <div>
                      <h4 className="text-sm font-bold text-white flex items-center gap-2">
                        <Users className="w-4 h-4 text-amber-400" />
                        Miembros Actuales del Workspace
                      </h4>
                      <p className="text-xs text-texter-text-muted">
                        Usuarios con credenciales y acceso directo al espacio de trabajo del cliente
                      </p>
                    </div>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => {
                        setIsInviteOpen(true);
                        setCreatedInviteResult(null);
                        setInviteEmail("");
                        setInviteRole("member");
                        setInviteError(null);
                      }}
                      className="flex items-center gap-1.5 text-xs"
                    >
                      <UserPlus className="w-3.5 h-3.5" />
                      Invitar usuario
                    </Button>
                  </div>

                  {membersError && (
                    <div className="p-3 rounded-xl bg-texter-rose/10 border border-texter-rose/30 text-xs text-rose-300 flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-texter-rose shrink-0 mt-0.5" />
                      <span>{membersError}</span>
                    </div>
                  )}

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs font-mono">
                      <thead className="bg-texter-surface-subtle text-texter-text-muted border-b border-texter-border uppercase tracking-wider">
                        <tr>
                          <th className="p-2.5">Usuario (Email)</th>
                          <th className="p-2.5">Rol</th>
                          <th className="p-2.5">ID de Usuario</th>
                          <th className="p-2.5 text-right">Incorporación</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-texter-border/50">
                        {members.map((m) => (
                          <tr key={m.user_id} className="hover:bg-texter-surface-hover/50 transition-colors">
                            <td className="p-2.5 font-bold text-white font-sans flex items-center gap-2">
                              <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                              <span>{m.email}</span>
                            </td>
                            <td className="p-2.5">
                              <Badge
                                variant={
                                  m.role === "owner"
                                    ? "warning"
                                    : m.role === "admin"
                                    ? "cyan"
                                    : "default"
                                }
                                size="sm"
                                className="uppercase text-[10px]"
                              >
                                {m.role === "owner" ? "Dueño" : m.role === "admin" ? "Admin" : "Miembro"}
                              </Badge>
                            </td>
                            <td className="p-2.5 text-texter-text-dim text-[11px] font-mono">
                              {m.user_id}
                            </td>
                            <td className="p-2.5 text-right text-texter-text-dim text-[11px]">
                              {new Date(m.created_at).toLocaleDateString()}
                            </td>
                          </tr>
                        ))}
                        {members.length === 0 && !isLoadingMembers && (
                          <tr>
                            <td colSpan={4} className="p-6 text-center text-texter-text-dim font-sans">
                              No hay miembros registrados para este workspace.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* 2. SECCIÓN: INVITACIONES PENDIENTES */}
                <div className="space-y-3">
                  <div className="border-b border-texter-border pb-2.5">
                    <h4 className="text-sm font-bold text-white flex items-center gap-2">
                      <MailCheck className="w-4 h-4 text-texter-cyan" />
                      Invitaciones Pendientes
                    </h4>
                    <p className="text-xs text-texter-text-muted">
                      Enlaces de acceso generados para nuevos integrantes pendientes de activación
                    </p>
                  </div>

                  {invitesError && (
                    <div className="p-3 rounded-xl bg-texter-rose/10 border border-texter-rose/30 text-xs text-rose-300 flex items-start gap-2">
                      <AlertCircle className="w-4 h-4 text-texter-rose shrink-0 mt-0.5" />
                      <span>{invitesError}</span>
                    </div>
                  )}

                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs font-mono">
                      <thead className="bg-texter-surface-subtle text-texter-text-muted border-b border-texter-border uppercase tracking-wider">
                        <tr>
                          <th className="p-2.5">Email Invitado</th>
                          <th className="p-2.5">Rol Asignado</th>
                          <th className="p-2.5">Expira</th>
                          <th className="p-2.5 text-right">Enlace de Invitación</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-texter-border/50">
                        {invites.map((inv) => (
                          <tr key={inv.id} className="hover:bg-texter-surface-hover/50 transition-colors">
                            <td className="p-2.5 font-bold text-white font-sans">{inv.email}</td>
                            <td className="p-2.5">
                              <Badge
                                variant={
                                  inv.role === "owner"
                                    ? "warning"
                                    : inv.role === "admin"
                                    ? "cyan"
                                    : "default"
                                }
                                size="sm"
                                className="uppercase text-[10px]"
                              >
                                {inv.role === "owner" ? "Dueño" : inv.role === "admin" ? "Admin" : "Miembro"}
                              </Badge>
                            </td>
                            <td className="p-2.5 text-texter-text-dim text-[11px]">
                              {new Date(inv.expires_at).toLocaleDateString()}
                            </td>
                            <td className="p-2.5 text-right">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  navigator.clipboard.writeText(inv.invite_link);
                                  setCopiedInviteToken(inv.token);
                                  setTimeout(() => setCopiedInviteToken(null), 2500);
                                }}
                                className="text-[11px] h-7 px-2.5 flex items-center gap-1.5 ml-auto"
                              >
                                {copiedInviteToken === inv.token ? (
                                  <>
                                    <Check className="w-3 h-3 text-emerald-400" />
                                    <span className="text-emerald-400 font-bold">¡Copiado!</span>
                                  </>
                                ) : (
                                  <>
                                    <Copy className="w-3 h-3 text-texter-cyan" />
                                    <span>Copiar Link</span>
                                  </>
                                )}
                              </Button>
                            </td>
                          </tr>
                        ))}
                        {invites.length === 0 && !isLoadingInvites && (
                          <tr>
                            <td colSpan={4} className="p-6 text-center text-texter-text-dim font-sans">
                              No hay invitaciones pendientes. Haz clic en "Invitar usuario" para sumar nuevos colaboradores.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* PESTAÑA 7: PERMISOS Y ROLES GRANULARES (PERM-3) */}
            {activeDetailTab === "permissions" && (
              <div className="space-y-6">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-texter-border pb-3">
                  <div>
                    <h4 className="text-sm font-bold text-white flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 text-rose-400" />
                      Matriz de Permisos Granulares por Cliente
                    </h4>
                    <p className="text-xs text-texter-text-muted">
                      Configura el control de acceso a nivel de módulo y acción para cada rol de este workspace
                    </p>
                  </div>

                  {/* Acceso Rápido a Presets */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[11px] font-mono text-texter-text-dim mr-1">Presets:</span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setConfirmingPreset("dueno")}
                      className="text-[11px] h-7 px-2"
                      title="Asignar todos los permisos"
                    >
                      Dueño (Todo)
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setConfirmingPreset("empleado")}
                      className="text-[11px] h-7 px-2"
                      title="Solo ver y responder conversaciones"
                    >
                      Empleado (Conversaciones)
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setConfirmingPreset("lectura")}
                      className="text-[11px] h-7 px-2"
                      title="Solo ver en todos los módulos"
                    >
                      Solo Lectura
                    </Button>
                  </div>
                </div>

                {permissionsError && (
                  <div className="p-3 rounded-xl bg-texter-rose/10 border border-texter-rose/30 text-xs text-rose-300 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-texter-rose shrink-0 mt-0.5" />
                    <span>{permissionsError}</span>
                  </div>
                )}

                {/* 1. SELECTOR DE ROL */}
                <div className="flex items-center gap-2 p-1.5 bg-texter-surface-subtle border border-texter-border rounded-xl">
                  <button
                    type="button"
                    onClick={() => setSelectedPermRole("owner")}
                    className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-2 ${
                      selectedPermRole === "owner"
                        ? "bg-texter-indigo text-white shadow-sm font-bold"
                        : "text-texter-text-muted hover:text-white"
                    }`}
                  >
                    <span>Dueño (Owner)</span>
                    <Badge variant={selectedPermRole === "owner" ? "cyan" : "default"} size="sm" className="text-[10px] px-1 py-0 font-mono">
                      Total
                    </Badge>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSelectedPermRole("admin")}
                    className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-2 ${
                      selectedPermRole === "admin"
                        ? "bg-texter-indigo text-white shadow-sm font-bold"
                        : "text-texter-text-muted hover:text-white"
                    }`}
                  >
                    <span>Administrador (Admin)</span>
                    <Badge variant={selectedPermRole === "admin" ? "cyan" : "default"} size="sm" className="text-[10px] px-1 py-0 font-mono">
                      Gestión
                    </Badge>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSelectedPermRole("member")}
                    className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-2 ${
                      selectedPermRole === "member"
                        ? "bg-texter-indigo text-white shadow-sm font-bold"
                        : "text-texter-text-muted hover:text-white"
                    }`}
                  >
                    <span>Empleado (Member)</span>
                    <Badge variant={selectedPermRole === "member" ? "cyan" : "default"} size="sm" className="text-[10px] px-1 py-0 font-mono">
                      Operativo
                    </Badge>
                  </button>
                </div>

                {/* 2. TABLA MATRIZ DE PERMISOS */}
                <div className="overflow-x-auto rounded-xl border border-texter-border bg-texter-surface-subtle/30">
                  <table className="w-full text-left text-xs font-sans">
                    <thead className="bg-texter-surface-subtle text-texter-text-muted border-b border-texter-border uppercase tracking-wider font-mono text-[11px]">
                      <tr>
                        <th className="p-3.5">Módulo / Sección</th>
                        <th className="p-3.5 text-center">Ver</th>
                        <th className="p-3.5 text-center">Responder</th>
                        <th className="p-3.5 text-center">Pausar</th>
                        <th className="p-3.5 text-center">Editar</th>
                        <th className="p-3.5 text-center">Invitar</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-texter-border/50">
                      {[
                        { key: "conversaciones", label: "Conversaciones (Bandeja & Takeover)" },
                        { key: "automatizaciones", label: "Automatizaciones & Flujos" },
                        { key: "consumo", label: "Consumo & Facturación de Tokens" },
                        { key: "config_ia", label: "Configuración de IA & Modelos" },
                        { key: "usuarios", label: "Usuarios & Roles del Workspace" },
                      ].map((sectionItem) => {
                        const secKey = sectionItem.key as PermSection;
                        const roleObj = permissionsMatrix?.roles?.[selectedPermRole];
                        const secObj = roleObj?.[secKey];

                        return (
                          <tr key={secKey} className="hover:bg-texter-surface-hover/40 transition-colors">
                            <td className="p-3.5 font-semibold text-white">
                              {sectionItem.label}
                            </td>

                            {(["ver", "responder", "pausar", "editar", "invitar"] as PermAction[]).map((actionKey) => {
                              const isChecked = Boolean(secObj?.[actionKey]);

                              return (
                                <td key={actionKey} className="p-3.5 text-center">
                                  <label className="inline-flex items-center justify-center cursor-pointer p-1 rounded-md hover:bg-texter-surface transition-all">
                                    <input
                                      type="checkbox"
                                      checked={isChecked}
                                      onChange={() => handleTogglePermission(secKey, actionKey, isChecked)}
                                      disabled={isLoadingPermissions}
                                      className="w-4 h-4 rounded border-texter-border text-rose-500 focus:ring-rose-500/30 bg-texter-surface-subtle cursor-pointer transition-colors"
                                    />
                                  </label>
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <p className="text-[11px] text-texter-text-dim text-right font-mono">
                  * Los cambios de permisos se guardan y aplican de manera inmediata.
                </p>
              </div>
            )}

            {/* PESTAÑA 8: CONSUMO Y EFICIENCIA (EFIC-3) */}
            {activeDetailTab === "consumption" && (
              <div className="space-y-6">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 border-b border-texter-border pb-3">
                  <div>
                    <h4 className="text-sm font-bold text-white flex items-center gap-2">
                      <Zap className="w-4 h-4 text-texter-cyan" />
                      Métricas de Consumo y Eficiencia de Tokens
                    </h4>
                    <p className="text-xs text-texter-text-muted">
                      Monitoreo mensual de tokens, aciertos en response_cache y control de topes
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => selectedClient && loadConsumption(selectedClient.id)}
                    disabled={isLoadingConsumption}
                    className="text-xs text-texter-cyan hover:text-white flex items-center gap-1.5 h-7"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isLoadingConsumption ? "animate-spin" : ""}`} />
                    <span>Actualizar</span>
                  </Button>
                </div>

                {consumptionError && (
                  <div className="p-3 rounded-xl bg-texter-rose/10 border border-texter-rose/30 text-xs text-rose-300 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-texter-rose shrink-0 mt-0.5" />
                    <span>{consumptionError}</span>
                  </div>
                )}

                {/* 1. TARJETAS SUPERIORES */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {/* Total Tokens */}
                  <div className="p-4 rounded-xl bg-texter-surface-subtle border border-texter-border space-y-2">
                    <div className="flex items-center justify-between text-texter-text-muted text-xs font-mono">
                      <span>Total Mes ({consumptionData?.month || "Actual"})</span>
                      <Zap className="w-4 h-4 text-texter-cyan" />
                    </div>
                    <div className="text-2xl font-bold font-mono text-white">
                      {(consumptionData?.total_tokens ?? 0).toLocaleString()}
                    </div>
                    <p className="text-[11px] text-texter-text-dim font-mono">
                      tokens consumidos en inferencias
                    </p>
                  </div>

                  {/* Cache Hit Rate */}
                  <div className="p-4 rounded-xl bg-texter-surface-subtle border border-texter-border space-y-2">
                    <div className="flex items-center justify-between text-texter-text-muted text-xs font-mono">
                      <span>Ahorro en Caché</span>
                      <TrendingUp className="w-4 h-4 text-emerald-400" />
                    </div>
                    <div className="text-2xl font-bold font-mono text-emerald-400">
                      {(((consumptionData?.cache_hit_rate ?? 0) * 100)).toFixed(1)}%
                    </div>
                    <div className="w-full bg-texter-surface rounded-full h-1.5 overflow-hidden border border-texter-border">
                      <div
                        className="bg-emerald-400 h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${Math.min(100, ((consumptionData?.cache_hit_rate ?? 0) * 100))}%`,
                        }}
                      />
                    </div>
                    <p className="text-[11px] text-texter-text-dim font-mono">
                      {(consumptionData?.cache_hits ?? 0)} hits (0 tokens facturados)
                    </p>
                  </div>

                  {/* Presupuesto */}
                  <div
                    className={`p-4 rounded-xl bg-texter-surface-subtle border transition-all space-y-2 ${
                      consumptionData?.budget?.exceeded
                        ? "border-texter-rose/60 bg-texter-rose/10 shadow-sm shadow-rose-950/20"
                        : "border-texter-border"
                    }`}
                  >
                    <div className="flex items-center justify-between text-texter-text-muted text-xs font-mono">
                      <span>Presupuesto Mensual</span>
                      {consumptionData?.budget?.exceeded && (
                        <Badge variant="danger" size="sm" dot>Excedido</Badge>
                      )}
                    </div>
                    <div className="text-2xl font-bold font-mono text-white">
                      {consumptionData?.budget?.cap != null ? (
                        <span>
                          {(consumptionData.budget.used ?? 0).toLocaleString()} / {(consumptionData.budget.cap).toLocaleString()}
                        </span>
                      ) : (
                        <span className="text-texter-text-secondary text-lg">Sin límite</span>
                      )}
                    </div>
                    {consumptionData?.budget?.cap != null && (
                      <div className="w-full bg-texter-surface rounded-full h-1.5 overflow-hidden border border-texter-border">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${
                            consumptionData.budget.exceeded ? "bg-texter-rose" : "bg-texter-cyan"
                          }`}
                          style={{
                            width: `${Math.min(
                              100,
                              ((consumptionData.budget.used || 0) / consumptionData.budget.cap) * 100
                            )}%`,
                          }}
                        />
                      </div>
                    )}
                    <p className="text-[11px] text-texter-text-dim font-mono">
                      {consumptionData?.budget?.exceeded
                        ? "Tope mensual alcanzado o superado"
                        : consumptionData?.budget?.cap != null
                        ? "Tope configurado en IA"
                        : "Consumo ilimitado permitido"}
                    </p>
                  </div>
                </div>

                {/* 2. NOTA DE FACTURACIÓN */}
                <div
                  className={`p-3.5 rounded-xl border text-xs flex items-center justify-between gap-3 ${
                    aiConfig?.mode === "byok"
                      ? "bg-texter-indigo/10 border-indigo-500/30 text-indigo-300"
                      : "bg-texter-cyan/10 border-cyan-500/30 text-cyan-300"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Zap className="w-4 h-4 shrink-0" />
                    <span>
                      {aiConfig?.mode === "byok" ? (
                        <>
                          <strong>Modo BYOK (Claves Propias):</strong> El cliente aporta sus propias credenciales. El consumo de tokens es facturado directamente por los proveedores externos (OpenAI, Google, Anthropic).
                        </>
                      ) : (
                        <>
                          <strong>Modo Premium (Claves NEXTEХ):</strong> Este consumo se realiza a través de la infraestructura central de NEXTEХ y es facturable mensualmente.
                        </>
                      )}
                    </span>
                  </div>
                  <Badge variant={aiConfig?.mode === "byok" ? "indigo" : "cyan"} size="sm">
                    {aiConfig?.mode === "byok" ? "BYOK Activo" : "Facturable"}
                  </Badge>
                </div>

                {/* 3. GRÁFICO POR DÍA */}
                <div className="p-4 rounded-xl bg-texter-surface-subtle border border-texter-border space-y-3">
                  <div className="flex items-center justify-between border-b border-texter-border pb-2.5">
                    <h5 className="text-xs font-bold text-white uppercase tracking-wider font-mono flex items-center gap-2">
                      <BarChart3 className="w-4 h-4 text-texter-cyan" />
                      Consumo Diario de Tokens (Últimos Días)
                    </h5>
                    <span className="text-[11px] text-texter-text-dim font-mono">
                      {(consumptionData?.by_day?.length ?? 0)} días con actividad
                    </span>
                  </div>

                  {consumptionData?.by_day && consumptionData.by_day.length > 0 ? (
                    (() => {
                      const maxTokens = Math.max(...consumptionData.by_day.map((d) => d.tokens), 1);

                      return (
                        <div className="pt-4 pb-2">
                          <div className="flex items-end gap-2 h-36 w-full overflow-x-auto px-2">
                            {consumptionData.by_day.map((dayItem) => {
                              const heightPct = Math.max(8, Math.round((dayItem.tokens / maxTokens) * 100));
                              const dayLabel = dayItem.day.slice(8); // DD

                              return (
                                <div
                                  key={dayItem.day}
                                  className="flex-1 min-w-[28px] max-w-[48px] flex flex-col items-center gap-1 group relative h-full justify-end"
                                >
                                  {/* Tooltip */}
                                  <div className="absolute -top-8 hidden group-hover:flex flex-col items-center z-20 pointer-events-none">
                                    <div className="bg-texter-surface border border-texter-border px-2 py-1 rounded text-[10px] font-mono text-white whitespace-nowrap shadow-xl">
                                      {dayItem.day}: {dayItem.tokens.toLocaleString()} tokens
                                    </div>
                                  </div>

                                  <div
                                    className="w-full bg-texter-cyan/70 hover:bg-texter-cyan rounded-t transition-all duration-300"
                                    style={{ height: `${heightPct}%` }}
                                  />
                                  <span className="text-[10px] font-mono text-texter-text-dim mt-1">
                                    {dayLabel}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()
                  ) : (
                    <div className="p-8 text-center text-texter-text-dim text-xs font-mono">
                      No hay actividad registrada en este período (0 tokens consumidos).
                    </div>
                  )}
                </div>

                {/* 4. DESGLOSE POR MODELO */}
                <div className="space-y-3">
                  <div className="border-b border-texter-border pb-2.5">
                    <h5 className="text-xs font-bold text-white uppercase tracking-wider font-mono flex items-center gap-2">
                      <Cpu className="w-4 h-4 text-purple-400" />
                      Desglose de Consumo por Modelo de IA
                    </h5>
                  </div>

                  <div className="overflow-x-auto rounded-xl border border-texter-border bg-texter-surface-subtle/30">
                    <table className="w-full text-left text-xs font-mono">
                      <thead className="bg-texter-surface-subtle text-texter-text-muted border-b border-texter-border uppercase tracking-wider text-[11px]">
                        <tr>
                          <th className="p-3">Modelo</th>
                          <th className="p-3">Tokens Consumidos</th>
                          <th className="p-3 text-right">Porcentaje</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-texter-border/50">
                        {consumptionData?.by_model && consumptionData.by_model.length > 0 ? (
                          consumptionData.by_model.map((m) => {
                            const total = consumptionData.total_tokens || 1;
                            const pct = ((m.tokens / total) * 100).toFixed(1);

                            return (
                              <tr key={m.model} className="hover:bg-texter-surface-hover/40 transition-colors">
                                <td className="p-3 font-bold text-white flex items-center gap-2">
                                  <span className="w-2 h-2 rounded-full bg-texter-cyan" />
                                  <span>{m.model}</span>
                                </td>
                                <td className="p-3 text-texter-cyan font-bold">
                                  {m.tokens.toLocaleString()}
                                </td>
                                <td className="p-3 text-right text-texter-text-dim">
                                  {pct}%
                                </td>
                              </tr>
                            );
                          })
                        ) : (
                          <tr>
                            <td colSpan={3} className="p-6 text-center text-texter-text-dim font-sans">
                              No hay consumo por modelo registrado en este mes (0 tokens).
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* PESTAÑA 9: FACTURACIÓN Y LIQUIDACIONES (BILL-3) */}
            {activeDetailTab === "billing" && (
              <div className="space-y-6">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 border-b border-texter-border pb-3">
                  <div>
                    <h4 className="text-sm font-bold text-white flex items-center gap-2">
                      <Receipt className="w-4 h-4 text-emerald-400" />
                      Facturación y Liquidación de Consumo
                    </h4>
                    <p className="text-xs text-texter-text-muted">
                      Estimación de cobros en base a tarifas activas de modelos y emisión de facturas mensuales
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      if (selectedClient) {
                        loadBillingEstimate(selectedClient.id);
                        loadInvoices(selectedClient.id);
                      }
                    }}
                    disabled={isLoadingBilling || isLoadingInvoices}
                    className="text-xs text-texter-cyan hover:text-white flex items-center gap-1.5 h-7"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isLoadingBilling ? "animate-spin" : ""}`} />
                    <span>Actualizar</span>
                  </Button>
                </div>

                {billingError && (
                  <div className="p-3 rounded-xl bg-texter-rose/10 border border-texter-rose/30 text-xs text-rose-300 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-texter-rose shrink-0 mt-0.5" />
                    <span>{billingError}</span>
                  </div>
                )}

                {/* 1. TARJETAS DE ESTIMADO DEL MES */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {/* Total Tokens Mes */}
                  <div className="p-4 rounded-xl bg-texter-surface-subtle border border-texter-border space-y-2">
                    <div className="flex items-center justify-between text-texter-text-muted text-xs font-mono">
                      <span>Tokens del Período ({billingEstimate?.period || "Mes actual"})</span>
                      <Zap className="w-4 h-4 text-texter-cyan" />
                    </div>
                    <div className="text-2xl font-bold font-mono text-white">
                      {(billingEstimate?.tokens_total ?? 0).toLocaleString()}
                    </div>
                    <p className="text-[11px] text-texter-text-dim font-mono">
                      tokens computados
                    </p>
                  </div>

                  {/* Monto Estimado USD */}
                  <div className="p-4 rounded-xl bg-texter-surface-subtle border border-texter-border space-y-2">
                    <div className="flex items-center justify-between text-texter-text-muted text-xs font-mono">
                      <span>Monto Estimado</span>
                      <DollarSign className="w-4 h-4 text-emerald-400" />
                    </div>
                    <div className="text-2xl font-bold font-mono text-emerald-400">
                      ${((billingEstimate?.amount_estimate ?? 0)).toFixed(2)} <span className="text-xs text-texter-text-muted">USD</span>
                    </div>
                    <p className="text-[11px] text-texter-text-dim font-mono">
                      {billingEstimate?.billable ? "según tarifas de modelos activas" : "0.00 USD (No facturable)"}
                    </p>
                  </div>

                  {/* Modo de Facturación */}
                  <div className="p-4 rounded-xl bg-texter-surface-subtle border border-texter-border space-y-2">
                    <div className="flex items-center justify-between text-texter-text-muted text-xs font-mono">
                      <span>Modo de Cuenta</span>
                      <Receipt className="w-4 h-4 text-texter-cyan" />
                    </div>
                    <div className="pt-0.5">
                      {billingEstimate?.billable ? (
                        <Badge variant="cyan" size="sm" dot>Facturable</Badge>
                      ) : (
                        <Badge variant="indigo" size="sm" dot>BYOK — no facturable</Badge>
                      )}
                    </div>
                    <p className="text-[11px] text-texter-text-dim leading-relaxed">
                      {billingEstimate?.billable
                        ? "Usa infraestructura central NEXTEХ."
                        : "El cliente usa sus propias claves de IA."}
                    </p>
                  </div>
                </div>

                {/* 2. TABLA POR MODELO */}
                <div className="space-y-3">
                  <div className="border-b border-texter-border pb-2.5">
                    <h5 className="text-xs font-bold text-white uppercase tracking-wider font-mono flex items-center gap-2">
                      <Cpu className="w-4 h-4 text-purple-400" />
                      Estimado de Costo por Modelo
                    </h5>
                  </div>

                  <div className="overflow-x-auto rounded-xl border border-texter-border bg-texter-surface-subtle/30">
                    <table className="w-full text-left text-xs font-mono">
                      <thead className="bg-texter-surface-subtle text-texter-text-muted border-b border-texter-border uppercase tracking-wider text-[11px]">
                        <tr>
                          <th className="p-3">Modelo</th>
                          <th className="p-3">Tokens Entrada (In)</th>
                          <th className="p-3">Tokens Salida (Out)</th>
                          <th className="p-3">Total Tokens</th>
                          <th className="p-3 text-right">Costo Estimado</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-texter-border/50">
                        {billingEstimate?.by_model && billingEstimate.by_model.length > 0 ? (
                          billingEstimate.by_model.map((m) => (
                            <tr key={m.model} className="hover:bg-texter-surface-hover/40 transition-colors">
                              <td className="p-3 font-bold text-white flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-texter-cyan" />
                                <span>{m.model}</span>
                              </td>
                              <td className="p-3 text-texter-text-secondary">
                                {m.input_tokens.toLocaleString()}
                              </td>
                              <td className="p-3 text-texter-text-secondary">
                                {m.output_tokens.toLocaleString()}
                              </td>
                              <td className="p-3 text-texter-cyan font-bold">
                                {(m.input_tokens + m.output_tokens).toLocaleString()}
                              </td>
                              <td className="p-3 text-right text-emerald-400 font-bold">
                                ${m.cost.toFixed(4)} USD
                              </td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={5} className="p-6 text-center text-texter-text-dim font-sans">
                              Sin consumo registrado en el período actual ($0.00 USD).
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* 3. LISTADO DE FACTURAS */}
                <div className="space-y-3 pt-2">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 border-b border-texter-border pb-2.5">
                    <div>
                      <h5 className="text-xs font-bold text-white uppercase tracking-wider font-mono flex items-center gap-2">
                        <Receipt className="w-4 h-4 text-emerald-400" />
                        Facturas Emitidas
                      </h5>
                      <p className="text-xs text-texter-text-muted">
                        Historial de facturas mensuales y control de cobranza
                      </p>
                    </div>

                    {/* Botón: Generar factura del mes */}
                    {(() => {
                      const currentPeriod = billingEstimate?.period;
                      const hasCurrentInvoice = currentPeriod
                        ? invoices.some((inv) => inv.period === currentPeriod)
                        : false;

                      return (
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={handleGenerateInvoice}
                          disabled={isGeneratingInvoice || hasCurrentInvoice}
                          isLoading={isGeneratingInvoice}
                          className="text-xs flex items-center gap-1.5"
                          title={hasCurrentInvoice ? "La factura de este período ya fue emitida" : "Emitir factura del período"}
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>{hasCurrentInvoice ? "Factura del mes emitida" : "Generar factura del mes"}</span>
                        </Button>
                      );
                    })()}
                  </div>

                  <div className="overflow-x-auto rounded-xl border border-texter-border bg-texter-surface-subtle/30">
                    <table className="w-full text-left text-xs font-mono">
                      <thead className="bg-texter-surface-subtle text-texter-text-muted border-b border-texter-border uppercase tracking-wider text-[11px]">
                        <tr>
                          <th className="p-3">Período</th>
                          <th className="p-3">Tokens Totales</th>
                          <th className="p-3">Monto</th>
                          <th className="p-3">Estado</th>
                          <th className="p-3">Fecha Emisión</th>
                          <th className="p-3 text-right">Acciones</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-texter-border/50">
                        {invoices.map((inv) => (
                          <tr key={inv.id} className="hover:bg-texter-surface-hover/40 transition-colors">
                            <td className="p-3 font-bold text-white">
                              {inv.period}
                            </td>
                            <td className="p-3 text-texter-cyan">
                              {inv.tokens_total.toLocaleString()}
                            </td>
                            <td className="p-3 text-emerald-400 font-bold">
                              ${Number(inv.amount).toFixed(2)} {inv.currency || "USD"}
                            </td>
                            <td className="p-3">
                              {inv.status === "paid" && (
                                <Badge variant="success" size="sm" dot>Pagada</Badge>
                              )}
                              {inv.status === "pending" && (
                                <Badge variant="warning" size="sm" dot>Pendiente</Badge>
                              )}
                              {inv.status === "cancelled" && (
                                <Badge variant="default" size="sm" dot>Cancelada</Badge>
                              )}
                            </td>
                            <td className="p-3 text-texter-text-dim text-[11px]">
                              {new Date(inv.created_at).toLocaleDateString()}
                            </td>
                            <td className="p-3 text-right">
                              {inv.status === "pending" && (
                                <div className="flex items-center justify-end gap-1.5">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setConfirmInvoiceAction({ invoice: inv, nextStatus: "paid" })}
                                    className="text-[11px] h-7 px-2 text-emerald-400 border-emerald-500/40 hover:bg-emerald-500/10"
                                    title="Marcar como pagada"
                                  >
                                    <Check className="w-3 h-3 mr-1" />
                                    <span>Marcar pagada</span>
                                  </Button>

                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setConfirmInvoiceAction({ invoice: inv, nextStatus: "cancelled" })}
                                    className="text-[11px] h-7 px-2 text-texter-text-dim hover:text-rose-400"
                                    title="Cancelar factura"
                                  >
                                    <X className="w-3 h-3 mr-1" />
                                    <span>Cancelar</span>
                                  </Button>
                                </div>
                              )}
                            </td>
                          </tr>
                        ))}
                        {invoices.length === 0 && !isLoadingInvoices && (
                          <tr>
                            <td colSpan={6} className="p-6 text-center text-texter-text-dim font-sans">
                              No hay facturas emitidas para este cliente todavía.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </Card>
        )}
      </div>

      {/* MODAL: NUEVO CLIENTE */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in">
          <Card variant="elevated" className="max-w-lg w-full space-y-4 bg-texter-surface border-texter-border">
            <div className="flex items-center justify-between border-b border-texter-border pb-3">
              <div className="flex items-center gap-2">
                <Building2 className="w-5 h-5 text-texter-cyan" />
                <h3 className="text-base font-bold text-white">Registrar Nuevo Cliente</h3>
              </div>
              <button
                onClick={() => setIsCreateOpen(false)}
                className="text-texter-text-muted hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {createError && (
              <div className="p-3 rounded-xl bg-texter-rose/10 border border-texter-rose/30 text-xs text-rose-300 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-texter-rose shrink-0 mt-0.5" />
                <span>{createError}</span>
              </div>
            )}

            <form onSubmit={handleCreateClient} className="space-y-3.5">
              <Input
                label="Nombre del Negocio *"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="ej: Farmacia San Rafael o Distribuidora Quisqueya"
                required
              />

              <Input
                label="URL de su Web"
                value={websiteUrl}
                onChange={(e) => setWebsiteUrl(e.target.value)}
                placeholder="https://..."
              />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input
                  label="Nombre de Contacto"
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  placeholder="ej: Lic. Carlos Gómez"
                />

                <Input
                  label="Email de Contacto"
                  type="email"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  placeholder="contacto@empresa.com"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input
                  label="Teléfono"
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                  placeholder="+18095550199"
                />

                <Input
                  label="Límite Mensual de Créditos"
                  type="number"
                  min={0}
                  value={creditLimitMonthly}
                  onChange={(e) => setCreditLimitMonthly(e.target.value)}
                  placeholder="Opcional (ej: 50000)"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-texter-text-secondary">Notas Adicionales</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  placeholder="Observaciones de facturación o acuerdos comerciales..."
                  className="w-full p-2.5 rounded-xl bg-texter-surface-subtle border border-texter-border text-xs text-white placeholder:text-texter-text-dim outline-none resize-none font-mono"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2 border-t border-texter-border">
                <Button variant="ghost" size="sm" type="button" onClick={() => setIsCreateOpen(false)}>
                  Cancelar
                </Button>
                <Button variant="primary" size="sm" type="submit" isLoading={isCreating}>
                  Crear Cliente
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {/* MODAL: EDITAR CLIENTE */}
      {editingClient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in">
          <Card variant="elevated" className="max-w-lg w-full space-y-4 bg-texter-surface border-texter-border">
            <div className="flex items-center justify-between border-b border-texter-border pb-3">
              <div className="flex items-center gap-2">
                <Edit3 className="w-5 h-5 text-texter-cyan" />
                <h3 className="text-base font-bold text-white">Editar Datos del Cliente</h3>
              </div>
              <button
                onClick={() => setEditingClient(null)}
                className="text-texter-text-muted hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {updateError && (
              <div className="p-3 rounded-xl bg-texter-rose/10 border border-texter-rose/30 text-xs text-rose-300 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-texter-rose shrink-0 mt-0.5" />
                <span>{updateError}</span>
              </div>
            )}

            <form onSubmit={handleUpdateClient} className="space-y-3.5">
              <Input
                label="Nombre del Negocio *"
                value={editDisplayName}
                onChange={(e) => setEditDisplayName(e.target.value)}
                required
              />

              <Input
                label="URL de su Web"
                value={editWebsiteUrl}
                onChange={(e) => setEditWebsiteUrl(e.target.value)}
                placeholder="https://..."
              />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input
                  label="Nombre de Contacto"
                  value={editContactName}
                  onChange={(e) => setEditContactName(e.target.value)}
                />

                <Input
                  label="Email de Contacto"
                  type="email"
                  value={editContactEmail}
                  onChange={(e) => setEditContactEmail(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input
                  label="Teléfono"
                  value={editContactPhone}
                  onChange={(e) => setEditContactPhone(e.target.value)}
                />

                <Input
                  label="Límite Mensual de Créditos"
                  type="number"
                  min={0}
                  value={editCreditLimitMonthly}
                  onChange={(e) => setEditCreditLimitMonthly(e.target.value)}
                  placeholder="Dejar vacío para ilimitado"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-texter-text-secondary">Notas Adicionales</label>
                <textarea
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  rows={2}
                  className="w-full p-2.5 rounded-xl bg-texter-surface-subtle border border-texter-border text-xs text-white placeholder:text-texter-text-dim outline-none resize-none font-mono"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2 border-t border-texter-border">
                <Button variant="ghost" size="sm" type="button" onClick={() => setEditingClient(null)}>
                  Cancelar
                </Button>
                <Button variant="primary" size="sm" type="submit" isLoading={isUpdating}>
                  Guardar Cambios
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {/* MODAL: CONFIRMAR PAUSAR / REANUDAR */}
      {statusToggleClient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in">
          <Card variant="elevated" className="max-w-md w-full space-y-4 bg-texter-surface border-texter-border">
            <div className="flex items-center gap-2.5 text-white font-bold text-base">
              {statusToggleClient.status === "active" ? (
                <>
                  <Pause className="w-5 h-5 text-amber-400" />
                  <span>Pausar Cliente</span>
                </>
              ) : (
                <>
                  <Play className="w-5 h-5 text-emerald-400" />
                  <span>Reanudar Cliente</span>
                </>
              )}
            </div>

            <p className="text-xs text-texter-text-muted leading-relaxed">
              ¿Estás seguro de que deseas marcar como{" "}
              <strong className="text-white">
                {statusToggleClient.status === "active" ? "Inactivo" : "Activo"}
              </strong>{" "}
              al cliente <strong className="text-white">"{statusToggleClient.display_name}"</strong>?
            </p>

            <div className="flex justify-end gap-2 pt-2 border-t border-texter-border">
              <Button variant="ghost" size="sm" onClick={() => setStatusToggleClient(null)}>
                Volver
              </Button>
              <Button
                variant={statusToggleClient.status === "active" ? "outline" : "primary"}
                size="sm"
                onClick={handleToggleStatus}
                isLoading={isTogglingStatus}
              >
                {statusToggleClient.status === "active" ? "Confirmar Pausa" : "Confirmar Activación"}
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* MODAL: CONFIRMAR ELIMINAR CLIENTE */}
      {deletingClient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in">
          <Card variant="elevated" className="max-w-md w-full space-y-4 bg-texter-surface border-texter-rose/40">
            <div className="flex items-center gap-2.5 text-texter-rose font-bold text-base">
              <Trash2 className="w-5 h-5" />
              <span>Eliminar Cliente</span>
            </div>

            {deleteError && (
              <div className="p-3 rounded-xl bg-texter-rose/10 border border-texter-rose/30 text-xs text-rose-300 flex items-start gap-2 font-mono">
                <AlertCircle className="w-4 h-4 text-texter-rose shrink-0 mt-0.5" />
                <span>{deleteError}</span>
              </div>
            )}

            <p className="text-xs text-texter-text-muted leading-relaxed">
              ¿Estás seguro de que deseas eliminar permanentemente al cliente{" "}
              <strong className="text-white">"{deletingClient.display_name}"</strong> y su espacio de trabajo? Esta acción no se puede deshacer.
            </p>

            <div className="flex justify-end gap-2 pt-2 border-t border-texter-border">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setDeletingClient(null);
                  setDeleteError(null);
                }}
              >
                Cancelar
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={handleConfirmDelete}
                isLoading={isDeleting}
              >
                Confirmar Eliminación
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* MODAL: CONFIRMAR CAMBIO DE MODO IA */}
      {pendingModeChange && selectedClient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in">
          <Card variant="elevated" className="max-w-md w-full space-y-4 bg-texter-surface border-texter-border">
            <div className="flex items-center gap-2.5 text-texter-warning font-bold text-base">
              <AlertTriangle className="w-5 h-5" />
              Cambiar Modo de Proveedor IA
            </div>
            <p className="text-xs text-texter-text-muted leading-relaxed">
              ¿Deseas cambiar el modo a <strong className="text-white">{pendingModeChange === "byok" ? "\"Claves propias (BYOK)\"" : "\"Claves NEXTEX (premium)\""}</strong>?
              {pendingModeChange === "byok" && " Las peticiones se facturarán directamente a las claves del cliente en la bóveda."}
              {pendingModeChange === "nextex_keys" && " Las peticiones usarán la cuenta central de NEXTEX sujeta al plan del cliente."}
            </p>
            <div className="pt-2 flex justify-end gap-2 border-t border-texter-border">
              <Button variant="ghost" size="sm" onClick={() => setPendingModeChange(null)}>
                Cancelar
              </Button>
              <Button variant="primary" size="sm" onClick={handleConfirmModeChange} isLoading={isChangingMode}>
                Confirmar Cambio
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* MODAL: AGREGAR CLAVE BYOK */}
      {isAddKeyOpen && selectedClient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in">
          <Card variant="elevated" className="max-w-md w-full space-y-4 bg-texter-surface border-texter-border">
            <div className="flex items-center justify-between border-b border-texter-border pb-3">
              <div className="flex items-center gap-2">
                <Key className="w-5 h-5 text-texter-cyan" />
                <h3 className="text-base font-bold text-white">Agregar Clave de Proveedor (BYOK)</h3>
              </div>
              <button onClick={() => setIsAddKeyOpen(false)} className="text-texter-text-muted hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            {createKeyError && (
              <div className="p-3 rounded-xl bg-texter-rose/10 border border-texter-rose/30 text-xs text-rose-300 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-texter-rose shrink-0 mt-0.5" />
                <span>{createKeyError}</span>
              </div>
            )}

            <form onSubmit={handleAddApiKey} className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-texter-text-secondary">Proveedor</label>
                <select
                  value={newKeyProvider}
                  onChange={(e) => setNewKeyProvider(e.target.value as any)}
                  className="w-full p-2.5 rounded-xl bg-texter-surface-subtle border border-texter-border text-xs text-white outline-none font-mono"
                >
                  <option value="openai">OpenAI</option>
                  <option value="google">Google Gemini</option>
                  <option value="anthropic">Anthropic Claude</option>
                </select>
              </div>

              <Input
                label="Etiqueta / Nombre (opcional)"
                value={newKeyLabel}
                onChange={(e) => setNewKeyLabel(e.target.value)}
                placeholder="ej: Producción OpenAI GPT-4"
              />

              <Input
                label="Clave Secreta de API (API Key)"
                type="password"
                value={newKeySecret}
                onChange={(e) => setNewKeySecret(e.target.value)}
                placeholder="sk-..."
                required
              />

              <p className="text-[11px] text-texter-text-dim">
                La clave se valida contra el proveedor externo antes de ser cifrada en la bóveda AES-GCM.
              </p>

              <div className="pt-2 flex justify-end gap-2 border-t border-texter-border">
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  onClick={() => {
                    setIsAddKeyOpen(false);
                    setCreateKeyError(null);
                  }}
                >
                  Cancelar
                </Button>
                <Button variant="primary" size="sm" type="submit" isLoading={isSubmittingKey}>
                  Validar y Guardar Clave
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {/* MODAL: CONFIRMAR ELIMINAR CLAVE */}
      {deletingKey && selectedClient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in">
          <Card variant="elevated" className="max-w-md w-full space-y-4 bg-texter-surface border-texter-rose/40">
            <div className="flex items-center gap-2.5 text-texter-rose font-bold text-base">
              <Trash2 className="w-5 h-5" />
              Eliminar Clave de IA
            </div>
            <p className="text-xs text-texter-text-muted leading-relaxed">
              ¿Estás seguro de que deseas eliminar la clave <strong className="text-white">"{deletingKey.label}"</strong> ({deletingKey.provider.toUpperCase()} ••••{deletingKey.key_hint})? El cliente dejará de poder usar este proveedor en modo BYOK.
            </p>
            <div className="pt-2 flex justify-end gap-2 border-t border-texter-border">
              <Button variant="ghost" size="sm" onClick={() => setDeletingKey(null)}>
                Volver
              </Button>
              <Button variant="danger" size="sm" onClick={handleConfirmDeleteKey} isLoading={isDeletingKey}>
                Confirmar Eliminación
              </Button>
            </div>
          </Card>
        </div>
      )}


      {/* MODAL: INSTALAR BLUEPRINT (DINÁMICO) */}
      {installingBlueprint && selectedClient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in">
          <Card variant="elevated" className="max-w-md w-full space-y-4 bg-texter-surface border-texter-border">
            <div className="flex items-center justify-between border-b border-texter-border pb-3">
              <div className="flex items-center gap-2">
                <Workflow className="w-5 h-5 text-purple-400" />
                <div>
                  <h3 className="text-base font-bold text-white">Instalar {installingBlueprint.name}</h3>
                  <p className="text-xs text-texter-text-muted">Cliente: {selectedClient.display_name}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setInstallingBlueprint(null);
                  setInstallError(null);
                }}
                className="text-texter-text-muted hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {installError && (
              <div className="p-3 rounded-xl bg-texter-rose/10 border border-texter-rose/30 text-xs text-rose-300 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-texter-rose shrink-0 mt-0.5" />
                <span>{installError}</span>
              </div>
            )}

            <form onSubmit={handleInstallIntegration} className="space-y-3.5">
              <Input
                label="Etiqueta / Nombre de la Instalación"
                value={installLabel}
                onChange={(e) => setInstallLabel(e.target.value)}
                placeholder={installingBlueprint.name}
              />

              {Array.isArray(installingBlueprint.required_credentials) &&
                installingBlueprint.required_credentials.map((spec) => {
                  if (spec.type === "oauth") {
                    return (
                      <div key={spec.key} className="p-3 rounded-xl bg-texter-surface-subtle border border-texter-border space-y-2">
                        <label className="text-xs font-medium text-texter-text-secondary">{spec.label || spec.key}</label>
                        <p className="text-[11px] text-texter-text-muted">
                          {spec.help || "Conexión OAuth con proveedor externo."}
                        </p>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setOauthPending(true)}
                          className="w-full flex items-center justify-center gap-2 text-xs"
                        >
                          <Globe className="w-3.5 h-3.5 text-texter-cyan" />
                          <span>Conectar con Google (OAuth)</span>
                        </Button>
                        <p className="text-[10px] text-amber-400/90 font-mono">
                          * OAuth pendiente de configuración en esta fase. Se registrará como pendiente.
                        </p>
                      </div>
                    );
                  }

                  return (
                    <Input
                      key={spec.key}
                      label={spec.label || spec.key}
                      type={spec.type === "password" ? "password" : "text"}
                      value={installCredentials[spec.key] || ""}
                      onChange={(e) =>
                        setInstallCredentials((prev) => ({
                          ...prev,
                          [spec.key]: e.target.value,
                        }))
                      }
                      placeholder={spec.type === "password" ? "••••••••••••" : spec.key}
                      hint={spec.help}
                      required={spec.required !== false}
                    />
                  );
                })}

              <div className="pt-2 flex justify-end gap-2 border-t border-texter-border">
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  onClick={() => {
                    setInstallingBlueprint(null);
                    setInstallError(null);
                  }}
                >
                  Cancelar
                </Button>
                <Button variant="primary" size="sm" type="submit" isLoading={isInstalling}>
                  Validar e Instalar
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {/* MODAL: CONFIRMAR DESINSTALAR INTEGRACIÓN */}
      {uninstallingIntegration && selectedClient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in">
          <Card variant="elevated" className="max-w-md w-full space-y-4 bg-texter-surface border-texter-rose/40">
            <div className="flex items-center gap-2.5 text-texter-rose font-bold text-base">
              <Trash2 className="w-5 h-5" />
              Desinstalar Integración
            </div>
            <p className="text-xs text-texter-text-muted leading-relaxed">
              ¿Estás seguro de que deseas desinstalar la integración <strong className="text-white">&quot;{uninstallingIntegration.label}&quot;</strong> ({uninstallingIntegration.blueprint_name})? El agente dejará de atender eventos provenientes de este canal para <strong className="text-white">{selectedClient.display_name}</strong>.
            </p>
            <div className="pt-2 flex justify-end gap-2 border-t border-texter-border">
              <Button variant="ghost" size="sm" onClick={() => setUninstallingIntegration(null)}>
                Volver
              </Button>
              <Button variant="danger" size="sm" onClick={handleConfirmUninstall} isLoading={isUninstalling}>
                Confirmar Desinstalación
              </Button>
            </div>
          </Card>
        </div>
      )}


      {/* MODAL: GENERAR / MOSTRAR SITE KEY */}
      {isGenerateKeyOpen && selectedClient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in">
          <Card variant="elevated" className="max-w-md w-full space-y-4 bg-texter-surface border-texter-border">
            <div className="flex items-center justify-between border-b border-texter-border pb-3">
              <div className="flex items-center gap-2">
                <Key className="w-5 h-5 text-texter-cyan" />
                <h3 className="text-base font-bold text-white">
                  {generatedKeyResult ? "Site Key Generada" : "Generar Nueva Site Key"}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsGenerateKeyOpen(false);
                  if (generatedKeyResult) {
                    setGeneratedKeyResult(null);
                    loadSiteKeys(selectedClient.id);
                  }
                }}
                className="text-texter-text-muted hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {generatedKeyResult ? (
              <div className="space-y-4">
                <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-300 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <strong className="block font-bold">Guárdala ahora</strong>
                    <span>{generatedKeyResult.warning || "Por razones de seguridad, no se mostrará de nuevo."}</span>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-mono text-texter-text-muted uppercase">Clave Secreta Completa:</label>
                  <div className="p-3 rounded-xl bg-texter-surface-subtle border border-texter-border font-mono text-xs text-white break-all select-all flex items-center justify-between gap-2">
                    <span>{generatedKeyResult.key}</span>
                  </div>
                </div>

                <div className="pt-2 flex justify-between items-center border-t border-texter-border">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      navigator.clipboard.writeText(generatedKeyResult.key);
                      setHasCopiedKey(true);
                      setTimeout(() => setHasCopiedKey(false), 3000);
                    }}
                    className="flex items-center gap-1.5 text-xs"
                  >
                    {hasCopiedKey ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="text-emerald-400 font-bold">¡Copiada!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5 text-texter-cyan" />
                        <span>Copiar Clave</span>
                      </>
                    )}
                  </Button>

                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => {
                      setIsGenerateKeyOpen(false);
                      setGeneratedKeyResult(null);
                      loadSiteKeys(selectedClient.id);
                    }}
                  >
                    Entendido, cerrar
                  </Button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleGenerateSiteKey} className="space-y-3.5">
                <Input
                  label="Nombre / Identificador de la Key (opcional)"
                  value={newSiteKeyName}
                  onChange={(e) => setNewSiteKeyName(e.target.value)}
                  placeholder="ej: Web Producción Principal"
                />

                <p className="text-[11px] text-texter-text-muted leading-relaxed">
                  Se generará una clave aleatoria segura de 48 caracteres hexadecimales con prefijo <code className="text-texter-cyan">ntx_</code>.
                </p>

                <div className="pt-2 flex justify-end gap-2 border-t border-texter-border">
                  <Button variant="ghost" size="sm" type="button" onClick={() => setIsGenerateKeyOpen(false)}>
                    Cancelar
                  </Button>
                  <Button variant="primary" size="sm" type="submit" isLoading={isGeneratingKey}>
                    Generar Clave
                  </Button>
                </div>
              </form>
            )}
          </Card>
        </div>
      )}

      {/* MODAL: CONFIRMAR REGENERAR SITE KEY */}
      {regeneratingKey && selectedClient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in">
          <Card variant="elevated" className="max-w-md w-full space-y-4 bg-texter-surface border-amber-500/40">
            <div className="flex items-center gap-2.5 text-amber-400 font-bold text-base">
              <RotateCcw className="w-5 h-5" />
              Regenerar Site Key
            </div>
            <p className="text-xs text-texter-text-muted leading-relaxed">
              ¿Deseas regenerar la clave <strong className="text-white">&quot;{regeneratingKey.name}&quot;</strong>? La clave actual dejará de funcionar inmediatamente y cualquier integración web que la use deberá actualizarse.
            </p>
            <div className="pt-2 flex justify-end gap-2 border-t border-texter-border">
              <Button variant="ghost" size="sm" onClick={() => setRegeneratingKey(null)}>
                Cancelar
              </Button>
              <Button variant="primary" size="sm" onClick={handleConfirmRegenerateKey} isLoading={isRegeneratingKey}>
                Confirmar y Regenerar
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* MODAL: CONFIRMAR REVOCAR SITE KEY */}
      {revokingKey && selectedClient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in">
          <Card variant="elevated" className="max-w-md w-full space-y-4 bg-texter-surface border-texter-rose/40">
            <div className="flex items-center gap-2.5 text-texter-rose font-bold text-base">
              <Trash2 className="w-5 h-5" />
              Revocar Site Key
            </div>
            <p className="text-xs text-texter-text-muted leading-relaxed">
              ¿Estás seguro de que deseas revocar la clave <strong className="text-white">&quot;{revokingKey.name}&quot;</strong> ({revokingKey.key_prefix}...)? Dejará de tener acceso a las APIs inmediatamente.
            </p>
            <div className="pt-2 flex justify-end gap-2 border-t border-texter-border">
              <Button variant="ghost" size="sm" onClick={() => setRevokingKey(null)}>
                Volver
              </Button>
              <Button variant="danger" size="sm" onClick={handleConfirmRevokeKey} isLoading={isRevokingKey}>
                Confirmar Revocación
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* MODAL: VINCULAR ID (BINDING) */}
      {isCreateBindingOpen && selectedClient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in">
          <Card variant="elevated" className="max-w-md w-full space-y-4 bg-texter-surface border-texter-border">
            <div className="flex items-center justify-between border-b border-texter-border pb-3">
              <div className="flex items-center gap-2">
                <Hash className="w-5 h-5 text-purple-400" />
                <h3 className="text-base font-bold text-white">Vincular ID Externo</h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsCreateBindingOpen(false);
                  setCreateBindingError(null);
                }}
                className="text-texter-text-muted hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {createBindingError && (
              <div className="p-3 rounded-xl bg-texter-rose/10 border border-texter-rose/30 text-xs text-rose-300 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-texter-rose shrink-0 mt-0.5" />
                <span>{createBindingError}</span>
              </div>
            )}

            <form onSubmit={handleCreateBinding} className="space-y-3.5">
              <Input
                label="External ID (Identificador Web) *"
                value={bindingExternalId}
                onChange={(e) => setBindingExternalId(e.target.value)}
                placeholder="ej: cr1264 o anon_9f81a"
                required
              />

              <Input
                label="Teléfono Asociado (opcional)"
                value={bindingPhone}
                onChange={(e) => setBindingPhone(e.target.value)}
                placeholder="+18095551234"
              />

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-texter-text-secondary">Canal</label>
                <select
                  value={bindingChannel}
                  onChange={(e) => setBindingChannel(e.target.value as any)}
                  className="w-full p-2.5 rounded-xl bg-texter-surface-subtle border border-texter-border text-xs text-white outline-none font-mono"
                >
                  <option value="web">Web (Widget / Chat)</option>
                  <option value="whatsapp">WhatsApp</option>
                  <option value="instagram">Instagram</option>
                  <option value="other">Otro</option>
                </select>
              </div>

              <div className="pt-2 flex justify-end gap-2 border-t border-texter-border">
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  onClick={() => {
                    setIsCreateBindingOpen(false);
                    setCreateBindingError(null);
                  }}
                >
                  Cancelar
                </Button>
                <Button variant="primary" size="sm" type="submit" isLoading={isCreatingBinding}>
                  Vincular ID
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {/* MODAL: EDITAR BINDING */}
      {editingBinding && selectedClient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in">
          <Card variant="elevated" className="max-w-md w-full space-y-4 bg-texter-surface border-texter-border">
            <div className="flex items-center justify-between border-b border-texter-border pb-3">
              <div className="flex items-center gap-2">
                <Edit3 className="w-5 h-5 text-texter-cyan" />
                <h3 className="text-base font-bold text-white">Editar Binding ({editingBinding.external_id})</h3>
              </div>
              <button type="button" onClick={() => setEditingBinding(null)} className="text-texter-text-muted hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleUpdateBinding} className="space-y-3.5">
              <Input
                label="Teléfono"
                value={editBindingPhone}
                onChange={(e) => setEditBindingPhone(e.target.value)}
                placeholder="+18095551234"
              />

              <div className="flex items-center gap-2.5 pt-1">
                <input
                  type="checkbox"
                  id="editBindingActive"
                  checked={editBindingIsActive}
                  onChange={(e) => setEditBindingIsActive(e.target.checked)}
                  className="rounded border-texter-border text-texter-cyan focus:ring-texter-cyan/40 bg-texter-surface-subtle"
                />
                <label htmlFor="editBindingActive" className="text-xs text-white font-medium cursor-pointer">
                  Estado Activo (desmarcar para desactivar/liberar temporalmente)
                </label>
              </div>

              <div className="pt-2 flex justify-end gap-2 border-t border-texter-border">
                <Button variant="ghost" size="sm" type="button" onClick={() => setEditingBinding(null)}>
                  Cancelar
                </Button>
                <Button variant="primary" size="sm" type="submit" isLoading={isUpdatingBinding}>
                  Guardar Cambios
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {/* MODAL: CONFIRMAR LIBERAR BINDING */}
      {deletingBinding && selectedClient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in">
          <Card variant="elevated" className="max-w-md w-full space-y-4 bg-texter-surface border-texter-rose/40">
            <div className="flex items-center gap-2.5 text-texter-rose font-bold text-base">
              <Trash2 className="w-5 h-5" />
              Liberar ID Externo
            </div>
            <p className="text-xs text-texter-text-muted leading-relaxed">
              ¿Estás seguro de que deseas liberar el ID <strong className="text-white">&quot;{deletingBinding.external_id}&quot;</strong> del canal <strong className="text-white">{deletingBinding.channel.toUpperCase()}</strong>? Se eliminará la vinculación permanentemente de la base de datos.
            </p>
            <div className="pt-2 flex justify-end gap-2 border-t border-texter-border">
              <Button variant="ghost" size="sm" onClick={() => setDeletingBinding(null)}>
                Volver
              </Button>
              <Button variant="danger" size="sm" onClick={handleConfirmDeleteBinding} isLoading={isDeletingBinding}>
                Confirmar Liberación
              </Button>
            </div>
          </Card>
        </div>
      )}


      {/* MODAL: CREAR WIDGET */}
      {isCreateWidgetOpen && selectedClient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in">
          <Card variant="elevated" className="max-w-md w-full space-y-4 bg-texter-surface border-texter-border">
            <div className="flex items-center justify-between border-b border-texter-border pb-3">
              <div className="flex items-center gap-2">
                <Bot className="w-5 h-5 text-blue-400" />
                <h3 className="text-base font-bold text-white">Crear Widget de Chat</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsCreateWidgetOpen(false)}
                className="text-texter-text-muted hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {createWidgetError && (
              <div className="p-3 rounded-xl bg-texter-rose/10 border border-texter-rose/30 text-xs text-rose-300 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-texter-rose shrink-0 mt-0.5" />
                <span>{createWidgetError}</span>
              </div>
            )}

            <form onSubmit={handleCreateWidget} className="space-y-3.5">
              <Input
                label="Nombre del Widget"
                value={widgetName}
                onChange={(e) => setWidgetName(e.target.value)}
                placeholder="ej: Asistente Web Principal"
              />

              <Input
                label="Mensaje de Bienvenida (Greeting)"
                value={widgetGreeting}
                onChange={(e) => setWidgetGreeting(e.target.value)}
                placeholder="¡Hola! ¿En qué podemos ayudarte hoy?"
              />

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-texter-text-secondary">Color Principal</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={widgetPrimaryColor}
                      onChange={(e) => setWidgetPrimaryColor(e.target.value)}
                      className="w-9 h-9 rounded-lg border border-texter-border bg-texter-surface-subtle cursor-pointer p-0.5"
                    />
                    <input
                      type="text"
                      value={widgetPrimaryColor}
                      onChange={(e) => setWidgetPrimaryColor(e.target.value)}
                      className="flex-1 p-2 rounded-xl bg-texter-surface-subtle border border-texter-border text-xs text-white font-mono"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-texter-text-secondary">Posición</label>
                  <select
                    value={widgetPosition}
                    onChange={(e) => setWidgetPosition(e.target.value as any)}
                    className="w-full p-2.5 rounded-xl bg-texter-surface-subtle border border-texter-border text-xs text-white outline-none font-mono"
                  >
                    <option value="bottom-right">Inferior Derecha</option>
                    <option value="bottom-left">Inferior Izquierda</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1.5 pt-1">
                <label className="text-xs font-medium text-texter-text-secondary">Fuentes de Datos Autorizadas</label>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="srcWeb"
                    checked={widgetAllowedSources.includes("web")}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setWidgetAllowedSources([...widgetAllowedSources, "web"]);
                      } else {
                        setWidgetAllowedSources(widgetAllowedSources.filter((s) => s !== "web"));
                      }
                    }}
                    className="rounded border-texter-border text-texter-cyan focus:ring-texter-cyan/40 bg-texter-surface-subtle"
                  />
                  <label htmlFor="srcWeb" className="text-xs text-white cursor-pointer">
                    Contenido Web del Negocio (Web Crawling & QA)
                  </label>
                </div>
              </div>

              <div className="pt-2 flex justify-end gap-2 border-t border-texter-border">
                <Button variant="ghost" size="sm" type="button" onClick={() => setIsCreateWidgetOpen(false)}>
                  Cancelar
                </Button>
                <Button variant="primary" size="sm" type="submit" isLoading={isCreatingWidget}>
                  Crear Widget
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {/* MODAL: EDITAR WIDGET (WIDGET-4) */}
      {editingWidget && selectedClient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in">
          <Card variant="elevated" className="max-w-md w-full space-y-4 bg-texter-surface border-texter-border">
            <div className="flex items-center justify-between border-b border-texter-border pb-3">
              <div className="flex items-center gap-2">
                <Bot className="w-5 h-5 text-blue-400" />
                <h3 className="text-base font-bold text-white">Editar Widget de Chat</h3>
              </div>
              <button
                type="button"
                onClick={() => setEditingWidget(null)}
                className="text-texter-text-muted hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {editWidgetError && (
              <div className="p-3 rounded-xl bg-texter-rose/10 border border-texter-rose/30 text-xs text-rose-300 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-texter-rose shrink-0 mt-0.5" />
                <span>{editWidgetError}</span>
              </div>
            )}

            <form onSubmit={handleUpdateWidget} className="space-y-3.5">
              <Input
                label="Nombre del Widget"
                value={editWidgetName}
                onChange={(e) => setEditWidgetName(e.target.value)}
                placeholder="ej: Asistente Web Principal"
                required
              />

              <Input
                label="Mensaje de Bienvenida (Greeting)"
                value={editWidgetGreeting}
                onChange={(e) => setEditWidgetGreeting(e.target.value)}
                placeholder="¡Hola! ¿En qué podemos ayudarte hoy?"
              />

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-texter-text-secondary">Color Principal</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={editWidgetPrimaryColor}
                      onChange={(e) => setEditWidgetPrimaryColor(e.target.value)}
                      className="w-9 h-9 rounded-lg border border-texter-border bg-texter-surface-subtle cursor-pointer p-0.5"
                    />
                    <input
                      type="text"
                      value={editWidgetPrimaryColor}
                      onChange={(e) => setEditWidgetPrimaryColor(e.target.value)}
                      className="flex-1 p-2 rounded-xl bg-texter-surface-subtle border border-texter-border text-xs text-white font-mono"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-texter-text-secondary">Posición</label>
                  <select
                    value={editWidgetPosition}
                    onChange={(e) => setEditWidgetPosition(e.target.value as any)}
                    className="w-full p-2.5 rounded-xl bg-texter-surface-subtle border border-texter-border text-xs text-white outline-none font-mono"
                  >
                    <option value="bottom-right">Inferior Derecha</option>
                    <option value="bottom-left">Inferior Izquierda</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1.5 pt-1">
                <label className="text-xs font-medium text-texter-text-secondary">Fuentes de Datos Autorizadas</label>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="editSrcWeb"
                    checked={editWidgetAllowedSources.includes("web")}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setEditWidgetAllowedSources([...editWidgetAllowedSources, "web"]);
                      } else {
                        setEditWidgetAllowedSources(editWidgetAllowedSources.filter((s) => s !== "web"));
                      }
                    }}
                    className="rounded border-texter-border text-texter-cyan focus:ring-texter-cyan/40 bg-texter-surface-subtle"
                  />
                  <label htmlFor="editSrcWeb" className="text-xs text-white cursor-pointer">
                    Contenido Web del Negocio (Web Crawling & QA)
                  </label>
                </div>
              </div>

              <div className="pt-2 flex justify-end gap-2 border-t border-texter-border">
                <Button variant="ghost" size="sm" type="button" onClick={() => setEditingWidget(null)}>
                  Cancelar
                </Button>
                <Button variant="primary" size="sm" type="submit" isLoading={isUpdatingWidget}>
                  Guardar Cambios
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {/* MODAL: CONFIRMAR DESACTIVAR WIDGET */}
      {deletingWidget && selectedClient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in">
          <Card variant="elevated" className="max-w-md w-full space-y-4 bg-texter-surface border-texter-rose/40">
            <div className="flex items-center gap-2.5 text-texter-rose font-bold text-base">
              <Trash2 className="w-5 h-5" />
              Desactivar Widget
            </div>
            <p className="text-xs text-texter-text-muted leading-relaxed">
              ¿Estás seguro de que deseas desactivar el widget <strong className="text-white">&quot;{deletingWidget.name}&quot;</strong>? La burbuja de chat dejará de responder inmediatamente en las páginas web donde esté incrustado.
            </p>
            <div className="pt-2 flex justify-end gap-2 border-t border-texter-border">
              <Button variant="ghost" size="sm" onClick={() => setDeletingWidget(null)}>
                Volver
              </Button>
              <Button variant="danger" size="sm" onClick={handleConfirmDeleteWidget} isLoading={isDeletingWidget}>
                Confirmar Desactivación
              </Button>
            </div>
          </Card>
        </div>
      )}


      {/* MODAL: INVITAR USUARIO */}
      {isInviteOpen && selectedClient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in">
          <Card variant="elevated" className="max-w-md w-full space-y-4 bg-texter-surface border-texter-border">
            <div className="flex items-center justify-between border-b border-texter-border pb-3">
              <div className="flex items-center gap-2">
                <UserPlus className="w-5 h-5 text-amber-400" />
                <h3 className="text-base font-bold text-white">
                  {createdInviteResult ? "Enlace de Invitación Creado" : "Invitar Usuario al Workspace"}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsInviteOpen(false);
                  setCreatedInviteResult(null);
                }}
                className="text-texter-text-muted hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {createdInviteResult ? (
              <div className="space-y-4">
                <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-300 flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  <div>
                    <strong className="block font-bold">Invitación generada para {createdInviteResult.email}</strong>
                    <span>Pásale este link al cliente para que active su acceso:</span>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-mono text-texter-text-muted uppercase">Link de Invitación:</label>
                  <div className="p-3 rounded-xl bg-texter-surface-subtle border border-texter-border font-mono text-xs text-white break-all select-all flex items-center justify-between gap-2">
                    <span>{createdInviteResult.invite_link}</span>
                  </div>
                </div>

                <p className="text-[11px] text-amber-400/90 font-mono">
                  * El enlace es válido durante 7 días y solo puede ser utilizado una vez.
                </p>

                <div className="pt-2 flex justify-between items-center border-t border-texter-border">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      navigator.clipboard.writeText(createdInviteResult.invite_link);
                      setHasCopiedInviteLink(true);
                      setTimeout(() => setHasCopiedInviteLink(false), 3000);
                    }}
                    className="flex items-center gap-1.5 text-xs"
                  >
                    {hasCopiedInviteLink ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="text-emerald-400 font-bold">¡Copiado!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5 text-texter-cyan" />
                        <span>Copiar Link</span>
                      </>
                    )}
                  </Button>

                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => {
                      setIsInviteOpen(false);
                      setCreatedInviteResult(null);
                    }}
                  >
                    Listo, cerrar
                  </Button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleCreateInvite} className="space-y-3.5">
                {inviteError && (
                  <div className="p-3 rounded-xl bg-texter-rose/10 border border-texter-rose/30 text-xs text-rose-300 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-texter-rose shrink-0 mt-0.5" />
                    <span>{inviteError}</span>
                  </div>
                )}

                <Input
                  label="Correo Electrónico *"
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="ej: cliente@negocio.com"
                  required
                />

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-texter-text-secondary">Rol Asignado</label>
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as any)}
                    className="w-full p-2.5 rounded-xl bg-texter-surface-subtle border border-texter-border text-xs text-white outline-none font-sans"
                  >
                    <option value="member">Miembro / Empleado (acceso estándar a tareas)</option>
                    <option value="admin">Administrador (gestión de agentes y configuración)</option>
                    <option value="owner">Dueño (control total del workspace)</option>
                  </select>
                </div>

                <p className="text-[11px] text-texter-text-muted leading-relaxed">
                  Se creará un token seguro de un solo uso con vigencia de 7 días para que el cliente vincule su cuenta.
                </p>

                <div className="pt-2 flex justify-end gap-2 border-t border-texter-border">
                  <Button variant="ghost" size="sm" type="button" onClick={() => setIsInviteOpen(false)}>
                    Cancelar
                  </Button>
                  <Button variant="primary" size="sm" type="submit" isLoading={isSubmittingInvite}>
                    Generar Invitación
                  </Button>
                </div>
              </form>
            )}
          </Card>
        </div>
      )}


      {/* MODAL: CONFIRMAR APLICAR PRESET DE PERMISOS */}
      {confirmingPreset && selectedClient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in">
          <Card variant="elevated" className="max-w-md w-full space-y-4 bg-texter-surface border-rose-500/40">
            <div className="flex items-center gap-2.5 text-rose-400 font-bold text-base">
              <ShieldCheck className="w-5 h-5" />
              Aplicar Preset de Permisos
            </div>
            <p className="text-xs text-texter-text-muted leading-relaxed">
              ¿Deseas aplicar la plantilla <strong className="text-white">&quot;{confirmingPreset.toUpperCase()}&quot;</strong> al rol <strong className="text-white">{selectedPermRole.toUpperCase()}</strong> en <strong className="text-white">{selectedClient.display_name}</strong>? Se sobrescribirá la configuración actual de este rol.
            </p>
            <div className="pt-2 flex justify-end gap-2 border-t border-texter-border">
              <Button variant="ghost" size="sm" onClick={() => setConfirmingPreset(null)}>
                Cancelar
              </Button>
              <Button variant="danger" size="sm" onClick={handleConfirmApplyPreset} isLoading={isApplyingPreset}>
                Confirmar y Aplicar
              </Button>
            </div>
          </Card>
        </div>
      )}


      {/* MODAL: CONFIRMAR ACCIÓN DE FACTURA (PAGADA / CANCELADA) */}
      {confirmInvoiceAction && selectedClient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in">
          <Card
            variant="elevated"
            className={`max-w-md w-full space-y-4 bg-texter-surface ${
              confirmInvoiceAction.nextStatus === "paid" ? "border-emerald-500/40" : "border-texter-rose/40"
            }`}
          >
            <div
              className={`flex items-center gap-2.5 font-bold text-base ${
                confirmInvoiceAction.nextStatus === "paid" ? "text-emerald-400" : "text-texter-rose"
              }`}
            >
              {confirmInvoiceAction.nextStatus === "paid" ? (
                <>
                  <CheckCircle className="w-5 h-5" />
                  Marcar Factura como Pagada
                </>
              ) : (
                <>
                  <AlertTriangle className="w-5 h-5" />
                  Cancelar Factura
                </>
              )}
            </div>

            <p className="text-xs text-texter-text-muted leading-relaxed">
              ¿Confirmas que deseas{" "}
              {confirmInvoiceAction.nextStatus === "paid" ? (
                <strong className="text-white">marcar como pagada</strong>
              ) : (
                <strong className="text-white">cancelar</strong>
              )}{" "}
              la factura del período <strong className="text-white">{confirmInvoiceAction.invoice.period}</strong> por un monto de{" "}
              <strong className="text-emerald-400">${Number(confirmInvoiceAction.invoice.amount).toFixed(2)} USD</strong>?
            </p>

            <div className="pt-2 flex justify-end gap-2 border-t border-texter-border">
              <Button variant="ghost" size="sm" onClick={() => setConfirmInvoiceAction(null)}>
                Volver
              </Button>
              <Button
                variant={confirmInvoiceAction.nextStatus === "paid" ? "primary" : "danger"}
                size="sm"
                onClick={handleUpdateInvoiceStatus}
                isLoading={isUpdatingInvoice}
              >
                {confirmInvoiceAction.nextStatus === "paid" ? "Confirmar Pago" : "Confirmar Cancelación"}
              </Button>
            </div>
          </Card>
        </div>
      )}

    </DashboardShell>
  );
}
