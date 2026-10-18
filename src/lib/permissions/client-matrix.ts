export const SECTIONS = [
  "conversaciones",
  "automatizaciones",
  "consumo",
  "config_ia",
  "usuarios",
] as const;

export const ACTIONS = [
  "ver",
  "responder",
  "pausar",
  "editar",
  "invitar",
] as const;

export const ROLES = ["owner", "admin", "member"] as const;

export const PRESETS = ["dueno", "empleado", "lectura"] as const;

export type Section = (typeof SECTIONS)[number];
export type Action = (typeof ACTIONS)[number];
export type Role = (typeof ROLES)[number];
export type Preset = (typeof PRESETS)[number];

export type PermissionMatrix = {
  roles: {
    [R in Role]: {
      [S in Section]: {
        [A in Action]: boolean;
      };
    };
  };
};

export function buildDefaultMatrix(): PermissionMatrix {
  const matrix: any = { roles: {} };

  for (const role of ROLES) {
    matrix.roles[role] = {};
    for (const section of SECTIONS) {
      matrix.roles[role][section] = {};
      for (const action of ACTIONS) {
        // Preset 'dueno' para owner (todo true), false para admin y member
        matrix.roles[role][section][action] = role === "owner";
      }
    }
  }

  return matrix;
}
