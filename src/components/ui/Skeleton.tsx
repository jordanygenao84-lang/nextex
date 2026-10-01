import React from "react";
import { cn } from "@/lib/utils";

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "text" | "rectangular" | "circular";
}

export const Skeleton: React.FC<SkeletonProps> = ({
  className,
  variant = "rectangular",
  ...props
}) => {
  const variantStyles = {
    text: "h-4 rounded-md w-full",
    rectangular: "rounded-xl w-full",
    circular: "rounded-full aspect-square",
  };

  return (
    <div
      className={cn(
        "relative overflow-hidden bg-texter-surface-hover/60 border border-texter-border/40 animate-pulse-subtle",
        "before:absolute before:inset-0 before:-translate-x-full before:animate-[shimmer_2s_infinite] before:bg-gradient-to-r before:from-transparent before:via-white/[0.04] before:to-transparent",
        variantStyles[variant],
        className
      )}
      {...props}
    />
  );
};
