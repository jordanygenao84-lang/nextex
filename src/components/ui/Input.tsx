import React from "react";
import { cn } from "@/lib/utils";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  leftIcon?: React.ReactNode;
  rightElement?: React.ReactNode;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = "text", label, error, hint, leftIcon, rightElement, id, ...props }, ref) => {
    const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, "-") : undefined);

    return (
      <div className="w-full space-y-1.5">
        {label && (
          <label htmlFor={inputId} className="block text-xs font-medium text-texter-text-secondary">
            {label}
          </label>
        )}
        <div className="relative flex items-center">
          {leftIcon && (
            <div className="absolute left-3.5 flex items-center pointer-events-none text-texter-text-muted">
              {leftIcon}
            </div>
          )}
          <input
            id={inputId}
            ref={ref}
            type={type}
            className={cn(
              "w-full bg-texter-surface-subtle text-texter-text-primary placeholder:text-texter-text-dim text-sm rounded-xl border border-texter-border py-2.5 px-3.5 transition-all outline-none",
              "focus:border-texter-indigo focus:ring-2 focus:ring-texter-indigo/20 focus:bg-texter-surface",
              leftIcon && "pl-10",
              rightElement && "pr-10",
              error && "border-texter-rose focus:border-texter-rose focus:ring-texter-rose/20",
              className
            )}
            {...props}
          />
          {rightElement && (
            <div className="absolute right-3 flex items-center">{rightElement}</div>
          )}
        </div>
        {error ? (
          <p className="text-xs text-texter-rose font-medium mt-1">{error}</p>
        ) : hint ? (
          <p className="text-xs text-texter-text-dim mt-1">{hint}</p>
        ) : null}
      </div>
    );
  }
);

Input.displayName = "Input";
