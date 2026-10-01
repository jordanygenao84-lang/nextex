import React from "react";
import { cn } from "@/lib/utils";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: "default" | "indigo" | "cyan" | "success" | "warning" | "error" | "outline";
  size?: "sm" | "md";
  dot?: boolean;
}

export const Badge: React.FC<BadgeProps> = ({
  className,
  children,
  variant = "default",
  size = "md",
  dot = false,
  ...props
}) => {
  const variantStyles = {
    default: "bg-texter-surface text-texter-text-secondary border-texter-border",
    indigo: "bg-texter-indigo/10 text-indigo-400 border-indigo-500/25",
    cyan: "bg-texter-cyan/10 text-cyan-400 border-cyan-500/25",
    success: "bg-texter-emerald/10 text-emerald-400 border-emerald-500/25",
    warning: "bg-texter-amber/10 text-amber-400 border-amber-500/25",
    error: "bg-texter-rose/10 text-rose-400 border-rose-500/25",
    outline: "bg-transparent text-texter-text-muted border-texter-border",
  };

  const dotColors = {
    default: "bg-texter-text-muted",
    indigo: "bg-texter-indigo animate-pulse",
    cyan: "bg-texter-cyan animate-pulse",
    success: "bg-texter-emerald",
    warning: "bg-texter-amber",
    error: "bg-texter-rose",
    outline: "bg-texter-text-dim",
  };

  const sizeStyles = {
    sm: "px-2 py-0.5 text-[11px] gap-1.5 rounded-md",
    md: "px-2.5 py-1 text-xs gap-2 rounded-lg",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center font-medium border select-none tracking-tight",
        variantStyles[variant],
        sizeStyles[size],
        className
      )}
      {...props}
    >
      {dot && <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", dotColors[variant])} />}
      {children}
    </span>
  );
};
