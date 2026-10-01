import React from "react";
import { cn } from "@/lib/utils";
import { Button } from "./Button";

export interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  actionLabel,
  onAction,
  className,
}) => {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center p-8 sm:p-12 text-center border border-dashed border-texter-border rounded-2xl bg-texter-surface-subtle/50",
        className
      )}
    >
      <div className="w-12 h-12 rounded-xl bg-texter-surface border border-texter-border flex items-center justify-center text-texter-indigo mb-4 shadow-texter-glow-indigo">
        {icon}
      </div>
      <h3 className="text-base font-semibold text-texter-text-primary mb-1">{title}</h3>
      <p className="text-sm text-texter-text-muted max-w-sm mb-6 leading-relaxed">
        {description}
      </p>
      {actionLabel && (
        <Button variant="secondary" size="sm" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
};
