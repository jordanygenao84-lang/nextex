type ClassValue = string | number | boolean | undefined | null | bigint | false;

export function cn(...classes: ClassValue[]): string {
  return classes.filter(Boolean).join(" ");
}

export function formatNumber(num: number): string {
  return new Intl.NumberFormat("es-ES").format(num);
}
