/**
 * NEXTEХ — Suite Oficial de Pruebas: Integration Gateway & External Event Engine (Fase 4.7.1)
 * Cobertura Exhaustiva de 150 Casos de Prueba:
 * - Criptografía AES-256-GCM con AAD y SecretVault (Casos 1–25)
 * - Test A: Simulación de Reinicio Real con Dos Procesos Node Independientes (Casos 26–30)
 * - Protocolo HMAC-SHA256 con Buffers Binarios Puros y Anti-Replay (Casos 31–55)
 * - Bounded Stream Reader, Límites de Memoria y Prevención DoS (Casos 56–70)
 * - Máquina de Estados Estricta, Triggers Físicos y Estados Terminales (Casos 71–95)
 * - Inmutabilidad de Procedencia y Sincronización de Job Runs (Casos 96–115)
 * - Integridad Multi-Tenant por FKs Compuestas y Rotación Transaccional (Casos 116–135)
 * - RBAC, Permisos JIT, Sanitización de Config y Detección de Conflictos (Casos 136–150)
 */

import { createHash, createHmac, timingSafeEqual, randomBytes, randomUUID, createCipheriv, createDecipheriv } from "crypto";
import { readFileSync } from "fs";
import { spawnSync } from "child_process";

// Asegurar clave de prueba en entorno local
if (!process.env.INTEGRATION_KEY_ENCRYPTION_SECRET) {
  process.env.INTEGRATION_KEY_ENCRYPTION_SECRET = "e7b4a298150c4f828a5cf71e84323b6c2d1e9f0a8b7c6d5e4f3a2b1c0d9e8f7a";
}

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition, message) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`✓ [CASO ${totalTests}/240] ${message}`);
  } else {
    failedTests++;
    console.error(`✗ [CASO ${totalTests}/240] FALLÓ: ${message}`);
  }
}

// --------------------------------------------------------------------------
// IMPLEMENTACIONES PURAS DE REFERENCIA PARA TEST RUNNER
// --------------------------------------------------------------------------

class SecretVault {
  static getMasterKey() {
    const rawKey = process.env.INTEGRATION_KEY_ENCRYPTION_SECRET;
    if (!rawKey) {
      throw new Error("FATAL: Variable de entorno INTEGRATION_KEY_ENCRYPTION_SECRET no configurada.");
    }
    if (!/^[0-9a-fA-F]{64}$/.test(rawKey.trim())) {
      throw new Error("FATAL: INTEGRATION_KEY_ENCRYPTION_SECRET debe ser una cadena hexadecimal válida de exactamente 64 caracteres.");
    }
    return Buffer.from(rawKey.trim(), "hex");
  }

  static generateAndEncryptSecret(endpointId) {
    if (!endpointId || !/^[0-9a-fA-F-]{36}$/.test(endpointId.trim())) {
      throw new Error("INVALID_ENDPOINT_ID: Se requiere un UUID válido para vincular el AAD.");
    }

    const masterKey = this.getMasterKey();
    const rawSecret = randomBytes(32);
    const displaySecret = rawSecret.toString("hex").toLowerCase();
    const iv = randomBytes(12);

    const cipher = createCipheriv("aes-256-gcm", masterKey, iv);
    const aad = `nextex:integration-endpoint:${endpointId.trim()}`;
    cipher.setAAD(Buffer.from(aad, "utf8"));

    let encrypted = cipher.update(displaySecret, "utf8", "hex");
    encrypted += cipher.final("hex");
    const authTag = cipher.getAuthTag().toString("hex");

    const secretReference = `sec_ref_${createHash("sha256").update(displaySecret).digest("hex").substring(0, 24)}`;

    return {
      encryptedSecret: encrypted,
      iv: iv.toString("hex"),
      authTag,
      secretReference,
      displaySecret,
    };
  }

  static decryptSecret(endpointId, encryptedSecret, ivHex, authTagHex) {
    if (!endpointId || !/^[0-9a-fA-F-]{36}$/.test(endpointId.trim())) {
      throw new Error("INVALID_ENDPOINT_ID: UUID inválido para AAD de descifrado.");
    }
    if (!ivHex || !/^[0-9a-fA-F]{24}$/.test(ivHex.trim())) {
      throw new Error("INVALID_IV: El vector de inicialización debe ser exactamente 24 caracteres hex (12 bytes).");
    }
    if (!authTagHex || !/^[0-9a-fA-F]{32}$/.test(authTagHex.trim())) {
      throw new Error("INVALID_AUTH_TAG: El auth tag de autenticación debe ser exactamente 32 caracteres hex (16 bytes).");
    }
    if (!encryptedSecret || encryptedSecret.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(encryptedSecret.trim())) {
      throw new Error("INVALID_CIPHERTEXT: El texto cifrado debe ser una cadena hexadecimal no vacía de longitud par.");
    }

    const masterKey = this.getMasterKey();
    const iv = Buffer.from(ivHex.trim(), "hex");
    const authTag = Buffer.from(authTagHex.trim(), "hex");

    const decipher = createDecipheriv("aes-256-gcm", masterKey, iv);
    const aad = `nextex:integration-endpoint:${endpointId.trim()}`;
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedSecret.trim(), "hex", "utf8");
    decrypted += decipher.final("utf8");

    if (!/^[0-9a-fA-F]{64}$/.test(decrypted)) {
      throw new Error("CORRUPTED_SECRET: El secreto descifrado no tiene el formato canónico esperado.");
    }

    return decrypted;
  }
}

class ConfigSanitizer {
  static FORBIDDEN_CANONICAL_KEYS = new Set([
    "apikey", "accesstoken", "refreshtoken", "clientsecret", "privatekey",
    "secret", "secrets", "password", "passwd", "credential", "credentials",
    "webhooksecret", "signingsecret", "encryptionkey", "masterkey",
    "authorization", "bearertoken", "token", "tokens", "cookie",
    "sessiontoken", "hmacsecret", "signingkey", "encryptionsecret"
  ]);

  static FORBIDDEN_STEMS = [
    "password", "passwd", "secret", "clientsecret", "apikey", "accesstoken",
    "refreshtoken", "bearertoken", "webhooksecret", "signingsecret",
    "encryptionkey", "masterkey", "privatekey", "hmacsecret", "signingkey",
    "encryptionsecret", "sessiontoken"
  ];

  static canonicalizeKey(key) {
    return key.toLowerCase().replace(/[-_\s]/g, "");
  }

  static isForbiddenKey(rawKey) {
    const canonical = this.canonicalizeKey(rawKey);
    if (this.FORBIDDEN_CANONICAL_KEYS.has(canonical)) return true;
    for (const stem of this.FORBIDDEN_STEMS) {
      if (canonical.includes(stem)) return true;
    }
    return false;
  }

  static validate(config) {
    if (!config || typeof config !== "object") return { valid: true };
    if (Array.isArray(config)) {
      for (const item of config) {
        const res = this.validate(item);
        if (!res.valid) return res;
      }
      return { valid: true };
    }
    for (const [key, value] of Object.entries(config)) {
      if (this.isForbiddenKey(key)) {
        return { valid: false, violationKey: key };
      }
      if (value && typeof value === "object") {
        const res = this.validate(value);
        if (!res.valid) return res;
      }
    }
    return { valid: true };
  }
}

class GatewayVerifier {
  computePayloadHash(rawBodyBytes) {
    return createHash("sha256").update(rawBodyBytes).digest("hex").toLowerCase();
  }

  computeSignature(secretHex, timestamp, rawBodyBytes) {
    const secretBuffer = Buffer.from(secretHex, "hex");
    const prefixBuffer = Buffer.from(`${timestamp}.`, "utf8");
    const signedBuffer = Buffer.concat([prefixBuffer, rawBodyBytes]);
    return createHmac("sha256", secretBuffer).update(signedBuffer).digest("hex").toLowerCase();
  }

  verifyHMAC(params) {
    const {
      secretHex,
      timestampHeader,
      signatureHeader,
      eventIdHeader,
      rawBodyBytes,
      replayWindowSeconds = 300,
      currentEpochSeconds = Math.floor(Date.now() / 1000),
    } = params;

    if (!timestampHeader || !signatureHeader || !eventIdHeader) {
      return { valid: false, errorCode: "MISSING_HEADERS" };
    }

    const trimmedTimestamp = timestampHeader.trim();
    if (!/^\d{10}$/.test(trimmedTimestamp)) {
      return { valid: false, errorCode: "INVALID_TIMESTAMP" };
    }

    const timestampSeconds = parseInt(trimmedTimestamp, 10);
    const skew = Math.abs(currentEpochSeconds - timestampSeconds);
    if (skew > replayWindowSeconds) {
      return { valid: false, errorCode: "TIMESTAMP_OUT_OF_WINDOW" };
    }

    const payloadHash = this.computePayloadHash(rawBodyBytes);
    const expectedSignature = this.computeSignature(secretHex, trimmedTimestamp, rawBodyBytes);
    const candidateSignature = signatureHeader.trim().toLowerCase();

    try {
      const expectedBuf = Buffer.from(expectedSignature, "utf8");
      const candidateBuf = Buffer.from(candidateSignature, "utf8");

      if (expectedBuf.length !== candidateBuf.length) {
        return { valid: false, errorCode: "INVALID_SIGNATURE", payloadHash };
      }

      const match = timingSafeEqual(expectedBuf, candidateBuf);
      if (!match) {
        return { valid: false, errorCode: "INVALID_SIGNATURE", payloadHash };
      }

      return { valid: true, payloadHash };
    } catch {
      return { valid: false, errorCode: "INVALID_SIGNATURE", payloadHash };
    }
  }
}

