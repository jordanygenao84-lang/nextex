"use client";

import React, { useState } from "react";
import { ChatMessage as ChatMessageType } from "@/lib/mock-data";
import { ExecutionPipeline } from "./ExecutionPipeline";
import {
  Copy,
  Check,
  RotateCw,
  Sparkles,
  User,
  Share2,
  FileCode,
} from "lucide-react";
import { cn } from "@/lib/utils";

export const ChatMessage: React.FC<{ message: ChatMessageType }> = ({
  message,
}) => {
  const [copied, setCopied] = useState(false);
  const isAssistant = message.sender === "assistant";

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Helper to render simple code block styling if content contains ```
  const renderFormattedContent = (content: string) => {
    if (!content.includes("```")) {
      return <p className="text-sm leading-relaxed whitespace-pre-wrap">{content}</p>;
    }

    const parts = content.split(/(```[\s\S]*?```)/g);
    return (
      <div className="space-y-3 text-sm">
        {parts.map((part, index) => {
          if (part.startsWith("```") && part.endsWith("```")) {
            const lines = part.slice(3, -3).trim().split("\n");
            const language = lines[0].match(/^[a-zA-Z0-9_-]+$/) ? lines[0] : "";
            const code = language ? lines.slice(1).join("\n") : lines.join("\n");

            return (
              <div
                key={index}
                className="my-3 rounded-xl bg-texter-surface-subtle border border-texter-border overflow-hidden"
              >
                <div className="flex items-center justify-between px-3.5 py-2 bg-texter-surface border-b border-texter-border text-xs text-texter-text-muted font-mono">
                  <span className="flex items-center gap-1.5 text-texter-cyan">
                    <FileCode className="w-3.5 h-3.5" />
                    {language || "code"}
                  </span>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(code);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    }}
                    className="hover:text-white transition-colors flex items-center gap-1"
                  >
                    {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                    <span>Copiar</span>
                  </button>
                </div>
                <pre className="p-4 font-mono text-xs overflow-x-auto text-texter-text-primary leading-relaxed">
                  <code>{code}</code>
                </pre>
              </div>
            );
          }
          return (
            <p key={index} className="leading-relaxed whitespace-pre-wrap">
              {part}
            </p>
          );
        })}
      </div>
    );
  };

  return (
    <div
      className={cn(
        "flex gap-3 sm:gap-4 py-4 px-2 sm:px-4 rounded-2xl transition-colors",
        isAssistant
          ? "bg-texter-surface/40 border border-texter-border/40"
          : "bg-transparent"
      )}
    >
      {/* Avatar */}
      <div
        className={cn(
          "w-8 h-8 rounded-xl flex items-center justify-center shrink-0 mt-0.5 border shadow-sm",
          isAssistant
            ? "bg-gradient-to-tr from-texter-indigo to-texter-cyan border-indigo-400/30 text-white"
            : "bg-texter-surface-elevated border-texter-border text-texter-text-secondary"
        )}
      >
        {isAssistant ? <Sparkles className="w-4 h-4" /> : <User className="w-4 h-4" />}
      </div>

      {/* Main message bubble */}
      <div className="flex-1 min-w-0 space-y-2">
        {/* Meta / Header */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-white font-mono">
              {isAssistant ? "NEXTEХ Agent" : "Tú"}
            </span>
            {isAssistant && message.model && (
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-texter-surface-subtle border border-texter-border text-texter-cyan">
                {message.model}
              </span>
            )}
          </div>
          <span className="text-[11px] font-mono text-texter-text-dim">
            {message.timestamp}
          </span>
        </div>

        {/* Execution Pipeline if present */}
        {message.pipeline && (
          <ExecutionPipeline
            intent={message.pipeline.intent}
            steps={message.pipeline.steps}
            toolsTriggered={message.pipeline.toolsTriggered}
            resultSummary={message.pipeline.resultSummary}
          />
        )}

        {/* Message Content */}
        <div className="text-texter-text-primary">
          {renderFormattedContent(message.content)}
        </div>

        {/* Action bar for assistant messages */}
        {isAssistant && (
          <div className="flex items-center gap-2 pt-2 text-texter-text-muted text-xs border-t border-texter-border/30 mt-3">
            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-2 py-1 rounded-lg hover:text-white hover:bg-texter-surface-hover transition-colors"
            >
              {copied ? (
                <Check className="w-3.5 h-3.5 text-texter-emerald" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
              <span>{copied ? "Copiado" : "Copiar"}</span>
            </button>
            <button className="flex items-center gap-1.5 px-2 py-1 rounded-lg hover:text-white hover:bg-texter-surface-hover transition-colors">
              <RotateCw className="w-3.5 h-3.5" />
              <span>Regenerar</span>
            </button>
            <button className="flex items-center gap-1.5 px-2 py-1 rounded-lg hover:text-white hover:bg-texter-surface-hover transition-colors">
              <Share2 className="w-3.5 h-3.5" />
              <span>Compartir</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
