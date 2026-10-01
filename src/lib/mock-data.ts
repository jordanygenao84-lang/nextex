export interface MetricItem {
  id: string;
  label: string;
  value: string;
  change: string;
  isPositive: boolean;
  timeframe: string;
  iconName: string;
}

export interface JobItem {
  id: string;
  title: string;
  agent: string;
  model: string;
  status: "completed" | "running" | "failed" | "queued";
  duration: string;
  tokens: string;
  timestamp: string;
}

export interface ActivityItem {
  id: string;
  title: string;
  description: string;
  type: "agent" | "automation" | "system" | "security";
  status: "success" | "warning" | "info" | "error";
  timestamp: string;
}

export interface AgentItem {
  id: string;
  name: string;
  role: string;
  status: "idle" | "active" | "training";
  tasksCompleted: number;
  accuracy: string;
  avatar: string;
}

export interface ChatSession {
  id: string;
  title: string;
  updatedAt: string;
  agent: string;
  messageCount: number;
}

export interface ExecutionStep {
  step: number;
  title: string;
  status: "completed" | "in_progress" | "pending";
  description: string;
  duration?: string;
  toolUsed?: string;
}

export interface ChatMessage {
  id: string;
  sender: "user" | "assistant";
  timestamp: string;
  content: string;
  model?: string;
  pipeline?: {
    intent: string;
    steps: ExecutionStep[];
    toolsTriggered: string[];
    resultSummary?: string;
  };
}

export const MOCK_METRICS: MetricItem[] = [
  {
    id: "m-1",
    label: "Tokens Procesados (Hoy)",
    value: "1.42M",
    change: "+18.4%",
    isPositive: true,
    timeframe: "vs. ayer",
    iconName: "Cpu",
  },
  {
    id: "m-2",
    label: "Tareas Autónomas Ejecutadas",
    value: "3,892",
    change: "+24.1%",
    isPositive: true,
    timeframe: "últimos 7 días",
    iconName: "Workflow",
  },
  {
    id: "m-3",
    label: "Tasa de Éxito en Pipelines",
    value: "99.2%",
    change: "+0.4%",
    isPositive: true,
    timeframe: "vs. mes anterior",
    iconName: "CheckCircle2",
  },
  {
    id: "m-4",
    label: "Tiempo Promedio de Respuesta",
    value: "410ms",
    change: "-12.5%",
    isPositive: true,
    timeframe: "latencia global",
    iconName: "Zap",
  },
];

export const MOCK_JOBS: JobItem[] = [
  {
    id: "JOB-8821",
    title: "Análisis y Extracción de Balances Financieros",
    agent: "Finance Analyst v2",
    model: "Claude 3.5 Sonnet",
    status: "completed",
    duration: "4.2s",
    tokens: "18.4k",
    timestamp: "Hace 4 min",
  },
  {
    id: "JOB-8820",
    title: "Sincronización de Base de Datos Vectorial",
    agent: "Data Sync Engine",
    model: "Embeddings-Large",
    status: "running",
    duration: "12.8s",
    tokens: "45.1k",
    timestamp: "En progreso",
  },
  {
    id: "JOB-8819",
    title: "Generación de Documentación de API y SDK",
    agent: "Code Architect Pro",
    model: "GPT-4o",
    status: "completed",
    duration: "6.8s",
    tokens: "32.0k",
    timestamp: "Hace 22 min",
  },
  {
    id: "JOB-8818",
    title: "Auditoría Automática de Seguridad en Endpoints",
    agent: "Security Sentinel",
    model: "Gemini 1.5 Pro",
    status: "completed",
    duration: "9.1s",
    tokens: "51.2k",
    timestamp: "Hace 1 hora",
  },
  {
    id: "JOB-8817",
    title: "Indexación de Documentos PDF y OCR",
    agent: "DocuParser AI",
    model: "Custom Vision",
    status: "failed",
    duration: "1.2s",
    tokens: "4.1k",
    timestamp: "Hace 2 horas",
  },
];

export const MOCK_ACTIVITIES: ActivityItem[] = [
  {
    id: "act-1",
    title: "Pipeline de Automatización Completado",
    description: "El agente Finance Analyst procesó 14 balances y generó el informe ejecutivo.",
    type: "automation",
    status: "success",
    timestamp: "18:24",
  },
  {
    id: "act-2",
    title: "Nuevo Agente Autónomo Desplegado",
    description: "Versión 'Data Sync Engine 2.1' conectada con Supabase Vector Storage.",
    type: "agent",
    status: "info",
    timestamp: "17:50",
  },
  {
    id: "act-3",
    title: "Límite de Concurrencia Alcanzado",
    description: "Pico de 120 peticiones concurrentes absorbido con auto-escalado.",
    type: "system",
    status: "warning",
    timestamp: "16:15",
  },
  {
    id: "act-4",
    title: "Sesión de Super Admin Verificada",
    description: "Acceso autorizado desde dirección IP de confianza con 2FA activo.",
    type: "security",
    status: "success",
    timestamp: "14:02",
  },
];

