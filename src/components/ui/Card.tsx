import React from "react";
import { cn } from "@/lib/utils";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "elevated" | "subtle" | "interactive";
  padding?: "none" | "sm" | "md" | "lg";
  glow?: "none" | "indigo" | "cyan";
}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  (
    {
      className,
      children,
      variant = "default",
      padding = "md",
      glow = "none",
      ...props
    },
    ref
  ) => {
    const variantStyles = {
      default: "bg-texter-surface border border-texter-border",
      elevated: "bg-texter-surface-elevated border border-texter-border shadow-texter-card",
      subtle: "bg-texter-surface-subtle border border-texter-border-subtle",
      interactive:
        "bg-texter-surface border border-texter-border hover:border-texter-border-hover hover:bg-texter-surface-hover cursor-pointer transition-all duration-200 active:scale-[0.995]",
    };

    const glowStyles = {
      none: "",
      indigo: "hover:shadow-texter-glow-indigo hover:border-indigo-500/30",
      cyan: "hover:shadow-texter-glow-cyan hover:border-cyan-500/30",
    };

    const paddingStyles = {
      none: "p-0",
      sm: "p-3.5",
      md: "p-5",
      lg: "p-6 sm:p-8",
    };

    return (
      <div
        ref={ref}
        className={cn(
          "rounded-2xl transition-all duration-200 relative overflow-hidden",
          variantStyles[variant],
          paddingStyles[padding],
          glowStyles[glow],
          className
        )}
        {...props}
      >
        {children}
      </div>
    );
  }
);

Card.displayName = "Card";
