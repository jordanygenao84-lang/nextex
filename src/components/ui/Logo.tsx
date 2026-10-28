import React from "react";
import { cn } from "@/lib/utils";

interface LogoProps {
  variant?: "full" | "compact" | "monogram";
  size?: "sm" | "md" | "lg";
  showTagline?: boolean;
  className?: string;
}

export const Logo: React.FC<LogoProps> = ({
  variant = "full",
  size = "md",
  showTagline = true,
  className,
}) => {
  const iconSizes = {
    sm: "w-7 h-7 text-xs",
    md: "w-8 h-8 text-sm",
    lg: "w-10 h-10 text-base",
  };

  const textSizes = {
    sm: "text-sm",
    md: "text-base",
    lg: "text-xl",
  };

  const taglineSizes = {
    sm: "text-[9px]",
    md: "text-[10px]",
    lg: "text-xs",
  };

  // Monogram / Symbol — N constelación (logo Opción 3, elegido por JC 2026-10-28)
  const Symbol = (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      className={cn("shrink-0 select-none", iconSizes[size])}
      style={{ filter: "drop-shadow(0 0 6px rgba(6,182,212,0.45))" }}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="nxConstellation" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#6366F1" />
          <stop offset="100%" stopColor="#06B6D4" />
        </linearGradient>
      </defs>
      <g stroke="url(#nxConstellation)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 12V32V52" />
        <path d="M50 12V32V52" />
        <path d="M14 12L32 32L50 52" />
        <path d="M14 12L24 22L32 32" />
        <path d="M24 22L14 32" />
        <path d="M14 32L32 32" />
        <path d="M32 32L50 32" />
        <path d="M32 32L40 42L50 52" />
        <path d="M50 12L32 32" />
      </g>
      <g fill="#67E8F9">
        <circle cx="14" cy="12" r="2.2" />
        <circle cx="14" cy="32" r="2.2" />
        <circle cx="14" cy="52" r="2.2" />
        <circle cx="50" cy="12" r="2.2" />
        <circle cx="50" cy="32" r="2.2" />
        <circle cx="50" cy="52" r="2.2" />
        <circle cx="32" cy="32" r="2.2" />
        <circle cx="24" cy="22" r="2.2" />
        <circle cx="40" cy="42" r="2.2" />
      </g>
    </svg>
  );

  if (variant === "monogram") {
    return <div className={cn("inline-flex items-center", className)}>{Symbol}</div>;
  }

  if (variant === "compact") {
    return (
      <div className={cn("inline-flex items-center gap-2 select-none", className)}>
        {Symbol}
        <span className={cn("font-black tracking-wider text-white font-mono", textSizes[size])}>
          N
        </span>
      </div>
    );
  }

  return (
    <div className={cn("inline-flex items-center gap-2.5 select-none", className)}>
      {Symbol}
      <div className="flex flex-col">
        <span className={cn("font-black tracking-wider text-white font-mono flex items-center gap-1.5 leading-none", textSizes[size])}>
          NEXTEX
          <span className="w-1.5 h-1.5 rounded-full bg-texter-cyan animate-pulse" />
        </span>
        {showTagline && (
          <span className={cn("text-texter-text-muted font-medium tracking-tight mt-1 leading-none", taglineSizes[size])}>
            AI & AUTOMATION PLATFORM
          </span>
        )}
      </div>
    </div>
  );
};
