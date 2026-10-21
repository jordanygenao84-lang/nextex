"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { LayoutDashboard, Activity } from "lucide-react";

const navItems = [
  { name: "Overview", href: "/admin", icon: LayoutDashboard },
  { name: "Vigilancia", href: "/admin/vigilancia", icon: Activity },
];

export const AdminNav: React.FC = () => {
  const pathname = usePathname();

  return (
    <div className="border-b border-texter-border bg-texter-surface/50 backdrop-blur-sm sticky top-0 z-20 mb-6 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8">
      <div className="flex items-center space-x-1 overflow-x-auto py-2.5 scrollbar-thin scrollbar-thumb-texter-border">
        {navItems.map((item) => {
          const isActive =
            item.href === "/admin"
              ? pathname === "/admin"
              : pathname.startsWith(item.href);
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap",
                isActive
                  ? "bg-texter-indigo text-white shadow-sm shadow-indigo-500/20 font-semibold"
                  : "text-texter-text-muted hover:text-white hover:bg-texter-surface-hover"
              )}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span>{item.name}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
};
