"use client";

import { useEffect } from "react";

export function PwaRegister() {
  useEffect(() => {
    if (typeof window !== "undefined" && "serviceWorker" in navigator) {
      window.addEventListener("load", () => {
        navigator.serviceWorker
          .register("/sw.js", { scope: "/" })
          .then((registration) => {
            if (process.env.NODE_ENV === "development") {
              console.log("[PWA] Service Worker registrado con éxito:", registration.scope);
            }
          })
          .catch((error) => {
            console.warn("[PWA] Error al registrar Service Worker:", error);
          });
      });
    }
  }, []);

  return null;
}
