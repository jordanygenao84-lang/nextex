import React from "react";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "outline" | "ghost" | "danger" | "cyan";
  size?: "sm" | "md" | "lg";
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      children,
      variant = "primary",
      size = "md",
      isLoading = false,
      leftIcon,
      rightIcon,
      disabled,
      ...props
    },
    ref
  ) => {
    const sizeClasses = {
      sm: "h-8 px-3 text-xs gap-1.5 rounded-lg",
      md: "h-10 px-4 text-sm gap-2 rounded-xl",
      lg: "h-12 px-6 text-base gap-2.5 rounded-xl font-medium",
    };

    const variantClasses = {
      primary:
        "bg-texter-indigo hover:bg-texter-indigo-hover text-white shadow-texter-glow-indigo active:scale-[0.98] transition-all duration-200 border border-indigo-400/20",
      secondary:
        "bg-texter-surface hover:bg-texter-surface-hover text-texter-text-primary border border-texter-border hover:border-texter-hover active:scale-[0.98] transition-all duration-200",
      outline:
        "bg-transparent hover:bg-texter-surface-hover text-texter-text-secondary hover:text-white border border-texter-border hover:border-texter-hover active:scale-[0.98] transition-all duration-200",
      ghost:
        "bg-transparent hover:bg-texter-surface-hover text-texter-text-secondary hover:text-white transition-all duration-150",
      danger:
        "bg-texter-rose/15 hover:bg-texter-rose/25 text-texter-rose border border-texter-rose/30 active:scale-[0.98] transition-all duration-200",
      cyan:
        "bg-texter-cyan/20 hover:bg-texter-cyan/30 text-cyan-300 border border-texter-cyan/40 shadow-texter-glow-cyan active:scale-[0.98] transition-all duration-200",
    };

    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        className={cn(
          "inline-flex items-center justify-center font-medium select-none transition-all outline-none focus-visible:ring-2 focus-visible:ring-texter-indigo/50 disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none",
          sizeClasses[size],
          variantClasses[variant],
          className
        )}
        {...props}
      >
        {isLoading ? (
          <Loader2 className="w-4 h-4 animate-spin text-current" />
        ) : (
          leftIcon
        )}
        <span>{children}</span>
        {!isLoading && rightIcon}
      </button>
    );
  }
);

Button.displayName = "Button";