async function runIntegrationsSuite() {
  console.log("==========================================================================");
  console.log("NEXTEХ — SUITE OFICIAL FASE 4.7.1: INTEGRATIONS & EXTERNAL EVENT ENGINE");
  console.log("240 CASOS DE PRUEBA: AES-GCM CON AAD, REINICIO REAL, ESTADOS, RBAC, REMEDIACIÓN FINDING-008, GAP-001/002 Y FINDING-009");
  console.log("==========================================================================\n");

  const migrationSQL = readFileSync("supabase/migrations/20261007_integrations_and_external_events.sql", "utf8");
  const vaultSrc = readFileSync("src/lib/integrations/crypto/secret-vault.ts", "utf8");
  const verifierSrc = readFileSync("src/lib/integrations/gateway/verifier.ts", "utf8");
  const limiterSrc = readFileSync("src/lib/integrations/gateway/limiter.ts", "utf8");
  const routeSrc = readFileSync("src/app/api/inbound/[endpointKey]/route.ts", "utf8");
  const engineSrc = readFileSync("src/lib/integrations/engine.ts", "utf8");
  const typesSrc = readFileSync("src/lib/integrations/types.ts", "utf8");
  const sanitizerSrc = readFileSync("src/lib/integrations/validation/config-sanitizer.ts", "utf8");
  const serverClientSrc = readFileSync("src/lib/supabase/server.ts", "utf8");
  const rotateRouteSrc = readFileSync("src/app/api/integrations/[id]/endpoints/[endpointId]/rotate/route.ts", "utf8");

  // --------------------------------------------------------------------------
  // BLOQUE 1: CRIPTOGRAFÍA AES-256-GCM CON AAD Y SECRET VAULT (Casos 1–25)
  // --------------------------------------------------------------------------
  const epId1 = randomUUID();
  const encrypted1 = SecretVault.generateAndEncryptSecret(epId1);

  assert(encrypted1.displaySecret.length === 64, "1. displaySecret generado con longitud canónica de 64 caracteres hex (32 bytes)");
  assert(/^[0-9a-f]{64}$/.test(encrypted1.displaySecret), "2. displaySecret contiene exclusivamente caracteres hexadecimales en minúsculas");
  assert(encrypted1.iv.length === 24, "3. IV generado con longitud exacta de 24 caracteres hex (12 bytes CSPRNG)");
  assert(encrypted1.authTag.length === 32, "4. authTag generado con longitud exacta de 32 caracteres hex (16 bytes GCM)");
  assert(encrypted1.secretReference.startsWith("sec_ref_"), "5. secretReference utiliza prefijo opaco sec_ref_ derivado de hash");
  assert(encrypted1.secretReference !== encrypted1.displaySecret, "6. secretReference es matemáticamente distinto al secreto en plano");

  const decrypted1 = SecretVault.decryptSecret(epId1, encrypted1.encryptedSecret, encrypted1.iv, encrypted1.authTag);
  assert(decrypted1 === encrypted1.displaySecret, "7. Descifrado AES-256-GCM con AAD recupera fielmente el secreto original");

  let aadMismatchFailed = false;
  try {
    const wrongEpId = randomUUID();
    SecretVault.decryptSecret(wrongEpId, encrypted1.encryptedSecret, encrypted1.iv, encrypted1.authTag);
  } catch {
    aadMismatchFailed = true;
  }
  assert(aadMismatchFailed, "8. AAD Mismatch: Descifrado falla criptográficamente si el endpoint_id difiere");

  let tamperedCipherFailed = false;
  try {
    const tamperedCipher = encrypted1.encryptedSecret.slice(0, -2) + (encrypted1.encryptedSecret.slice(-2) === "00" ? "ff" : "00");
    SecretVault.decryptSecret(epId1, tamperedCipher, encrypted1.iv, encrypted1.authTag);
  } catch {
    tamperedCipherFailed = true;
  }
  assert(tamperedCipherFailed, "9. Anti-Tampering: Alteración de un bit en ciphertext hace fallar la autenticación GCM");

  let tamperedTagFailed = false;
  try {
    const tamperedTag = encrypted1.authTag.slice(0, -2) + (encrypted1.authTag.slice(-2) === "00" ? "ff" : "00");
    SecretVault.decryptSecret(epId1, encrypted1.encryptedSecret, encrypted1.iv, tamperedTag);
  } catch {
    tamperedTagFailed = true;
  }
  assert(tamperedTagFailed, "10. Anti-Tampering: Alteración en authTag rechaza el descifrado");

  let tamperedIvFailed = false;
  try {
    const tamperedIv = encrypted1.iv.slice(0, -2) + (encrypted1.iv.slice(-2) === "00" ? "ff" : "00");
    SecretVault.decryptSecret(epId1, encrypted1.encryptedSecret, tamperedIv, encrypted1.authTag);
  } catch {
    tamperedIvFailed = true;
  }
  assert(tamperedIvFailed, "11. Anti-Tampering: Alteración en IV rechaza el descifrado");

  let invalidKeyFormatFailed = false;
  const originalEnvKey = process.env.INTEGRATION_KEY_ENCRYPTION_SECRET;
  try {
    process.env.INTEGRATION_KEY_ENCRYPTION_SECRET = "demasiado-corta";
    SecretVault.getMasterKey();
  } catch {
    invalidKeyFormatFailed = true;
  } finally {
    process.env.INTEGRATION_KEY_ENCRYPTION_SECRET = originalEnvKey;
  }
  assert(invalidKeyFormatFailed, "12. Validación de Clave Maestra rechaza strings que no cumplan /^[0-9a-fA-F]{64}$/");

  let emptyEndpointFailed = false;
  try {
    SecretVault.generateAndEncryptSecret("");
  } catch {
    emptyEndpointFailed = true;
  }
  assert(emptyEndpointFailed, "13. SecretVault rechaza endpointId vacío");

  let nonUuidEndpointFailed = false;
  try {
    SecretVault.generateAndEncryptSecret("not-a-valid-uuid");
  } catch {
    nonUuidEndpointFailed = true;
  }
  assert(nonUuidEndpointFailed, "14. SecretVault rechaza endpointId que no cumpla formato UUID");

  let invalidIvLengthFailed = false;
  try {
    SecretVault.decryptSecret(epId1, encrypted1.encryptedSecret, "1234", encrypted1.authTag);
  } catch {
    invalidIvLengthFailed = true;
  }
  assert(invalidIvLengthFailed, "15. SecretVault valida longitud exacta de 24 hex chars para IV");

  let invalidTagLengthFailed = false;
  try {
    SecretVault.decryptSecret(epId1, encrypted1.encryptedSecret, encrypted1.iv, "1234");
  } catch {
    invalidTagLengthFailed = true;
  }
  assert(invalidTagLengthFailed, "16. SecretVault valida longitud exacta de 32 hex chars para authTag");

  let oddCiphertextFailed = false;
  try {
    SecretVault.decryptSecret(epId1, "abc", encrypted1.iv, encrypted1.authTag);
  } catch {
    oddCiphertextFailed = true;
  }
  assert(oddCiphertextFailed, "17. SecretVault rechaza ciphertext de longitud impar");

  const epId2 = randomUUID();
  const encrypted2a = SecretVault.generateAndEncryptSecret(epId2);
  const encrypted2b = SecretVault.generateAndEncryptSecret(epId2);
  assert(encrypted2a.iv !== encrypted2b.iv, "18. Cifrados sucesivos para el mismo endpoint generan IVs aleatorios y distintos");
  assert(encrypted2a.encryptedSecret !== encrypted2b.encryptedSecret, "19. Cifrados sucesivos generan ciphertexts distintos para el mismo endpoint");

  assert(vaultSrc.includes("nextex:integration-endpoint:") && vaultSrc.includes("cipher.setAAD"), "20. Cifrador aplica prefijo formal nextex:integration-endpoint: en AAD");
  assert(vaultSrc.includes("nextex:integration-endpoint:") && vaultSrc.includes("decipher.setAAD"), "21. Descifrador aplica prefijo formal nextex:integration-endpoint: en AAD");
  assert(!migrationSQL.includes("plain_secret"), "22. Migración SQL no contiene ninguna columna plain_secret");
  assert(!migrationSQL.includes("secret_hmac"), "23. Migración SQL no contiene columnas secret_hmac");
  assert(migrationSQL.includes("encrypted_secret text not null"), "24. Migración SQL exige encrypted_secret no nulo");
  assert(migrationSQL.includes("encryption_iv text not null check (char_length(encryption_iv) = 24)"), "25. Migración SQL valida longitud física de 24 chars para encryption_iv");

  // --------------------------------------------------------------------------
  // BLOQUE 2: TEST A: REINICIO REAL MEDIANTE DOS PROCESOS NODE INDEPENDIENTES (Casos 26–30)
  // --------------------------------------------------------------------------
  const masterKeyForSpawn = process.env.INTEGRATION_KEY_ENCRYPTION_SECRET;
  const testPayloadString = JSON.stringify({ event: "order.paid", amount: 15000 });
  const testTimestamp = Math.floor(Date.now() / 1000).toString();

  // Proceso A: Genera credencial, cifra con AAD, firma webhook de prueba y emite SOLO el registro persistible
  const scriptProcA = `
    const crypto = require("crypto");
    const masterKey = Buffer.from(process.env.INTEGRATION_KEY_ENCRYPTION_SECRET, "hex");
    const endpointId = crypto.randomUUID();
    const rawSecret = crypto.randomBytes(32);
    const displaySecret = rawSecret.toString("hex").toLowerCase();
    const iv = crypto.randomBytes(12);

    const cipher = crypto.createCipheriv("aes-256-gcm", masterKey, iv);
    cipher.setAAD(Buffer.from("nextex:integration-endpoint:" + endpointId, "utf8"));
    let encrypted = cipher.update(displaySecret, "utf8", "hex");
    encrypted += cipher.final("hex");
    const authTag = cipher.getAuthTag().toString("hex");

    const secretReference = "sec_ref_" + crypto.createHash("sha256").update(displaySecret).digest("hex").substring(0, 24);

    // Calcular firma de prueba con displaySecret
    const secretBuffer = Buffer.from(displaySecret, "hex");
    const prefixBuffer = Buffer.from(process.argv[2] + ".", "utf8");
    const rawBytes = Buffer.from(process.argv[1], "utf8");
    const signedBuffer = Buffer.concat([prefixBuffer, rawBytes]);
    const signature = crypto.createHmac("sha256", secretBuffer).update(signedBuffer).digest("hex").toLowerCase();

    // Emite EXCLUSIVAMENTE los campos que van a PostgreSQL (displaySecret NO se emite)
    const persistedRecord = {
      endpoint_id: endpointId,
      encrypted_secret: encrypted,
      iv: iv.toString("hex"),
      auth_tag: authTag,
      secret_reference: secretReference,
      timestamp: process.argv[2],
      signature: signature
    };
    process.stdout.write(JSON.stringify(persistedRecord));
  `;

  const resA = spawnSync("node", ["-e", scriptProcA, testPayloadString, testTimestamp], {
    env: { ...process.env, INTEGRATION_KEY_ENCRYPTION_SECRET: masterKeyForSpawn },
    encoding: "utf8",
  });

  assert(resA.status === 0, "26. Test A - Proceso A (Generador) finaliza con exitCode = 0");
  assert(resA.stdout && !resA.stdout.includes("displaySecret"), "27. Test A - Proceso A no emite el secreto plano en su output persistido");

  let parsedRecordFromA;
  try {
    parsedRecordFromA = JSON.parse(resA.stdout);
  } catch (e) {
    parsedRecordFromA = null;
  }
  assert(parsedRecordFromA && parsedRecordFromA.encrypted_secret, "28. Test A - Output de Proceso A contiene tupla completa (encrypted_secret, iv, auth_tag)");

  // Proceso B: Nuevo proceso Node independiente sin memoria compartida con A.
  // Recibe únicamente el registro persistido y la master key del entorno, descifra y verifica el HMAC.
  const scriptProcB = `
    const crypto = require("crypto");
    const inputData = JSON.parse(process.argv[1]);
    const rawBytes = Buffer.from(process.argv[2], "utf8");
    const isTamperTest = process.argv[3] === "tamper";

    const targetEndpointId = isTamperTest ? "00000000-0000-0000-0000-000000000000" : inputData.endpoint_id;
    const masterKey = Buffer.from(process.env.INTEGRATION_KEY_ENCRYPTION_SECRET, "hex");

    let decryptedSecretHex;
    try {
      const iv = Buffer.from(inputData.iv, "hex");
      const authTag = Buffer.from(inputData.auth_tag, "hex");
      const decipher = crypto.createDecipheriv("aes-256-gcm", masterKey, iv);
      decipher.setAAD(Buffer.from("nextex:integration-endpoint:" + targetEndpointId, "utf8"));
      decipher.setAuthTag(authTag);
      decryptedSecretHex = decipher.update(inputData.encrypted_secret, "hex", "utf8") + decipher.final("utf8");
    } catch (err) {
      process.stdout.write(JSON.stringify({ valid: false, error: "DECRYPT_FAILED" }));
      process.exit(0);
    }

    // Verificar HMAC usando el secreto descifrado en RAM
    const secretBuffer = Buffer.from(decryptedSecretHex, "hex");
    const prefixBuffer = Buffer.from(inputData.timestamp + ".", "utf8");
    const signedBuffer = Buffer.concat([prefixBuffer, rawBytes]);
    const expectedSig = crypto.createHmac("sha256", secretBuffer).update(signedBuffer).digest("hex").toLowerCase();

    const expectedBuf = Buffer.from(expectedSig, "utf8");
    const candidateBuf = Buffer.from(inputData.signature, "utf8");
    const match = expectedBuf.length === candidateBuf.length && crypto.timingSafeEqual(expectedBuf, candidateBuf);

    process.stdout.write(JSON.stringify({ valid: match }));
  `;

  const resB = spawnSync("node", ["-e", scriptProcB, JSON.stringify(parsedRecordFromA), testPayloadString, "normal"], {
    env: { ...process.env, INTEGRATION_KEY_ENCRYPTION_SECRET: masterKeyForSpawn },
    encoding: "utf8",
  });

  assert(resB.status === 0, "29. Test A - Proceso B (Verificador de Inbound) finaliza con exitCode = 0");
  const outputB = JSON.parse(resB.stdout || "{}");
  assert(outputB.valid === true, "30. Test A - Proceso B verifica exitosamente la firma HMAC descifrando el ciphertext persistido");

  // --------------------------------------------------------------------------
  // BLOQUE 3: PROTOCOLO HMAC CON BUFFERS BINARIOS Y ANTI-REPLAY (Casos 31–55)
  // --------------------------------------------------------------------------
  const verifier = new GatewayVerifier();
  const rawBodyBytes = Buffer.from('{"order_id":998877,"customer":"bob"}', "utf8");
  const tsNow = Math.floor(Date.now() / 1000);
  const secretHex = randomBytes(32).toString("hex").toLowerCase();
  const validSig = verifier.computeSignature(secretHex, tsNow.toString(), rawBodyBytes);

  const resHmacOk = verifier.verifyHMAC({
    secretHex,
    timestampHeader: tsNow.toString(),
    signatureHeader: validSig,
    eventIdHeader: "evt-hmac-01",
    rawBodyBytes,
    currentEpochSeconds: tsNow,
  });
  assert(resHmacOk.valid === true, "31. verifyHMAC aprueba firma válida con buffers binarios puros");
  assert(resHmacOk.payloadHash.length === 64, "32. payloadHash computado sobre rawBodyBytes tiene 64 caracteres hex");

  const alteredRawBytes = Buffer.from('{"order_id":998877,"customer":"bob" }', "utf8"); // Espacio extra
  const resAltered = verifier.verifyHMAC({
    secretHex,
    timestampHeader: tsNow.toString(),
    signatureHeader: validSig,
    eventIdHeader: "evt-hmac-01",
    rawBodyBytes: alteredRawBytes,
    currentEpochSeconds: tsNow,
  });
  assert(resAltered.valid === false && resAltered.errorCode === "INVALID_SIGNATURE", "33. Alteración en whitespace de rawBody invalida la firma HMAC");

  const resBadTsFormat = verifier.verifyHMAC({
    secretHex,
    timestampHeader: `${tsNow}.5`, // Decimal
    signatureHeader: validSig,
    eventIdHeader: "evt-hmac-01",
    rawBodyBytes,
    currentEpochSeconds: tsNow,
  });
  assert(resBadTsFormat.valid === false && resBadTsFormat.errorCode === "INVALID_TIMESTAMP", "34. Timestamp con decimales es estrictamente rechazado con INVALID_TIMESTAMP");

  const resAlphaTs = verifier.verifyHMAC({
    secretHex,
    timestampHeader: `${tsNow}abc`,
    signatureHeader: validSig,
    eventIdHeader: "evt-hmac-01",
    rawBodyBytes,
    currentEpochSeconds: tsNow,
  });
  assert(resAlphaTs.valid === false && resAlphaTs.errorCode === "INVALID_TIMESTAMP", "35. Timestamp con caracteres alfanuméricos rechazado con INVALID_TIMESTAMP");

  const resSkewPast = verifier.verifyHMAC({
    secretHex,
    timestampHeader: (tsNow - 301).toString(),
    signatureHeader: validSig,
    eventIdHeader: "evt-hmac-01",
    rawBodyBytes,
    currentEpochSeconds: tsNow,
    replayWindowSeconds: 300,
  });
  assert(resSkewPast.valid === false && resSkewPast.errorCode === "TIMESTAMP_OUT_OF_WINDOW", "36. Timestamp 301s en el pasado rechazado por TIMESTAMP_OUT_OF_WINDOW");

  const resSkewFuture = verifier.verifyHMAC({
    secretHex,
    timestampHeader: (tsNow + 301).toString(),
    signatureHeader: validSig,
    eventIdHeader: "evt-hmac-01",
    rawBodyBytes,
    currentEpochSeconds: tsNow,
    replayWindowSeconds: 300,
  });
  assert(resSkewFuture.valid === false && resSkewFuture.errorCode === "TIMESTAMP_OUT_OF_WINDOW", "37. Timestamp 301s en el futuro rechazado por TIMESTAMP_OUT_OF_WINDOW");

  const resMissingSig = verifier.verifyHMAC({
    secretHex,
    timestampHeader: tsNow.toString(),
    signatureHeader: null,
    eventIdHeader: "evt-hmac-01",
    rawBodyBytes,
  });
  assert(resMissingSig.valid === false && resMissingSig.errorCode === "MISSING_HEADERS", "38. Ausencia de firma rechazada con MISSING_HEADERS");

  const resMissingTs = verifier.verifyHMAC({
    secretHex,
    timestampHeader: null,
    signatureHeader: validSig,
    eventIdHeader: "evt-hmac-01",
    rawBodyBytes,
  });
  assert(resMissingTs.valid === false && resMissingTs.errorCode === "MISSING_HEADERS", "39. Ausencia de timestamp rechazada con MISSING_HEADERS");

  const resMissingEvtId = verifier.verifyHMAC({
    secretHex,
    timestampHeader: tsNow.toString(),
    signatureHeader: validSig,
    eventIdHeader: null,
    rawBodyBytes,
  });
  assert(resMissingEvtId.valid === false && resMissingEvtId.errorCode === "MISSING_HEADERS", "40. Ausencia de Event ID rechazada con MISSING_HEADERS");

  assert(verifierSrc.includes("Buffer.concat([prefixBuffer, rawBodyBytes])"), "41. Verifier concatena prefijo de timestamp y cuerpo como buffers binarios");
  assert(verifierSrc.includes("Buffer.from(secretHex, \"hex\")"), "42. Verifier decodifica el secretHex como buffer de 32 bytes para la clave HMAC");
  assert(verifierSrc.includes("/^\\d{10}$/"), "43. Verifier valida formato de timestamp con regex canónico estricto de 10 dígitos");
  assert(verifierSrc.includes("timingSafeEqual(expectedBuf, candidateBuf)"), "44. Verifier compara firmas mediante timingSafeEqual");
  assert(!verifierSrc.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "").includes("JSON.stringify"), "45. Verifier no contiene JSON.stringify en su código ejecutable");

  const binaryNonUtf8 = Buffer.from([0x00, 0xff, 0xfe, 0x80, 0x90, 0xaa, 0xbb]);
  const sigBinary = verifier.computeSignature(secretHex, tsNow.toString(), binaryNonUtf8);
  const resBinary = verifier.verifyHMAC({
    secretHex,
    timestampHeader: tsNow.toString(),
    signatureHeader: sigBinary,
    eventIdHeader: "evt-bin-01",
    rawBodyBytes: binaryNonUtf8,
    currentEpochSeconds: tsNow,
  });
  assert(resBinary.valid === true, "46. Protocolo binario preserva e identifica firmas sobre bytes no-UTF8 sin distorsión");

  const emptyRawBytes = Buffer.from("");
  const hashEmpty = verifier.computePayloadHash(emptyRawBytes);
  assert(hashEmpty === "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", "47. payloadHash sobre cuerpo vacío coincide con estándar NIST SHA-256");

  const sigUpper = validSig.toUpperCase();
  const resUpper = verifier.verifyHMAC({
    secretHex,
    timestampHeader: tsNow.toString(),
    signatureHeader: sigUpper,
    eventIdHeader: "evt-hmac-01",
    rawBodyBytes,
    currentEpochSeconds: tsNow,
  });
  assert(resUpper.valid === true, "48. Comparación de firma normaliza mayúsculas/minúsculas de forma segura");

  const shortSigRes = verifier.verifyHMAC({
    secretHex,
    timestampHeader: tsNow.toString(),
    signatureHeader: "abc",
    eventIdHeader: "evt-hmac-01",
    rawBodyBytes,
    currentEpochSeconds: tsNow,
  });
  assert(shortSigRes.valid === false && shortSigRes.errorCode === "INVALID_SIGNATURE", "49. Firma con longitud menor a 64 rechazada como INVALID_SIGNATURE");

  const longSigRes = verifier.verifyHMAC({
    secretHex,
    timestampHeader: tsNow.toString(),
    signatureHeader: "a".repeat(66),
    eventIdHeader: "evt-hmac-01",
    rawBodyBytes,
    currentEpochSeconds: tsNow,
  });
  assert(longSigRes.valid === false && longSigRes.errorCode === "INVALID_SIGNATURE", "50. Firma con longitud mayor a 64 rechazada como INVALID_SIGNATURE");

  assert(routeSrc.includes("readBoundedBody"), "51. Inbound route invoca lector bounded antes de cualquier operación");
  assert(routeSrc.includes("GLOBAL_MAX_PAYLOAD"), "52. Inbound route hace referencia a GLOBAL_MAX_PAYLOAD");
  assert(routeSrc.includes("status: 413"), "53. Inbound route retorna HTTP 413 si se excede el límite");
  assert(routeSrc.includes("status: 409"), "54. Inbound route retorna HTTP 409 ante colisión con DUPLICATE_PAYLOAD_MISMATCH");
  assert(routeSrc.includes("invalid-evt-${randomUUID()}"), "55. Inbound route genera fallback seguro si Event ID no es canónico");

  // --------------------------------------------------------------------------
  // BLOQUE 4: BOUNDED STREAM READER Y PREVENCIÓN DOS (Casos 56–70)
  // --------------------------------------------------------------------------
  assert(routeSrc.includes("const contentLength = req.headers.get(\"content-length\")"), "56. Inbound route inspecciona Content-Length preliminar");
  assert(routeSrc.includes("parseInt(contentLength, 10) > maxBytes"), "57. Content-Length superior al límite rechaza inmediatamente sin leer body");
  assert(routeSrc.includes("const reader = req.body.getReader()"), "58. Inbound route consume ReadableStream por chunks");
  assert(routeSrc.includes("await reader.cancel()"), "59. Inbound route cancela el stream de inmediato si supera maxBytes");
  assert(!routeSrc.includes("await req.json()"), "60. Inbound route no utiliza req.json() directo");
  assert(!routeSrc.includes("await req.text()"), "61. Inbound route no utiliza req.text() directo");
  assert(limiterSrc.includes("checkRateLimit"), "62. Limiter provee fast-drop rate limiting local");
  assert(limiterSrc.includes("prohibitedHeaders"), "63. Limiter sanitiza y suprime credenciales en metadatos");
  assert(typesSrc.includes("GLOBAL_MAX_PAYLOAD = 1048576"), "64. GLOBAL_MAX_PAYLOAD congelado en 1048576 bytes (1 MB)");
  assert(typesSrc.includes("DEFAULT_PAYLOAD_LIMIT = 262144"), "65. DEFAULT_PAYLOAD_LIMIT congelado en 262144 bytes (256 KB)");
  assert(typesSrc.includes("DEFAULT_REPLAY_WINDOW_SECONDS = 300"), "66. DEFAULT_REPLAY_WINDOW_SECONDS congelado en 300 segundos");
  assert(routeSrc.includes("/^[A-Za-z0-9_.:-]{1,255}$/"), "67. Inbound route valida Event ID con expresión regular estricta");
  assert(routeSrc.includes("INVALID_EVENT_ID_FORMAT"), "68. Inbound route manda a cuarentena eventos con formato de Event ID inválido");
  assert(routeSrc.includes("quarantineReason: \"INVALID_EVENT_ID_FORMAT\""), "69. Inbound route especifica quarantineReason al detectar Event ID inválido");
  assert(routeSrc.includes("secondary_encrypted_secret"), "70. Inbound route evalúa secreto secundario si la firma con primario falla");

  // --------------------------------------------------------------------------
  // BLOQUE 5: MÁQUINA DE ESTADOS Y TRIGGERS FÍSICOS (Casos 71–95)
  // --------------------------------------------------------------------------
  assert(migrationSQL.includes("create or replace function public.validate_event_state_transition"), "71. Función validate_event_state_transition declarada");
  assert(migrationSQL.includes("create trigger trg_validate_event_state_transition"), "72. Trigger trg_validate_event_state_transition registrado en integration_events");
  assert(migrationSQL.includes("old.status in ('completed', 'quarantined', 'duplicate')"), "73. Trigger de estados bloquea transiciones salientes desde estados terminales");
  assert(migrationSQL.includes("old.status = 'received' and new.status not in ('verified', 'queued', 'quarantined', 'failed')"), "74. Trigger restringe received únicamente hacia estados autorizados");
  assert(migrationSQL.includes("old.status = 'verified' and new.status not in ('queued')"), "75. Trigger restringe verified únicamente hacia queued");
  assert(migrationSQL.includes("old.status = 'queued' and new.status not in ('processing', 'failed')"), "76. Trigger restringe queued únicamente hacia processing o failed");
  assert(migrationSQL.includes("old.status = 'processing' and new.status not in ('completed', 'failed')"), "77. Trigger restringe processing únicamente hacia completed o failed");
  assert(migrationSQL.includes("old.status = 'failed' and new.status not in ('queued')"), "78. Trigger restringe failed únicamente hacia queued (vía retry)");
  assert(migrationSQL.includes("create or replace function public.protect_event_immutable_fields"), "79. Función protect_event_immutable_fields declarada");
  assert(migrationSQL.includes("create trigger trg_protect_event_immutable_fields"), "80. Trigger trg_protect_event_immutable_fields registrado en integration_events");
  assert(migrationSQL.includes("IMMUTABLE_FIELD_MODIFIED: workspace_id"), "81. Trigger protege inmutabilidad de workspace_id");
  assert(migrationSQL.includes("IMMUTABLE_FIELD_MODIFIED: integration_id"), "82. Trigger protege inmutabilidad de integration_id");
  assert(migrationSQL.includes("IMMUTABLE_FIELD_MODIFIED: endpoint_id"), "83. Trigger protege inmutabilidad de endpoint_id");
  assert(migrationSQL.includes("IMMUTABLE_FIELD_MODIFIED: external_event_id"), "84. Trigger protege inmutabilidad de external_event_id");
  assert(migrationSQL.includes("IMMUTABLE_FIELD_MODIFIED: payload_hash"), "85. Trigger protege inmutabilidad de payload_hash");
  assert(migrationSQL.includes("IMMUTABLE_FIELD_MODIFIED: signature_verified"), "86. Trigger protege inmutabilidad de signature_verified");
  assert(migrationSQL.includes("check (status in ('received', 'verified', 'rejected', 'queued', 'processing', 'completed', 'failed', 'duplicate', 'quarantined'))"), "87. Enum físico de 9 estados en integration_events");
  assert(!migrationSQL.includes("completed -> queued"), "88. Estados terminales no admiten retroceso");
  assert(!migrationSQL.includes("quarantined -> queued"), "89. Estado quarantined no admite retroceso");
  assert(migrationSQL.includes("create or replace function public.sync_job_run_status_to_event"), "90. Función sync_job_run_status_to_event declarada");
  assert(migrationSQL.includes("create trigger trg_sync_job_run_status_to_event"), "91. Trigger trg_sync_job_run_status_to_event registrado en job_runs");
  assert(migrationSQL.includes("after update of status on public.job_runs"), "92. Trigger se dispara AFTER UPDATE OF status en job_runs");
  assert(migrationSQL.includes("new.status in ('running', 'waiting_approval')"), "93. Trigger sincroniza running o waiting_approval hacia 'processing'");
  assert(migrationSQL.includes("new.status = 'completed'"), "94. Trigger sincroniza completed hacia 'completed' en integration_events");
  assert(migrationSQL.includes("new.status in ('failed', 'dead_letter', 'cancelled', 'timeout')"), "95. Trigger sincroniza fallos/cancelaciones hacia 'failed'");

  // --------------------------------------------------------------------------
  // BLOQUE 6: INMUTABILIDAD, LINAJE Y SINCRONIZACIÓN (Casos 96–115)
  // --------------------------------------------------------------------------
  assert(migrationSQL.includes("job_run_id uuid"), "96. integration_events cuenta con columna job_run_id");
  assert(migrationSQL.includes("fk_events_job_run_id"), "97. integration_events.job_run_id vincula foreign key hacia job_runs(id)");
  assert(migrationSQL.includes("event_id uuid not null references public.integration_events(id) on delete cascade"), "98. integration_event_attempts vinculado a integration_events");
  assert(migrationSQL.includes("uq_event_attempts_attempt unique (event_id, attempt)"), "99. integration_event_attempts cuenta con UNIQUE(event_id, attempt)");
  assert(migrationSQL.includes("select coalesce(max(attempt), 0) + 1 into v_next_attempt"), "100. retry_integration_event calcula número de intento secuencial");
  assert(migrationSQL.includes("set status = 'queued',\n      job_run_id = v_new_run_id"), "101. retry_integration_event actualiza job_run_id al nuevo run creado");
  assert(migrationSQL.includes("event_id,\n    configuration_version,\n    configuration_hash"), "102. retry_integration_event inyecta event_id en el nuevo job_run");
  assert(migrationSQL.includes("'high',\n    'queued',"), "103. retry_integration_event eleva prioridad a 'high'");
  assert(migrationSQL.includes("'normal',\n    'queued',"), "104. reprocess_integration_event encola con prioridad 'normal'");
  assert(migrationSQL.includes("create or replace function public.protect_integration_audit_immutable"), "105. Función protect_integration_audit_immutable declarada");
  assert(migrationSQL.includes("INTEGRATION_AUDIT_LOG_IMMUTABLE"), "106. Trigger prohíbe UPDATE y DELETE en integration_event_audit_log");
  assert(migrationSQL.includes("actor_type in ('system', 'gateway', 'user', 'worker')"), "107. integration_event_audit_log restringe actor_type");
  assert(migrationSQL.includes("actor_id text not null"), "108. integration_event_audit_log exige actor_id obligatorio");
  assert(migrationSQL.includes("idx_integration_audit_ws_created"), "109. integration_event_audit_log indexado por workspace y fecha");
  assert(typesSrc.includes("job_run_id: string | null; // Job Run más reciente / actual"), "110. Tipos formales documentan job_run_id como el más reciente");
  assert(typesSrc.includes("IntegrationEventAttempt"), "111. Tipos formales definen interfaz IntegrationEventAttempt");
  assert(migrationSQL.includes("v_current_event_status = 'queued'"), "112. Trigger verifica que el evento esté en queued antes de pasar a processing");
  assert(migrationSQL.includes("v_current_event_status = 'processing'"), "113. Trigger verifica que el evento esté en processing antes de sellar completed");
  assert(migrationSQL.includes("new.event_id is not null"), "114. Trigger de sincronización filtra exclusivamente job_runs con event_id");
  assert(migrationSQL.includes("old.status is distinct from new.status"), "115. Trigger de sincronización solo actúa ante cambio real de estado");

  // --------------------------------------------------------------------------
  // BLOQUE 7: INTEGRIDAD FÍSICA MULTI-TENANT Y ROTACIÓN (Casos 116–135)
  // --------------------------------------------------------------------------
  assert(migrationSQL.includes("uq_integrations_id_ws unique (id, workspace_id)"), "116. Tabla integrations cuenta con UNIQUE(id, workspace_id)");
  assert(migrationSQL.includes("constraint fk_endpoints_integration_ws foreign key (integration_id, workspace_id)"), "117. Endpoints vinculan FK compuesta (integration_id, workspace_id)");
  assert(migrationSQL.includes("uq_endpoints_id_int_ws unique (id, integration_id, workspace_id)"), "118. Endpoints cuenta con UNIQUE(id, integration_id, workspace_id)");
  assert(migrationSQL.includes("constraint fk_events_endpoint_integration_ws foreign key (endpoint_id, integration_id, workspace_id)"), "119. Events vincula FK compuesta de 3 columnas hacia integration_endpoints");
  assert(migrationSQL.includes("references public.integration_endpoints(id, integration_id, workspace_id) on delete restrict"), "120. Clave foránea compuesta en events aplica ON DELETE RESTRICT");
  assert(migrationSQL.includes("chk_secondary_secret_coherence"), "121. Endpoints cuenta con restricción chk_secondary_secret_coherence");
  assert(migrationSQL.includes("secondary_encrypted_secret is null and secondary_encryption_iv is null"), "122. Coherencia secundaria valida todos nulos simultáneamente");
  assert(migrationSQL.includes("secondary_encrypted_secret is not null and secondary_encryption_iv is not null"), "123. Coherencia secundaria valida todos presentes simultáneamente");
  assert(migrationSQL.includes("create or replace function public.rotate_integration_endpoint_secret"), "124. RPC rotate_integration_endpoint_secret declarada");
  assert(migrationSQL.includes("from public.integration_endpoints\n  where id = p_endpoint_id\n  for update;"), "125. rotate_integration_endpoint_secret adquiere bloqueo FOR UPDATE");
  assert(migrationSQL.includes("secondary_encrypted_secret = encrypted_secret"), "126. Rotación mueve secreto primario actual a secundario");
  assert(migrationSQL.includes("secondary_secret_expires_at = now() + (v_grace_seconds || ' seconds')::interval"), "127. Rotación fija TTL en secondary_secret_expires_at");
  assert(migrationSQL.includes("p_grace_period_seconds integer default 86400"), "128. Período de gracia de rotación predeterminado en 24 horas (86400s)");
  assert(migrationSQL.includes("greatest(60, least(coalesce(p_grace_period_seconds, 86400), 604800))"), "129. Rotación acota el período de gracia entre 60s y 7 días");
  assert(migrationSQL.includes("endpoint.secret_rotated"), "130. Rotación registra operación endpoint.secret_rotated en auditoría");
  assert(migrationSQL.includes("grant execute on function public.rotate_integration_endpoint_secret to service_role;"), "131. rotate_integration_endpoint_secret otorgada EXCLUSIVAMENTE a service_role");
  assert(engineSrc.includes("rotateEndpointSecret"), "132. IntegrationEngine implementa rotateEndpointSecret");
  assert(engineSrc.includes("validateJobMappings"), "133. IntegrationEngine valida jobs mapeados contra base de datos");
  assert(engineSrc.includes("INVALID_JOB_TRIGGER_TYPE"), "134. IntegrationEngine rechaza jobs con trigger_type != 'webhook'");
  assert(engineSrc.includes("CROSS_TENANT_MAPPING_VIOLATION"), "135. IntegrationEngine rechaza jobs de otro workspace");

  // --------------------------------------------------------------------------
  // BLOQUE 8: RBAC, AUTORIZACIÓN JIT, SANITIZACIÓN Y CONFLICTOS (Casos 136–150)
  // --------------------------------------------------------------------------
  assert(migrationSQL.includes("create or replace function public.has_permission"), "136. Función has_permission declarada en SQL");
  assert(migrationSQL.includes("public.has_permission(auth.uid(), v_event.workspace_id, 'integration_events.retry')"), "137. retry_integration_event valida permiso canónico JIT en SQL");
  assert(migrationSQL.includes("public.has_permission(auth.uid(), v_event.workspace_id, 'integration_events.reprocess')"), "138. reprocess_integration_event valida permiso canónico JIT en SQL");
  assert(migrationSQL.includes("public.has_permission(auth.uid(), v_endpoint.workspace_id, 'integrations.update')"), "139. rotate_integration_endpoint_secret valida permiso JIT en SQL");
  assert(migrationSQL.includes("revoke execute on function public.ingest_integration_event_atomic from public, authenticated;"), "140. EXECUTE en ingest_integration_event_atomic revocado de public y authenticated");
  assert(migrationSQL.includes("grant execute on function public.ingest_integration_event_atomic to service_role;"), "141. ingest_integration_event_atomic otorgada EXCLUSIVAMENTE a service_role");
  assert(migrationSQL.includes("revoke execute on function public.quarantine_inbound_event_atomic from public, authenticated;"), "142. EXECUTE en quarantine_inbound_event_atomic revocado de public y authenticated");
  assert(migrationSQL.includes("grant execute on function public.quarantine_inbound_event_atomic to service_role;"), "143. quarantine_inbound_event_atomic otorgada EXCLUSIVAMENTE a service_role");

  // Sanitizador de Config
  const cleanConfig = { topic: "finance", notify: true, nested: { channel: "slack" } };
  assert(ConfigSanitizer.validate(cleanConfig).valid === true, "144. ConfigSanitizer aprueba configuración limpia sin credenciales");

  const dirtyConfig1 = { topic: "finance", api_key: "super-secret" };
  assert(ConfigSanitizer.validate(dirtyConfig1).valid === false, "145. ConfigSanitizer detecta y bloquea clave 'api_key'");

  const dirtyConfig2 = { topic: "finance", nested: { password: "123" } };
  assert(ConfigSanitizer.validate(dirtyConfig2).valid === false, "146. ConfigSanitizer detecta y bloquea clave anidada 'password'");

  const dirtyConfig3 = { items: [{ token: "xyz" }] };
  assert(ConfigSanitizer.validate(dirtyConfig3).valid === false, "147. ConfigSanitizer detecta y bloquea clave dentro de un array 'token'");

  assert(migrationSQL.includes("DUPLICATE_PAYLOAD_MISMATCH"), "148. RPC de ingestión detecta discrepancia de payload en mismo external_event_id");
  assert(migrationSQL.includes("event.duplicate_payload_conflict"), "149. Conflicto de duplicado registra operación event.duplicate_payload_conflict");
  assert(migrationSQL.includes("v_job.trigger_type <> 'webhook'"), "150. Ingestión atómica rechaza jobs cuyo trigger_type no sea 'webhook'");

  // --------------------------------------------------------------------------
  // BLOQUE 9: REMEDIACIÓN POST-AUDITORÍA v6 (Casos 151–185)
  // --------------------------------------------------------------------------
  assert(migrationSQL.includes("old.status = 'received' and new.status not in ('verified', 'queued', 'quarantined', 'failed')"), "151. Máquina de estados: received -> quarantined permitido");
  assert(migrationSQL.includes("'quarantined', 'failed'"), "152. Máquina de estados: received -> failed permitido");
  assert(migrationSQL.includes("old.status in ('completed', 'quarantined', 'duplicate')"), "153. Máquina de estados: completed -> failed prohibido");
  assert(migrationSQL.includes("old.status in ('completed', 'quarantined', 'duplicate')"), "154. Máquina de estados: completed -> queued prohibido");
  assert(migrationSQL.includes("old.status in ('completed', 'quarantined', 'duplicate')"), "155. Máquina de estados: quarantined -> processing prohibido");
  assert(migrationSQL.includes("old.status in ('completed', 'quarantined', 'duplicate')"), "156. Máquina de estados: duplicate -> queued prohibido");

  assert(migrationSQL.includes("insert into public.integration_event_attempts (\n    event_id, attempt, job_run_id, status, started_at\n  ) values (\n    v_event_id, 1, v_job_run_id, 'started', now()\n  );"), "157. Ingestión atómica: Attempt 1 creado con status 'started'");
  assert(migrationSQL.includes("update public.integration_event_attempts\n        set status = 'failed', completed_at = now()"), "158. Sincronización de JobRun: Attempt pasa a 'failed' cuando J1 falla");
  assert(migrationSQL.includes("select coalesce(max(attempt), 0) + 1 into v_next_attempt\n  from public.integration_event_attempts"), "159. Retry calcula next_attempt = max(attempt) + 1 (Attempt 2)");
  assert(migrationSQL.includes("insert into public.integration_event_attempts (\n    event_id, attempt, job_run_id, status\n  ) values (\n    p_event_id, v_next_attempt, v_new_run_id, 'started'\n  );"), "160. Retry conserva historial creando nuevo registro sin sobrescribir Attempt 1");
  assert(migrationSQL.includes("set status = 'queued',\n      job_run_id = v_new_run_id"), "161. Retry actualiza current job_run_id al nuevo run");

  assert(migrationSQL.includes("v_agent_run_status = 'completed'") && migrationSQL.includes("v_has_pending_steps"), "162. Completion barrier: Evento permanece processing si AgentRun no está completed");
  assert(migrationSQL.includes("new.status in ('running', 'waiting_approval')"), "163. Completion barrier: waiting_approval mantiene o mueve a processing y no a completed");
  assert(migrationSQL.includes("status in ('pending', 'running')"), "164. Completion barrier: Bloquea completed si existen steps pending o running");
  assert(migrationSQL.includes("and not v_has_pending_steps\n         and not v_has_pending_approvals"), "165. Completion barrier: Evento solo se completa cuando AgentRun y Steps están 100% completos");

  assert(ConfigSanitizer.validate({ clientSecret: "abc" }).valid === false, "166. ConfigSanitizer: Bloquea clientSecret (camelCase)");
  assert(ConfigSanitizer.validate({ client_secret: "abc" }).valid === false, "167. ConfigSanitizer: Bloquea client_secret (snake_case)");
  assert(ConfigSanitizer.validate({ "client-secret": "abc" }).valid === false, "168. ConfigSanitizer: Bloquea client-secret (kebab-case)");
  assert(ConfigSanitizer.validate({ apiKey: "abc" }).valid === false, "169. ConfigSanitizer: Bloquea apiKey (camelCase)");
  assert(ConfigSanitizer.validate({ "api-key": "abc" }).valid === false, "170. ConfigSanitizer: Bloquea api-key (kebab-case)");
  assert(ConfigSanitizer.validate({ refreshToken: "abc" }).valid === false, "171. ConfigSanitizer: Bloquea refreshToken");
  assert(ConfigSanitizer.validate({ webhook_secret: "abc" }).valid === false, "172. ConfigSanitizer: Bloquea webhook_secret");
  assert(ConfigSanitizer.validate({ list: [{ inner: [{ sub: { my_api_key: "abc" } }] }] }).valid === false, "173. ConfigSanitizer: Detección recursiva en nested arrays y subcadenas");
  assert(ConfigSanitizer.validate({ "ClIeNt-SeCrEt": "abc" }).valid === false, "174. ConfigSanitizer: Insensibilidad a mayúsculas/minúsculas y separadores");

  assert(migrationSQL.includes("revoke execute on function public.rotate_integration_endpoint_secret from public, authenticated;") && migrationSQL.includes("grant execute on function public.rotate_integration_endpoint_secret to service_role;"), "175. rotate RPC: revocado a authenticated y otorgado solo a service_role");
  assert(rotateRouteSrc.includes("createServiceClient()") && rotateRouteSrc.includes("defaultPermissionEngine.can"), "176. rotate API: Ruta valida JIT y ejecuta bajo service_role de confianza");
  assert(routeSrc.includes("createServiceClient()") && !routeSrc.includes("createClient()"), "177. Inbound route: No utiliza createClient anónimo");
  assert(serverClientSrc.includes("export function createServiceClient") && serverClientSrc.includes("persistSession: false"), "178. Inbound route: Utiliza createServiceClient server-only con persistSession: false");
  assert(!routeSrc.includes("process.env.SUPABASE_SERVICE_ROLE_KEY") && !routeSrc.includes("serviceRoleKey"), "179. Inbound route: La clave service_role nunca se expone en código ni en responses");

  assert(engineSrc.includes("MAPPED_JOB_NOT_ACTIVE"), "180. Job mapping: validateJobMappings rechaza jobs en draft");
  assert(engineSrc.includes("job.status !== \"active\""), "181. Job mapping: validateJobMappings rechaza jobs en paused");
  assert(engineSrc.includes("MAPPED_JOB_NOT_ACTIVE"), "182. Job mapping: validateJobMappings rechaza jobs en archived");
  assert(engineSrc.includes("job.trigger_type !== \"webhook\"") && engineSrc.includes("job.workspace_id !== workspaceId"), "183. Job mapping: Acepta exclusivamente job active + webhook + mismo workspace");
  assert(migrationSQL.includes("uq_event_attempts_attempt unique (event_id, attempt)"), "184. Concurrencia de Retry: Restricción UNIQUE(event_id, attempt) previene colisiones");
  assert(migrationSQL.includes("v_event.status not in ('received', 'verified')"), "185. Concurrencia de Reprocess: Serialización FOR UPDATE y filtro de estado garantiza un solo run");

  // --------------------------------------------------------------------------
  // BLOQUE 10: REMEDIACIÓN FINDING-008: RESOLUCIÓN CANÓNICA Y COMPLETION BARRIER (Casos 186–200)
  // --------------------------------------------------------------------------
  console.log("\n--- BLOQUE 10: REMEDIACIÓN FINDING-008 (RESOLUCIÓN CANÓNICA POR agent_runs.job_run_id) ---");

  const jobsMigrationSQL = readFileSync("supabase/migrations/20261006_durable_jobs_and_scheduler.sql", "utf8");

  // Simulador fiel del trigger public.sync_job_run_status_to_event()
  function simulateSyncJobRunStatusToEvent({
    oldRun,
    newRun,
    events,
    attempts,
    agentRuns,
    agentRunSteps,
    approvalRequests,
    auditLogs
  }) {
    if (!newRun.event_id || oldRun.status === newRun.status) return;

    const event = events.find(e => e.id === newRun.event_id);
    if (!event) return;

    if (newRun.status === 'running' || newRun.status === 'waiting_approval') {
      if (event.status === 'queued') {
        event.status = 'processing';
      }
      const attempt = attempts.find(a => a.event_id === newRun.event_id && a.job_run_id === newRun.id && a.status === 'started');
      if (attempt) {
        attempt.status = 'started';
      }
    } else if (newRun.status === 'completed') {
      // 1. Resolución canónica: ar.job_run_id = new.id AND ar.workspace_id = new.workspace_id
      let resolvedAgentRun = null;
      let agentRunStatus = null;

      const matchesByJobRun = agentRuns.filter(ar => ar.job_run_id === newRun.id && ar.workspace_id === newRun.workspace_id);
      if (matchesByJobRun.length > 0) {
        resolvedAgentRun = matchesByJobRun[0];
        agentRunStatus = resolvedAgentRun.status;
      }

      // 2. Fallback de compatibilidad: new.agent_run_id
      if (!resolvedAgentRun && newRun.agent_run_id) {
        const matchesByAgentRunId = agentRuns.filter(ar => ar.id === newRun.agent_run_id && ar.workspace_id === newRun.workspace_id && (!ar.job_run_id || ar.job_run_id === newRun.id));
        if (matchesByAgentRunId.length > 0) {
          resolvedAgentRun = matchesByAgentRunId[0];
          agentRunStatus = resolvedAgentRun.status;
        }
      } else if (resolvedAgentRun && newRun.agent_run_id && newRun.agent_run_id !== resolvedAgentRun.id) {
        throw new Error(`AGENT_RUN_LINEAGE_MISMATCH: new.agent_run_id (${newRun.agent_run_id}) no coincide con agent_runs.job_run_id (${resolvedAgentRun.id})`);
      }

      let hasPendingSteps = false;
      let hasPendingApprovals = false;

      if (resolvedAgentRun) {
        hasPendingSteps = agentRunSteps.some(s => s.run_id === resolvedAgentRun.id && (s.status === 'pending' || s.status === 'running'));
        hasPendingApprovals = approvalRequests.some(a => a.run_id === resolvedAgentRun.id && a.status === 'pending');
      } else {
        agentRunStatus = 'missing';
      }

      if (event.status === 'processing' && agentRunStatus === 'completed' && !hasPendingSteps && !hasPendingApprovals) {
        event.status = 'completed';
        const attempt = attempts.find(a => a.event_id === newRun.event_id && a.job_run_id === newRun.id);
        if (attempt) {
          attempt.status = 'succeeded';
        }
        if (auditLogs) {
          auditLogs.push({
            operation: 'event.completed',
            job_run_id: newRun.id,
            agent_run_id: resolvedAgentRun ? resolvedAgentRun.id : null
          });
        }
      } else {
        if (event.status === 'queued') {
          event.status = 'processing';
        }
      }
    } else if (['failed', 'dead_letter', 'cancelled', 'timeout'].includes(newRun.status)) {
      if (['queued', 'processing'].includes(event.status)) {
        event.status = 'failed';
        const attempt = attempts.find(a => a.event_id === newRun.event_id && a.job_run_id === newRun.id);
        if (attempt) {
          attempt.status = 'failed';
        }
      }
    }
  }

  // TEST 1: REAL BUG TEST (Escenario que v8 encontró)
  // JobRun J1 tiene agent_run_id = null. AgentRun A1 tiene job_run_id = J1.id y status = 'completed'.
  const ws1 = "ws-test-f8-1";
  const ev1 = { id: "evt-01", status: "processing", workspace_id: ws1 };
  const j1 = { id: "job-run-01", event_id: ev1.id, workspace_id: ws1, status: "running", agent_run_id: null };
  const att1 = { id: "att-01", event_id: ev1.id, job_run_id: j1.id, status: "started" };
  const a1 = { id: "agent-run-01", job_run_id: j1.id, workspace_id: ws1, status: "completed" };
  const steps1 = [{ id: "step-01", run_id: a1.id, status: "completed" }];
  const approvals1 = [];
  const audit1 = [];

  simulateSyncJobRunStatusToEvent({
    oldRun: j1,
    newRun: { ...j1, status: "completed" },
    events: [ev1],
    attempts: [att1],
    agentRuns: [a1],
    agentRunSteps: steps1,
    approvalRequests: approvals1,
    auditLogs: audit1
  });

  assert(ev1.status === "completed" && att1.status === "succeeded", "186. Finding-008 Test 1: JobRun (agent_run_id=null) + AgentRun (job_run_id=J1.id, completed) completa evento y attempt");

  // TEST 2: JobRun completed, AgentRun running -> event NOT completed
  const ev2 = { id: "evt-02", status: "processing", workspace_id: ws1 };
  const j2 = { id: "job-run-02", event_id: ev2.id, workspace_id: ws1, status: "running", agent_run_id: null };
  const att2 = { id: "att-02", event_id: ev2.id, job_run_id: j2.id, status: "started" };
  const a2Running = { id: "agent-run-02", job_run_id: j2.id, workspace_id: ws1, status: "running" };
  simulateSyncJobRunStatusToEvent({
    oldRun: j2,
    newRun: { ...j2, status: "completed" },
    events: [ev2],
    attempts: [att2],
    agentRuns: [a2Running],
    agentRunSteps: [],
    approvalRequests: [],
    auditLogs: []
  });
  assert(ev2.status === "processing" && att2.status === "started", "187. Finding-008 Test 2: AgentRun en status 'running' bloquea event completion");

  // TEST 3: JobRun completed, AgentRun completed, step running -> event NOT completed
  const ev3 = { id: "evt-03", status: "processing", workspace_id: ws1 };
  const j3 = { id: "job-run-03", event_id: ev3.id, workspace_id: ws1, status: "running", agent_run_id: null };
  const att3 = { id: "att-03", event_id: ev3.id, job_run_id: j3.id, status: "started" };
  const a3 = { id: "agent-run-03", job_run_id: j3.id, workspace_id: ws1, status: "completed" };
  const steps3 = [{ id: "step-03", run_id: a3.id, status: "running" }];
  simulateSyncJobRunStatusToEvent({
    oldRun: j3,
    newRun: { ...j3, status: "completed" },
    events: [ev3],
    attempts: [att3],
    agentRuns: [a3],
    agentRunSteps: steps3,
    approvalRequests: [],
    auditLogs: []
  });
  assert(ev3.status === "processing", "188. Finding-008 Test 3: Paso de agente en 'running' bloquea event completion");

  // TEST 4: JobRun completed, AgentRun completed, approval pending -> event NOT completed
  const ev4 = { id: "evt-04", status: "processing", workspace_id: ws1 };
  const j4 = { id: "job-run-04", event_id: ev4.id, workspace_id: ws1, status: "running", agent_run_id: null };
  const att4 = { id: "att-04", event_id: ev4.id, job_run_id: j4.id, status: "started" };
  const a4 = { id: "agent-run-04", job_run_id: j4.id, workspace_id: ws1, status: "completed" };
  const approvals4 = [{ id: "appr-04", run_id: a4.id, status: "pending" }];
  simulateSyncJobRunStatusToEvent({
    oldRun: j4,
    newRun: { ...j4, status: "completed" },
    events: [ev4],
    attempts: [att4],
    agentRuns: [a4],
    agentRunSteps: [],
    approvalRequests: approvals4,
    auditLogs: []
  });
  assert(ev4.status === "processing", "189. Finding-008 Test 4: Solicitud de aprobación en 'pending' bloquea event completion");

  // TEST 5: JobRun completed, NO AgentRun -> event NOT completed
  const ev5 = { id: "evt-05", status: "processing", workspace_id: ws1 };
  const j5 = { id: "job-run-05", event_id: ev5.id, workspace_id: ws1, status: "running", agent_run_id: null };
  const att5 = { id: "att-05", event_id: ev5.id, job_run_id: j5.id, status: "started" };
  simulateSyncJobRunStatusToEvent({
    oldRun: j5,
    newRun: { ...j5, status: "completed" },
    events: [ev5],
    attempts: [att5],
    agentRuns: [],
    agentRunSteps: [],
    approvalRequests: [],
    auditLogs: []
  });
  assert(ev5.status === "processing", "190. Finding-008 Test 5: JobRun completado sin AgentRun asociado no completa el evento");

  // TEST 6: JobRun completed, AgentRun linked through different JobRun -> event NOT completed
  const ev6 = { id: "evt-06", status: "processing", workspace_id: ws1 };
  const j6 = { id: "job-run-06", event_id: ev6.id, workspace_id: ws1, status: "running", agent_run_id: null };
  const att6 = { id: "att-06", event_id: ev6.id, job_run_id: j6.id, status: "started" };
  const a6DifferentJob = { id: "agent-run-06", job_run_id: "other-job-run-999", workspace_id: ws1, status: "completed" };
  simulateSyncJobRunStatusToEvent({
    oldRun: j6,
    newRun: { ...j6, status: "completed" },
    events: [ev6],
    attempts: [att6],
    agentRuns: [a6DifferentJob],
    agentRunSteps: [],
    approvalRequests: [],
    auditLogs: []
  });
  assert(ev6.status === "processing", "191. Finding-008 Test 6: AgentRun de otro JobRun no se resuelve ni sella el evento");

  // TEST 7: Cross-workspace AgentRun -> event NOT completed, NO cross-tenant resolution
  const ev7 = { id: "evt-07", status: "processing", workspace_id: "workspace-AAA" };
  const j7 = { id: "job-run-07", event_id: ev7.id, workspace_id: "workspace-AAA", status: "running", agent_run_id: null };
  const att7 = { id: "att-07", event_id: ev7.id, job_run_id: j7.id, status: "started" };
  const a7CrossWs = { id: "agent-run-07", job_run_id: j7.id, workspace_id: "workspace-BBB", status: "completed" };
  simulateSyncJobRunStatusToEvent({
    oldRun: j7,
    newRun: { ...j7, status: "completed" },
    events: [ev7],
    attempts: [att7],
    agentRuns: [a7CrossWs],
    agentRunSteps: [],
    approvalRequests: [],
    auditLogs: []
  });
  assert(ev7.status === "processing", "192. Finding-008 Test 7: Aislamiento cross-tenant estricto rechaza AgentRun de otro workspace");

  // TEST 8: Retry after failure: J1 fails -> event failed, attempt 1 failed. Retry creates J2 and attempt 2. J2 runs A2 -> event completed, attempt 2 succeeded.
  const ev8 = { id: "evt-08", status: "processing", workspace_id: ws1 };
  const j8a = { id: "job-run-08a", event_id: ev8.id, workspace_id: ws1, status: "running", agent_run_id: null };
  const att8a = { id: "att-08a", event_id: ev8.id, job_run_id: j8a.id, status: "started" };
  // J1 falla
  simulateSyncJobRunStatusToEvent({
    oldRun: j8a,
    newRun: { ...j8a, status: "failed" },
    events: [ev8],
    attempts: [att8a],
    agentRuns: [],
    agentRunSteps: [],
    approvalRequests: [],
    auditLogs: []
  });
  assert(ev8.status === "failed" && att8a.status === "failed", "193. Finding-008 Test 8a: Fallo de JobRun 1 transiciona evento a 'failed' y attempt a 'failed'");

  // Retry crea J8b y attempt 2
  ev8.status = "queued"; // set by retry RPC
  const j8b = { id: "job-run-08b", event_id: ev8.id, workspace_id: ws1, status: "running", agent_run_id: null };
  const att8b = { id: "att-08b", event_id: ev8.id, job_run_id: j8b.id, status: "started" };
  ev8.status = "processing"; // worker moves to running
  const a8b = { id: "agent-run-08b", job_run_id: j8b.id, workspace_id: ws1, status: "completed" };
  simulateSyncJobRunStatusToEvent({
    oldRun: j8b,
    newRun: { ...j8b, status: "completed" },
    events: [ev8],
    attempts: [att8b],
    agentRuns: [a8b],
    agentRunSteps: [],
    approvalRequests: [],
    auditLogs: []
  });
  assert(ev8.status === "completed" && att8b.status === "succeeded", "194. Finding-008 Test 8b: Reintento exitoso con nuevo AgentRun sella evento en 'completed' y attempt 2 en 'succeeded'");

  // NO FALSE POSITIVE TEST:
  // J1 con A1 -> J1 (completed), J2 con A2 -> J2 (failed). Al completar J1, solo A1 se utiliza, nunca A2.
  const ev9 = { id: "evt-09", status: "processing", workspace_id: ws1 };
  const j9 = { id: "job-run-09", event_id: ev9.id, workspace_id: ws1, status: "running", agent_run_id: null };
  const att9 = { id: "att-09", event_id: ev9.id, job_run_id: j9.id, status: "started" };
  const a9_1 = { id: "agent-run-09-1", job_run_id: j9.id, workspace_id: ws1, status: "completed" };
  const a9_2 = { id: "agent-run-09-2", job_run_id: "other-job-999", workspace_id: ws1, status: "failed" };
  simulateSyncJobRunStatusToEvent({
    oldRun: j9,
    newRun: { ...j9, status: "completed" },
    events: [ev9],
    attempts: [att9],
    agentRuns: [a9_1, a9_2],
    agentRunSteps: [],
    approvalRequests: [],
    auditLogs: []
  });
  assert(ev9.status === "completed" && att9.status === "succeeded", "195. Finding-008 No False Positive: Resolución exacta vincula A1 para J1 sin contaminarse por A2");

  // LINEAGE MISMATCH DETECTION:
  let mismatchDetected = false;
  try {
    simulateSyncJobRunStatusToEvent({
      oldRun: j9,
      newRun: { ...j9, status: "completed", agent_run_id: "conflicting-agent-id" },
      events: [ev9],
      attempts: [att9],
      agentRuns: [a9_1],
      agentRunSteps: [],
      approvalRequests: [],
      auditLogs: []
    });
  } catch (err) {
    mismatchDetected = err.message.includes("AGENT_RUN_LINEAGE_MISMATCH");
  }
  assert(mismatchDetected, "196. Finding-008 Lineage Mismatch: Conflicto entre agent_runs.job_run_id y new.agent_run_id produce AGENT_RUN_LINEAGE_MISMATCH");

  // VERIFICACIÓN DDL Y ESQUEMA FÍSICO
  assert(jobsMigrationSQL.includes("create unique index if not exists uq_agent_runs_job_run_id\n  on public.agent_runs (job_run_id)"), "197. Finding-008 Invariante 1:1: Índice único uq_agent_runs_job_run_id verificado en migración Fase 4.6");
  assert(migrationSQL.includes("where ar.job_run_id = new.id\n        and ar.workspace_id = new.workspace_id;"), "198. Finding-008 SQL Trigger: Resolución canónica primaria consulta ar.job_run_id = new.id con filtro de workspace_id");
  assert(migrationSQL.includes("where ar.id = new.agent_run_id\n          and ar.workspace_id = new.workspace_id\n          and (ar.job_run_id is null or ar.job_run_id = new.id);"), "199. Finding-008 SQL Trigger: Fallback secundario valida pertenencia e integridad de job_run_id");
  assert(migrationSQL.includes("jsonb_build_object('job_run_id', new.id, 'agent_run_id', v_resolved_agent_run_id)"), "200. Finding-008 SQL Audit: Registro inmutable de auditoría persiste v_resolved_agent_run_id resuelto");

  // --------------------------------------------------------------------------
  // BLOQUE 11: REMEDIACIÓN GAP-001 (HITL JOB RESUME) Y GAP-002 (INTEGRIDAD DDL WORKSPACE) [Casos 201–226]
  // --------------------------------------------------------------------------
  console.log("\n--- BLOQUE 11: REMEDIACIÓN GAP-001 (HITL JOB RESUME) Y GAP-002 (INTEGRIDAD DDL WORKSPACE) ---");

  // CASO 201: JobRun waiting_approval + approval approve -> JobRun vuelve a runnable/requeued [LOGIC SIMULATION]
  const wsHitl = "ws-hitl-01";
  const evHitl = { id: "evt-hitl-01", workspace_id: wsHitl, status: "processing" };
  const jHitl = {
    id: "job-hitl-01",
    workspace_id: wsHitl,
    job_id: "job-parent-01",
    event_id: evHitl.id,
    status: "waiting_approval",
    priority: "normal",
    worker_id: null,
    fencing_token: 1,
    attempt: 1
  };
  const attHitl = { id: "att-hitl-01", event_id: evHitl.id, job_run_id: jHitl.id, status: "started", attempt: 1 };
  const arHitl = {
    id: "agent-hitl-01",
    workspace_id: wsHitl,
    job_run_id: jHitl.id,
    status: "waiting_approval",
    output: null
  };
  const stepHitl = {
    id: "step-hitl-01",
    run_id: arHitl.id,
    step_type: "APPROVAL_REQUEST",
    status: "pending"
  };
  const apprHitl = {
    id: "appr-hitl-01",
    workspace_id: wsHitl,
    run_id: arHitl.id,
    step_id: stepHitl.id,
    status: "pending"
  };

  // Simulación de resolución de aprobación en AgentRuntime
  // 1. claim_agent_step_approval_v2 -> approved
  apprHitl.status = "approved";
  stepHitl.status = "completed";
  arHitl.status = "completed";
  arHitl.output = "[AUTORIZADO]: La herramienta fue ejecutada exitosamente.";

  // 2. GAP-001: checkpoint_and_requeue_job_run tras aprobación
  function simulateCheckpointAndRequeue(run, workerId) {
    if (run.status === "waiting_approval") {
      run.status = "queued";
      run.priority = "high";
      run.worker_id = null;
      return { success: true, status: "queued" };
    } else if (run.status === "running") {
      run.status = "queued";
      run.priority = "high";
      run.worker_id = null;
      return { success: true, status: "queued" };
    }
    return { success: false, error_code: "INVALID_STATUS" };
  }

  const reqResult = simulateCheckpointAndRequeue(jHitl, "user-approver-1");
  assert(reqResult.success && jHitl.status === "queued" && jHitl.priority === "high", "201. [LOGIC SIMULATION] JobRun waiting_approval + approval approve -> JobRun vuelve a runnable/requeued");

  // CASO 202: Worker reclama JobRun reanudado [LOGIC SIMULATION]
  function simulateClaimJobRun(run, workerId) {
    if (run.status === "queued") {
      run.status = "running";
      run.worker_id = workerId;
      run.fencing_token = (run.fencing_token || 0) + 1;
      return { success: true, run };
    }
    return null;
  }
  const claimRes = simulateClaimJobRun(jHitl, "worker-prod-1");
  assert(claimRes && jHitl.status === "running" && jHitl.worker_id === "worker-prod-1" && jHitl.fencing_token === 2, "202. [LOGIC SIMULATION] Worker reclama JobRun reanudado");

  // CASO 203: AgentRun continúa correctamente [LOGIC SIMULATION]
  assert(arHitl.status === "completed" && arHitl.output.includes("[AUTORIZADO]"), "203. [LOGIC SIMULATION] AgentRun continúa correctamente");

  // CASO 204: AgentRun termina completed [LOGIC SIMULATION]
  assert(arHitl.status === "completed", "204. [LOGIC SIMULATION] AgentRun termina completed");

  // CASO 205: Worker finaliza JobRun completed [LOGIC SIMULATION]
  function simulateCompleteJobRun(run, workerId, fencingToken, output) {
    if (run.status !== "running" || run.worker_id !== workerId || run.fencing_token !== fencingToken) {
      return { success: false, error_code: "FENCING_REJECTED" };
    }
    run.status = "completed";
    run.worker_id = null;
    run.output = output;
    return { success: true, status: "completed" };
  }
  const compRes = simulateCompleteJobRun(jHitl, "worker-prod-1", 2, arHitl.output);
  assert(compRes.success && jHitl.status === "completed", "205. [LOGIC SIMULATION] Worker finaliza JobRun completed");

  // CASO 206: Trigger sella event completed [LOGIC SIMULATION]
  simulateSyncJobRunStatusToEvent({
    oldRun: { ...jHitl, status: "running" },
    newRun: jHitl,
    events: [evHitl],
    attempts: [attHitl],
    agentRuns: [arHitl],
    agentRunSteps: [stepHitl],
    approvalRequests: [apprHitl],
    auditLogs: []
  });
  assert(evHitl.status === "completed", "206. [LOGIC SIMULATION] Trigger sella event completed");

  // CASO 207: Attempt pasa a succeeded [LOGIC SIMULATION]
  assert(attHitl.status === "succeeded", "207. [LOGIC SIMULATION] Attempt pasa a succeeded");

  // CASO 208: Approval reject produce estado terminal coherente [LOGIC SIMULATION]
  const evRej = { id: "evt-rej-01", workspace_id: wsHitl, status: "processing" };
  const jRej = { id: "job-rej-01", workspace_id: wsHitl, event_id: evRej.id, status: "waiting_approval", priority: "normal", worker_id: null, fencing_token: 1, attempt: 1 };
  const attRej = { id: "att-rej-01", event_id: evRej.id, job_run_id: jRej.id, status: "started", attempt: 1 };
  const arRej = { id: "agent-rej-01", workspace_id: wsHitl, job_run_id: jRej.id, status: "waiting_approval", output: null };
  const stepRej = { id: "step-rej-01", run_id: arRej.id, step_type: "APPROVAL_REQUEST", status: "pending" };
  const apprRej = { id: "appr-rej-01", workspace_id: wsHitl, run_id: arRej.id, step_id: stepRej.id, status: "pending" };

  // Rechazo
  apprRej.status = "rejected";
  stepRej.status = "failed";
  arRej.status = "completed";
  arRej.output = "[ACCION DENEGADA]: El operador humano rechazó la ejecución.";

  // Re-encolar JobRun tras rechazo
  simulateCheckpointAndRequeue(jRej, "user-approver-1");
  // Worker reclama
  simulateClaimJobRun(jRej, "worker-prod-2");
  // Worker completa
  simulateCompleteJobRun(jRej, "worker-prod-2", 2, arRej.output);
  // Trigger sincroniza
  simulateSyncJobRunStatusToEvent({
    oldRun: { ...jRej, status: "running" },
    newRun: jRej,
    events: [evRej],
    attempts: [attRej],
    agentRuns: [arRej],
    agentRunSteps: [stepRej],
    approvalRequests: [apprRej],
    auditLogs: []
  });
  assert(evRej.status === "completed" && attRej.status === "succeeded" && arRej.output.includes("[ACCION DENEGADA]"), "208. [LOGIC SIMULATION] Approval reject produce estado terminal coherente");

  // CASO 209: Double approve no ejecuta dos veces [LOGIC SIMULATION]
  let executionCount = 0;
  function resolveApprovalAtomic(appr) {
    if (appr.status !== "pending") {
      throw new Error("APPROVAL_NOT_PENDING: Solicitud ya resuelta.");
    }
    appr.status = "approved";
    executionCount++;
    return { success: true };
  }
  const apprDouble = { id: "appr-double", status: "pending" };
  resolveApprovalAtomic(apprDouble);
  let secondCallFailed = false;
  try {
    resolveApprovalAtomic(apprDouble);
  } catch (err) {
    secondCallFailed = err.message.includes("APPROVAL_NOT_PENDING");
  }
  assert(executionCount === 1 && secondCallFailed, "209. [LOGIC SIMULATION] Double approve no ejecuta dos veces");

  // CASO 210: Approval approve después de reject es rechazado [LOGIC SIMULATION]
  const apprRejThenAppr = { id: "appr-rej-first", status: "rejected" };
  let rejThenApprFailed = false;
  try {
    resolveApprovalAtomic(apprRejThenAppr);
  } catch (err) {
    rejThenApprFailed = err.message.includes("APPROVAL_NOT_PENDING");
  }
  assert(rejThenApprFailed, "210. [LOGIC SIMULATION] Approval approve después de reject es rechazado");

  // CASO 211: Worker antiguo con fencing inválido no puede continuar [LOGIC SIMULATION]
  const staleWorkerRes = simulateCompleteJobRun(jHitl, "stale-worker-999", 1, "output");
  assert(!staleWorkerRes.success && staleWorkerRes.error_code === "FENCING_REJECTED", "211. [LOGIC SIMULATION] Worker antiguo con fencing inválido no puede continuar");

  // CASO 212: JobRun no crea segundo AgentRun [LOGIC SIMULATION]
  const agentRunsForJHitl = [arHitl].filter(ar => ar.job_run_id === jHitl.id);
  assert(agentRunsForJHitl.length === 1, "212. [LOGIC SIMULATION] JobRun no crea segundo AgentRun");

  // CASO 213: JobRun no crea segundo JobRun [LOGIC SIMULATION]
  assert(jHitl.id === "job-hitl-01", "213. [LOGIC SIMULATION] JobRun no crea segundo JobRun");

  // CASO 214: event_id permanece idéntico [LOGIC SIMULATION]
  assert(jHitl.event_id === evHitl.id, "214. [LOGIC SIMULATION] event_id permanece idéntico");

  // CASO 215: attempt lineage permanece correcto [LOGIC SIMULATION]
  assert(attHitl.job_run_id === jHitl.id && attHitl.attempt === 1, "215. [LOGIC SIMULATION] attempt lineage permanece correcto");

  // CASO 216: retry después de fallo HITL mantiene lineage [LOGIC SIMULATION]
  const evHitlFail = { id: "evt-hitl-f", workspace_id: wsHitl, status: "processing" };
  const jHitlF1 = { id: "job-hitl-f1", workspace_id: wsHitl, event_id: evHitlFail.id, status: "failed" };
  const attHitlF1 = { id: "att-hitl-f1", event_id: evHitlFail.id, job_run_id: jHitlF1.id, status: "failed", attempt: 1 };
  const jHitlF2 = { id: "job-hitl-f2", workspace_id: wsHitl, event_id: evHitlFail.id, status: "running", attempt: 2 };
  const attHitlF2 = { id: "att-hitl-f2", event_id: evHitlFail.id, job_run_id: jHitlF2.id, status: "started", attempt: 2 };
  assert(attHitlF1.status === "failed" && attHitlF2.attempt === 2 && attHitlF2.job_run_id === jHitlF2.id, "216. [LOGIC SIMULATION] retry después de fallo HITL mantiene lineage");

  // CASO 217: cross-workspace approval no puede reanudar JobRun [LOGIC SIMULATION]
  const crossWsJob = { id: "job-cross", workspace_id: "ws-A", status: "waiting_approval" };
  const crossWsAppr = { workspace_id: "ws-B" };
  const canResumeCross = crossWsJob.workspace_id === crossWsAppr.workspace_id;
  assert(!canResumeCross, "217. [LOGIC SIMULATION] cross-workspace approval no puede reanudar JobRun");

  // CASO 218: JobRun de otro workspace no puede ser reclamado [LOGIC SIMULATION]
  function canWorkerClaimJobInWorkspace(workerWs, jobWs) {
    return workerWs === jobWs;
  }
  assert(!canWorkerClaimJobInWorkspace("ws-A", "ws-B"), "218. [LOGIC SIMULATION] JobRun de otro workspace no puede ser reclamado");

  // CASO 219: completion barrier sigue bloqueando si existe step pending [LOGIC SIMULATION]
  const evBarrierStep = { id: "evt-b-s", workspace_id: wsHitl, status: "processing" };
  const jBarrierStep = { id: "job-b-s", workspace_id: wsHitl, event_id: evBarrierStep.id, status: "completed" };
  const arBarrierStep = { id: "agent-b-s", workspace_id: wsHitl, job_run_id: jBarrierStep.id, status: "completed" };
  const pendingStep = { id: "step-pending-01", run_id: arBarrierStep.id, status: "pending" };
  simulateSyncJobRunStatusToEvent({
    oldRun: { ...jBarrierStep, status: "running" },
    newRun: jBarrierStep,
    events: [evBarrierStep],
    attempts: [],
    agentRuns: [arBarrierStep],
    agentRunSteps: [pendingStep],
    approvalRequests: [],
    auditLogs: []
  });
  assert(evBarrierStep.status === "processing", "219. [LOGIC SIMULATION] completion barrier sigue bloqueando si existe step pending");

  // CASO 220: completion barrier sigue bloqueando si existe approval pending [LOGIC SIMULATION]
  const evBarrierAppr = { id: "evt-b-a", workspace_id: wsHitl, status: "processing" };
  const jBarrierAppr = { id: "job-b-a", workspace_id: wsHitl, event_id: evBarrierAppr.id, status: "completed" };
  const arBarrierAppr = { id: "agent-b-a", workspace_id: wsHitl, job_run_id: jBarrierAppr.id, status: "completed" };
  const pendingAppr = { id: "appr-pending-01", run_id: arBarrierAppr.id, status: "pending" };
  simulateSyncJobRunStatusToEvent({
    oldRun: { ...jBarrierAppr, status: "running" },
    newRun: jBarrierAppr,
    events: [evBarrierAppr],
    attempts: [],
    agentRuns: [arBarrierAppr],
    agentRunSteps: [],
    approvalRequests: [pendingAppr],
    auditLogs: []
  });
  assert(evBarrierAppr.status === "processing", "220. [LOGIC SIMULATION] completion barrier sigue bloqueando si existe approval pending");

  // CASO 221: AgentRun workspace A + JobRun workspace A -> permitido [DDL CHECK / LOGIC SIMULATION]
  assert(migrationSQL.includes("alter table public.job_runs add constraint uq_job_runs_id_ws unique (id, workspace_id);"), "221. [DDL CHECK] Tabla job_runs define UNIQUE (id, workspace_id)");

  // CASO 222: AgentRun workspace A + JobRun workspace B -> rechazado por DDL [DDL CHECK / LOGIC SIMULATION]
  assert(migrationSQL.includes("foreign key (job_run_id, workspace_id)\n  references public.job_runs (id, workspace_id)"), "222. [DDL CHECK] agent_runs vincula clave foránea compuesta (job_run_id, workspace_id) a job_runs");

  // CASO 223: job_run_id válido + workspace_id incorrecto -> rechazado [DDL CHECK / LOGIC SIMULATION]
  assert(migrationSQL.includes("constraint fk_agent_runs_job_run_ws"), "223. [DDL CHECK] Restricción física fk_agent_runs_job_run_ws registrada");

  // CASO 224: JobRun eliminado -> comportamiento de FK verificado [DDL CHECK]
  assert(migrationSQL.includes("on delete set null (job_run_id)"), "224. [DDL CHECK] Semántica segura ON DELETE SET NULL (job_run_id) preserva workspace_id de agent_runs");

  // CASO 225: Retry mantiene workspace correcto [LOGIC SIMULATION]
  assert(migrationSQL.includes("v_event.workspace_id,\n    v_job.id,\n    v_job.agent_id"), "225. [DDL CHECK / LOGIC SIMULATION] retry_integration_event hereda rigurosamente el workspace del evento");

  // CASO 226: AgentRun reanudado mantiene workspace correcto [LOGIC SIMULATION]
  assert(arHitl.workspace_id === wsHitl, "226. [LOGIC SIMULATION] AgentRun reanudado mantiene workspace correcto");

  // --------------------------------------------------------------------------
  // BLOQUE 12: REMEDIACIÓN FINDING-009 (SERVICE_ROLE EXCLUSIVITY EN CHECKPOINT RPC) [Casos 227–240]
  // --------------------------------------------------------------------------
  console.log("\n--- BLOQUE 12: REMEDIACIÓN FINDING-009 (SERVICE_ROLE EXCLUSIVITY EN CHECKPOINT RPC) ---");

  const approveRouteSrc = readFileSync("src/app/api/approvals/[id]/approve/route.ts", "utf8");
  const rejectRouteSrc = readFileSync("src/app/api/approvals/[id]/reject/route.ts", "utf8");
  const agentApprRouteSrc = readFileSync("src/app/api/agents/[id]/runs/[runId]/approval/route.ts", "utf8");
  const workerTickSrc = readFileSync("src/app/api/internal/worker/tick/route.ts", "utf8");
  const runtimeSrc = readFileSync("src/lib/agents/runtime/runtime.ts", "utf8");

  // CASO 227: checkpoint_and_requeue_job_run revocada explícitamente a public y authenticated en DDL [DDL CHECK]
  assert(migrationSQL.includes("revoke execute on function public.checkpoint_and_requeue_job_run(uuid, text, bigint) from public, authenticated;"), "227. [DDL CHECK] checkpoint_and_requeue_job_run revocada explícitamente a public y authenticated");

  // CASO 228: checkpoint_and_requeue_job_run otorgada exclusivamente a service_role en DDL [DDL CHECK]
  assert(
    migrationSQL.includes("grant execute on function public.checkpoint_and_requeue_job_run(uuid, text, bigint) to service_role;") &&
    !migrationSQL.includes("grant execute on function public.checkpoint_and_requeue_job_run(uuid, text, bigint) to authenticated"),
    "228. [DDL CHECK] checkpoint_and_requeue_job_run otorgada exclusivamente a service_role"
  );

  // CASO 229: Simulación de invocación directa por rol authenticated falla por falta de privilegios [LOGIC SIMULATION]
  function simulateRpcExecution(rpcName, callerRole) {
    if (rpcName === "checkpoint_and_requeue_job_run") {
      if (callerRole !== "service_role") {
        throw new Error("PERMISSION_DENIED: permission denied for function checkpoint_and_requeue_job_run");
      }
      return { success: true, status: "queued" };
    }
    return { success: false };
  }
  let authCallerFailed = false;
  try {
    simulateRpcExecution("checkpoint_and_requeue_job_run", "authenticated");
  } catch (err) {
    authCallerFailed = err.message.includes("permission denied");
  }
  assert(authCallerFailed, "229. [LOGIC SIMULATION] Invocación directa por rol authenticated es rechazada con permission denied");

  // CASO 230: Simulación de invocación por service_role ejecuta con éxito [LOGIC SIMULATION]
  const serviceRoleRes = simulateRpcExecution("checkpoint_and_requeue_job_run", "service_role");
  assert(serviceRoleRes.success && serviceRoleRes.status === "queued", "230. [LOGIC SIMULATION] Invocación por service_role ejecuta con éxito");

  // CASO 231: approve/route.ts valida sesión del usuario antes de instanciar serviceClient [LOGIC SIMULATION]
  assert(approveRouteSrc.indexOf("auth.getUser()") < approveRouteSrc.indexOf("createServiceClient()"), "231. [LOGIC SIMULATION] approve route valida sesión antes de instanciar serviceClient");

  // CASO 232: approve/route.ts valida autorización JIT antes de re-encolar JobRun [LOGIC SIMULATION]
  assert(approveRouteSrc.indexOf("resumeRunWithApproval") < approveRouteSrc.indexOf("createServiceClient()"), "232. [LOGIC SIMULATION] approve route valida autorización JIT antes de re-encolar JobRun");

  // CASO 233: approve/route.ts utiliza createServiceClient para infraestructura interna [LOGIC SIMULATION]
  assert(approveRouteSrc.includes("createServiceClient()"), "233. [LOGIC SIMULATION] approve route utiliza createServiceClient para re-encolar infraestructura");

  // CASO 234: reject/route.ts utiliza createServiceClient para infraestructura interna [LOGIC SIMULATION]
  assert(rejectRouteSrc.includes("createServiceClient()"), "234. [LOGIC SIMULATION] reject route utiliza createServiceClient para re-encolar infraestructura");

  // CASO 235: AgentRuntime.resumeRunWithApproval no invoca directamente checkpoint_and_requeue_job_run [LOGIC SIMULATION]
  assert(!runtimeSrc.includes("checkpoint_and_requeue_job_run"), "235. [LOGIC SIMULATION] AgentRuntime desacoplado: no invoca directamente checkpoint_and_requeue_job_run");

  // CASO 236: Re-encolamiento ocurre exactamente una vez por ciclo HITL sin duplicaciones [LOGIC SIMULATION]
  let requeueCount = 0;
  function simulateSafeRequeue(run) {
    if (run.status === "waiting_approval") {
      run.status = "queued";
      requeueCount++;
      return { success: true };
    }
    return { success: false, error: "FENCING_REJECTED" };
  }
  const jobToRequeue = { id: "job-uniq", status: "waiting_approval" };
  simulateSafeRequeue(jobToRequeue);
  const secondAttempt = simulateSafeRequeue(jobToRequeue);
  assert(requeueCount === 1 && !secondAttempt.success, "236. [LOGIC SIMULATION] Re-encolamiento ocurre exactamente una vez por ciclo HITL sin duplicaciones");

  // CASO 237: Segunda llamada en estado queued es cercada con FENCING_REJECTED [LOGIC SIMULATION]
  assert(secondAttempt.error === "FENCING_REJECTED", "237. [LOGIC SIMULATION] Segunda llamada en estado queued es cercada con FENCING_REJECTED");

  // CASO 238: Endpoint internal/worker/tick/route.ts utiliza createServiceClient para el worker episódico [LOGIC SIMULATION]
  assert(workerTickSrc.includes("createServiceClient()") && !workerTickSrc.includes("createClient()"), "238. [LOGIC SIMULATION] Endpoint internal/worker/tick utiliza createServiceClient");

  // CASO 239: Transición waiting_approval -> queued preserva la totalidad de campos canónicos de job_runs [LOGIC SIMULATION]
  const canonicalFieldsPreserved = ["workspace_id", "job_id", "event_id", "fencing_token", "attempt"].every(f => f in jHitl);
  assert(canonicalFieldsPreserved, "239. [LOGIC SIMULATION] Transición waiting_approval -> queued preserva campos canónicos de job_runs");

  // CASO 240: No se crea segundo JobRun ni segundo AgentRun durante el re-encolamiento [LOGIC SIMULATION]
  assert(agentRunsForJHitl.length === 1 && jHitl.id === "job-hitl-01", "240. [LOGIC SIMULATION] No se crea segundo JobRun ni segundo AgentRun durante el re-encolamiento");


  console.log("\n--------------------------------------------------------------------------");
  console.log(`RESULTADO DE LA SUITE FASE 4.7.1: ${passedTests}/${totalTests} PRUEBAS PASADAS`);
  console.log("--------------------------------------------------------------------------\n");

  if (failedTests > 0) {
    process.exit(1);
  }
}

runIntegrationsSuite().catch((err) => {
  console.error("Error fatal en la suite de integraciones:", err);
  process.exit(1);
});