export const MOCK_AGENTS: AgentItem[] = [
  {
    id: "ag-1",
    name: "Nextex Core Orchestrator",
    role: "Coordinador de Tareas Complejas",
    status: "active",
    tasksCompleted: 1420,
    accuracy: "99.8%",
    avatar: "NX",
  },
  {
    id: "ag-2",
    name: "Finance & Data Analyst",
    role: "Modelado Matemático e Informes",
    status: "active",
    tasksCompleted: 852,
    accuracy: "99.1%",
    avatar: "FA",
  },
  {
    id: "ag-3",
    name: "Code & Infrastructure Engineer",
    role: "Refactorización y Scripts Seguros",
    status: "idle",
    tasksCompleted: 640,
    accuracy: "98.9%",
    avatar: "CI",
  },
  {
    id: "ag-4",
    name: "Security & RLS Sentinel",
    role: "Auditoría de Políticas de Supabase",
    status: "active",
    tasksCompleted: 980,
    accuracy: "100%",
    avatar: "SS",
  },
];

export const MOCK_SESSIONS: ChatSession[] = [
  {
    id: "chat-1",
    title: "Auditoría de Políticas RLS y Permisos",
    updatedAt: "Hace 15 min",
    agent: "Security Sentinel",
    messageCount: 8,
  },
  {
    id: "chat-2",
    title: "Estructuración de Pipeline Financiero",
    updatedAt: "Hace 2 horas",
    agent: "Finance Analyst",
    messageCount: 14,
  },
  {
    id: "chat-3",
    title: "Análisis de Latencia en Edge Functions",
    updatedAt: "Ayer",
    agent: "Code Architect",
    messageCount: 6,
  },
  {
    id: "chat-4",
    title: "Diseño del Esquema de Base de Datos",
    updatedAt: "Hace 3 días",
    agent: "Core Orchestrator",
    messageCount: 22,
  },
];

export const MOCK_CHAT_MESSAGES: ChatMessage[] = [
  {
    id: "msg-1",
    sender: "user",
    timestamp: "18:15",
    content: "Analiza el rendimiento de la API en los últimos 7 días y comprueba si hay cuellos de botella en las consultas vectoriales.",
  },
  {
    id: "msg-2",
    sender: "assistant",
    timestamp: "18:16",
    model: "NEXTEХ OmniEngine v1 (Multi-Model)",
    content: "He completado el diagnóstico integral del cluster y de las conexiones con Supabase Vector Storage. El rendimiento general se mantiene con una latencia p95 de 410ms.",
    pipeline: {
      intent: "Diagnosticar métricas de latencia p95 y cuellos de botella vectoriales",
      steps: [
        {
          step: 1,
          title: "Análisis Semántico de la Petición",
          status: "completed",
          description: "Descomposición en 3 vectores de búsqueda y telemetría de red.",
          duration: "180ms",
        },
        {
          step: 2,
          title: "Consulta a Supabase Metrics & Telemetría",
          status: "completed",
          description: "Inspección de 85,000 llamadas a pgvector y tiempo de ejecución.",
          duration: "640ms",
          toolUsed: "supabase_vector_telemetry()",
        },
        {
          step: 3,
          title: "Evaluación de Cuellos de Botella",
          status: "completed",
          description: "Detección de índice IVFFlat con degradación menor en partición Q3.",
          duration: "320ms",
          toolUsed: "index_optimizer_analyzer()",
        },
        {
          step: 4,
          title: "Síntesis y Generación de Recomendaciones",
          status: "completed",
          description: "Estructuración del reporte ejecutivo y comandos de optimización.",
          duration: "250ms",
        },
      ],
      toolsTriggered: ["supabase_vector_telemetry", "index_optimizer_analyzer", "cache_hit_audit"],
      resultSummary: "Se identificó una oportunidad de mejora del 18% migrando de índice IVFFlat a HNSW en la tabla de embeddings principales.",
    },
  },
  {
    id: "msg-3",
    sender: "user",
    timestamp: "18:19",
    content: "Genera el script SQL de migración a HNSW con un factor de seguridad que no interrumpa las consultas activas.",
  },
  {
    id: "msg-4",
    sender: "assistant",
    timestamp: "18:20",
    model: "NEXTEХ OmniEngine v1 (Multi-Model)",
    content: "Aquí tienes el script optimizado utilizando `CONCURRENTLY` para evitar bloqueos de tabla durante la reindexación en Supabase PostgreSQL:\n\n```sql\n-- NEXTEХ Database Optimization Pipeline\n-- Migración a índice HNSW no bloqueante para Supabase Vector\n\nBEGIN;\n\n-- 1. Crear nuevo índice HNSW sin bloquear lecturas ni escrituras concurrentes\nCREATE INDEX CONCURRENTLY IF NOT EXISTS idx_texter_embeddings_hnsw\nON public.document_embeddings\nUSING hnsw (embedding vector_cosine_ops)\nWITH (m = 16, ef_construction = 64);\n\n-- 2. Validar integridad antes de descartar el índice previo\nANALYZE public.document_embeddings;\n\nCOMMIT;\n```\n\nEste índice optimiza las búsquedas por similitud de coseno reduciendo la latencia de 410ms a un rango proyectado de ~120ms sin tiempo de inactividad.",
  },
];
