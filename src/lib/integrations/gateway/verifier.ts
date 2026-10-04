/**
 * NEXTEХ Integration Gateway — Protocolo Criptográfico HMAC-SHA256 (Fase 4.7.1)
 * Fórmula congelada a nivel de buffers binarios puros:
 * HMAC-SHA256(secretBuffer, Buffer.concat([Buffer.from(timestamp + ".", "utf8"), rawBodyBytes]))
 */

import { createHash, createHmac, timingSafeEqual } from "crypto";
import { HMACVerificationResult } from "../types";

export class GatewayVerifier {
  /**
   * Calcula el hash SHA-256 de los bytes exactos recibidos en el cuerpo HTTP.
   */
  public computePayloadHash(rawBodyBytes: Buffer): string {
    return createHash("sha256").update(rawBodyBytes).digest("hex").toLowerCase();
  }

  /**
   * Genera la firma HMAC-SHA256 según el protocolo formal congelado:
   * signedBuffer = Buffer.concat([Buffer.from(timestamp + ".", "utf8"), rawBodyBytes])
   * signature = HMAC-SHA256(secretBuffer, signedBuffer) (hexadecimal lowercase)
   */
  public computeSignature(secretHex: string, timestamp: string, rawBodyBytes: Buffer): string {
    const secretBuffer = Buffer.from(secretHex, "hex");
    const prefixBuffer = Buffer.from(`${timestamp}.`, "utf8");
    const signedBuffer = Buffer.concat([prefixBuffer, rawBodyBytes]);
    return createHmac("sha256", secretBuffer).update(signedBuffer).digest("hex").toLowerCase();
  }

  /**
   * Valida cabeceras, ventana de timestamp canónico y firma criptográfica en tiempo constante.
   */
  public verifyHMAC(params: {
    secretHex: string;
    timestampHeader: string | null;
    signatureHeader: string | null;
    eventIdHeader: string | null;
    rawBodyBytes: Buffer;
    replayWindowSeconds?: number;
    currentEpochSeconds?: number;
  }): HMACVerificationResult {
    const {
      secretHex,
      timestampHeader,
      signatureHeader,
      eventIdHeader,
      rawBodyBytes,
      replayWindowSeconds = 300,
      currentEpochSeconds = Math.floor(Date.now() / 1000),
    } = params;

    // 1. Validar presencia de cabeceras obligatorias
    if (!timestampHeader || !signatureHeader || !eventIdHeader) {
      return {
        valid: false,
        errorCode: "MISSING_HEADERS",
        errorMessage: "Faltan cabeceras requeridas: X-Nextex-Timestamp, X-Nextex-Signature o X-Nextex-Event-Id.",
      };
    }

    const trimmedTimestamp = timestampHeader.trim();

    // 2. Validar formato canónico estricto de Timestamp (exactamente 10 dígitos decimales)
    if (!/^\d{10}$/.test(trimmedTimestamp)) {
      return {
        valid: false,
        errorCode: "INVALID_TIMESTAMP",
        errorMessage: "Cabecera X-Nextex-Timestamp inválida (se requiere formato Unix epoch seconds de 10 dígitos).",
      };
    }

    const timestampSeconds = parseInt(trimmedTimestamp, 10);

    // 3. Validar ventana temporal (Timestamp Skew)
    const skew = Math.abs(currentEpochSeconds - timestampSeconds);
    if (skew > replayWindowSeconds) {
      return {
        valid: false,
        errorCode: "TIMESTAMP_OUT_OF_WINDOW",
        errorMessage: `Timestamp fuera de la ventana de validez permitida (${skew}s > ${replayWindowSeconds}s).`,
      };
    }

    // 4. Calcular firma esperada con buffers binarios puros
    const payloadHash = this.computePayloadHash(rawBodyBytes);
    const expectedSignature = this.computeSignature(secretHex, trimmedTimestamp, rawBodyBytes);
    const candidateSignature = signatureHeader.trim().toLowerCase();

    // 5. Comparación en tiempo constante (timingSafeEqual)
    try {
      const expectedBuf = Buffer.from(expectedSignature, "utf8");
      const candidateBuf = Buffer.from(candidateSignature, "utf8");

      if (expectedBuf.length !== candidateBuf.length) {
        return {
          valid: false,
          errorCode: "INVALID_SIGNATURE",
          errorMessage: "Longitud de firma inválida.",
          payloadHash,
        };
      }

      const match = timingSafeEqual(expectedBuf, candidateBuf);
      if (!match) {
        return {
          valid: false,
          errorCode: "INVALID_SIGNATURE",
          errorMessage: "Firma criptográfica inválida para el cuerpo binario y timestamp proporcionados.",
          payloadHash,
        };
      }

      return {
        valid: true,
        payloadHash,
        signedPayload: `${trimmedTimestamp}.<binary_body_${rawBodyBytes.length}_bytes>`,
      };
    } catch {
      return {
        valid: false,
        errorCode: "INVALID_SIGNATURE",
        errorMessage: "Fallo durante la evaluación criptográfica de la firma.",
        payloadHash,
      };
    }
  }
}

export const defaultGatewayVerifier = new GatewayVerifier();
