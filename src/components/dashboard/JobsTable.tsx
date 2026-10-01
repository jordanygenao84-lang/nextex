"use client";

import React, { useState } from "react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { JobItem, MOCK_JOBS } from "@/lib/mock-data";
import { Play, RotateCw, Terminal, Eye, Filter } from "lucide-react";
import { Tabs } from "@/components/ui/Tabs";

export const JobsTable: React.FC = () => {
  const [filter, setFilter] = useState("all");

  const tabs = [
    { id: "all", label: "Todos los Trabajos", count: MOCK_JOBS.length },
    {
      id: "completed",
      label: "Completados",
      count: MOCK_JOBS.filter((j) => j.status === "completed").length,
    },
    {
      id: "running",
      label: "En Ejecución",
      count: MOCK_JOBS.filter((j) => j.status === "running").length,
    },
    {
      id: "failed",
      label: "Fallidos",
      count: MOCK_JOBS.filter((j) => j.status === "failed").length,
    },
  ];

  const filteredJobs = MOCK_JOBS.filter((job) => {
    if (filter === "all") return true;
    return job.status === filter;
  });

  const getStatusBadge = (status: JobItem["status"]) => {
    switch (status) {
      case "completed":
        return (
          <Badge variant="success" size="sm" dot>
            Completado
          </Badge>
        );
      case "running":
        return (
          <Badge variant="cyan" size="sm" dot>
            Ejecutando
          </Badge>
        );
      case "failed":
        return (
          <Badge variant="error" size="sm" dot>
            Error
          </Badge>
        );
      case "queued":
        return (
          <Badge variant="warning" size="sm" dot>
            En cola
          </Badge>
        );
    }
  };

  return (
    <Card variant="elevated" padding="none">
      {/* Header and Tabs */}
      <div className="p-4 sm:p-5 border-b border-texter-border flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <Terminal className="w-4 h-4 text-texter-indigo" />
            Registro de Trabajos Autónomos
          </h2>
          <p className="text-xs text-texter-text-muted mt-0.5">
            Monitoreo en tiempo real de pipelines y ejecuciones de agentes
          </p>
        </div>
        <Tabs tabs={tabs} activeTab={filter} onChange={setFilter} />
      </div>

      {/* Table Container */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-texter-surface-subtle/80 text-[11px] uppercase font-mono tracking-wider text-texter-text-muted border-b border-texter-border">
            <tr>
              <th className="py-3 px-4 sm:px-5">ID & Tarea</th>
              <th className="py-3 px-4">Agente</th>
              <th className="py-3 px-4">Modelo</th>
              <th className="py-3 px-4">Estado</th>
              <th className="py-3 px-4 text-right">Tokens</th>
              <th className="py-3 px-4 text-right">Latencia</th>
              <th className="py-3 px-4 text-center">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-texter-border/50 text-xs">
            {filteredJobs.map((job) => (
              <tr
                key={job.id}
                className="hover:bg-texter-surface-hover/50 transition-colors group"
              >
                <td className="py-3.5 px-4 sm:px-5">
                  <div className="flex flex-col">
                    <span className="font-semibold text-white group-hover:text-texter-indigo transition-colors truncate max-w-xs sm:max-w-md">
                      {job.title}
                    </span>
                    <span className="text-[10px] text-texter-text-dim font-mono">
                      {job.id} • {job.timestamp}
                    </span>
                  </div>
                </td>
                <td className="py-3.5 px-4 text-texter-text-secondary font-medium">
                  {job.agent}
                </td>
                <td className="py-3.5 px-4">
                  <span className="font-mono text-[11px] text-texter-text-muted px-2 py-0.5 rounded bg-texter-surface-subtle border border-texter-border">
                    {job.model}
                  </span>
                </td>
                <td className="py-3.5 px-4">{getStatusBadge(job.status)}</td>
                <td className="py-3.5 px-4 text-right font-mono text-texter-text-secondary">
                  {job.tokens}
                </td>
                <td className="py-3.5 px-4 text-right font-mono text-texter-cyan">
                  {job.duration}
                </td>
                <td className="py-3.5 px-4 text-center">
                  <div className="flex items-center justify-center gap-1">
                    <button
                      className="p-1.5 rounded-lg text-texter-text-muted hover:text-white hover:bg-texter-surface border border-transparent hover:border-texter-border transition-colors"
                      title="Ver detalles del pipeline"
                    >
                      <Eye className="w-3.5 h-3.5" />
                    </button>
                    {job.status === "failed" && (
                      <button
                        className="p-1.5 rounded-lg text-texter-rose hover:bg-texter-rose/10 border border-transparent hover:border-texter-rose/30 transition-colors"
                        title="Reintentar tarea"
                      >
                        <RotateCw className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div className="p-3 bg-texter-surface-subtle/50 border-t border-texter-border flex items-center justify-between text-xs text-texter-text-dim px-5">
        <span>Mostrando {filteredJobs.length} de {MOCK_JOBS.length} ejecuciones</span>
        <span className="font-mono">Supabase Realtime Sync • Activo</span>
      </div>
    </Card>
  );
};
