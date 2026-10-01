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

  // Monogram / Symbol
  const Symbol = (
    <div
      className={cn(
        "rounded-xl bg-gradient-to-tr from-texter-indigo to-texter-cyan flex items-center justify-center font-mono font-black text-white shrink-0 shadow-texter-glow-indigo relative select-none",
        iconSizes[size]
      )}
    >
      <span className="tracking-tighter">NX</span>
      <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-texter-cyan border border-texter-bg animate-pulse" />
    </div>
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
          NEXTEХ
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
