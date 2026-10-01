/**
 * NEXTEХ Agent Core — Herramienta Nativa: Calculadora de Precisión
 * REGLA DE SEGURIDAD ESTRICTA: Prohibido el uso de eval() o Function().
 * Se utiliza un parser aritmético determinista y seguro.
 */

import { ToolExecutionContext } from "../types";

export interface CalculatorParams {
  expression: string;
}

export interface CalculatorResult {
  expression: string;
  result: number;
  formatted: string;
}

/**
 * Evalúa expresiones matemáticas de forma determinista y segura sin eval().
 */
export function evaluateMathExpression(expr: string): number {
  if (!expr || typeof expr !== "string") {
    throw new Error("La expresión matemática debe ser una cadena no vacía.");
  }

  // Sanitizar caracteres permitidos: dígitos, operadores, paréntesis, puntos, comas, espacios y funciones matemáticas
  const cleanExpr = expr.trim();
  const validPattern = /^[0-9+\-*/%^().,\s\w]+$/;
  if (!validPattern.test(cleanExpr)) {
    throw new Error("La expresión contiene caracteres no autorizados.");
  }

  // Tokenización básica
  const tokens: string[] = [];
  let i = 0;

  while (i < cleanExpr.length) {
    const char = cleanExpr[i];

    if (/\s/.test(char)) {
      i++;
      continue;
    }

    if (/[0-9.]/.test(char)) {
      let num = "";
      while (i < cleanExpr.length && /[0-9.]/.test(cleanExpr[i])) {
        num += cleanExpr[i];
        i++;
      }
      tokens.push(num);
      continue;
    }

    if (/[a-zA-Z_]/.test(char)) {
      let ident = "";
      while (i < cleanExpr.length && /[a-zA-Z0-9_]/.test(cleanExpr[i])) {
        ident += cleanExpr[i];
        i++;
      }
      tokens.push(ident.toLowerCase());
      continue;
    }

    if (["+", "-", "*", "/", "%", "^", "(", ")", ","].includes(char)) {
      tokens.push(char);
      i++;
      continue;
    }

    throw new Error(`Carácter desconocido en la expresión: '${char}'`);
  }

  // Parseador recursivo descendente simple y seguro
  let pos = 0;

  function peek(): string | null {
    return pos < tokens.length ? tokens[pos] : null;
  }

  function consume(expected?: string): string {
    const token = tokens[pos];
    if (expected && token !== expected) {
      throw new Error(`Se esperaba '${expected}' pero se encontró '${token}'`);
    }
    pos++;
    return token;
  }

  function parseExpression(): number {
    return parseAddition();
  }

  function parseAddition(): number {
    let val = parseMultiplication();
    while (peek() === "+" || peek() === "-") {
      const op = consume();
      const right = parseMultiplication();
      if (op === "+") val += right;
      else val -= right;
    }
    return val;
  }

  function parseMultiplication(): number {
    let val = parsePower();
    while (peek() === "*" || peek() === "/" || peek() === "%") {
      const op = consume();
      const right = parsePower();
      if (op === "*") {
        val *= right;
      } else if (op === "/") {
        if (right === 0) throw new Error("División por cero no permitida.");
        val /= right;
      } else if (op === "%") {
        if (right === 0) throw new Error("Módulo por cero no permitido.");
        val %= right;
      }
    }
    return val;
  }

  function parsePower(): number {
    let val = parseUnary();
    if (peek() === "^") {
      consume("^");
      const right = parsePower(); // Asociatividad a la derecha
      val = Math.pow(val, right);
    }
    return val;
  }

  function parseUnary(): number {
    if (peek() === "-") {
      consume("-");
      return -parseUnary();
    }
    if (peek() === "+") {
      consume("+");
      return parseUnary();
    }
    return parsePrimary();
  }

  function parsePrimary(): number {
    const token = peek();
    if (!token) {
      throw new Error("Fin inesperado de la expresión.");
    }

    // Paréntesis
    if (token === "(") {
      consume("(");
      const val = parseExpression();
      consume(")");
      return val;
    }

    // Constantes matemáticas conocidas
    if (token === "pi") {
      consume("pi");
      return Math.PI;
    }
    if (token === "e") {
      consume("e");
      return Math.E;
    }

    // Funciones matemáticas
    const knownFunctions = ["sqrt", "round", "floor", "ceil", "abs", "sin", "cos", "tan", "log", "min", "max"];
    if (knownFunctions.includes(token)) {
      const fnName = consume();
      consume("(");
      const args: number[] = [parseExpression()];
      while (peek() === ",") {
        consume(",");
        args.push(parseExpression());
      }
      consume(")");

      switch (fnName) {
        case "sqrt":
          if (args[0] < 0) throw new Error("Raíz cuadrada de número negativo no permitida.");
          return Math.sqrt(args[0]);
        case "round":
          return Math.round(args[0]);
        case "floor":
          return Math.floor(args[0]);
        case "ceil":
          return Math.ceil(args[0]);
        case "abs":
          return Math.abs(args[0]);
        case "sin":
          return Math.sin(args[0]);
        case "cos":
          return Math.cos(args[0]);
        case "tan":
          return Math.tan(args[0]);
        case "log":
          if (args[0] <= 0) throw new Error("Logaritmo de número no positivo no permitido.");
          return Math.log10(args[0]);
        case "min":
          return Math.min(...args);
        case "max":
          return Math.max(...args);
      }
    }

    // Número literal
    if (!isNaN(Number(token))) {
      consume();
      return Number(token);
    }

    throw new Error(`Símbolo o función no permitida en la calculadora: '${token}'`);
  }

  const result = parseExpression();

  if (pos < tokens.length) {
    throw new Error(`Tokens sobrantes sin procesar cerca de '${tokens[pos]}'`);
  }

  return result;
}

/**
 * Handler formal de la herramienta para el ToolRegistry.
 */
export async function calculatorToolHandler(
  params: Record<string, any>,
  _context: ToolExecutionContext
): Promise<{ result: CalculatorResult; metadata: Record<string, any> }> {
  const expression = params.expression || params.query || "";
  if (!expression || typeof expression !== "string") {
    throw new Error("Parámetro 'expression' requerido para la herramienta calculator.");
  }

  const numericResult = evaluateMathExpression(expression);

  return {
    result: {
      expression,
      result: numericResult,
      formatted: Number.isInteger(numericResult)
        ? numericResult.toLocaleString("es-ES")
        : numericResult.toLocaleString("es-ES", { maximumFractionDigits: 6 }),
    },
    metadata: {
      evaluatedAt: new Date().toISOString(),
      precision: "IEEE 754 float64",
    },
  };
}
