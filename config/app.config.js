import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function envString(name, fallback) {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value;
}

function envInt(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function envFloat(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function envBool(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

function envJson(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON in ${name}.`);
  }
}

function resolveFromRoot(value) {
  return path.isAbsolute(value) ? path.normalize(value) : path.resolve(rootDir, value);
}

const ConfigSchema = z.object({
  rootDir: z.string(),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  nodeEnv: z.string(),
  dataDir: z.string(),
  databasePath: z.string(),
  outputDir: z.string(),
  promptsDir: z.string(),
  addendaDir: z.string(),
  logsDir: z.string(),
  logFileName: z.string().min(1),
  logLevel: z.enum(["trace", "debug", "info", "warn", "error", "fatal", "silent"]),
  diagnosticLogging: z.boolean(),
  limits: z.object({
    uploadBytes: z.number().int().positive(),
    records: z.number().int().positive(),
    fields: z.number().int().positive(),
    fieldBytes: z.number().int().positive(),
    promptBytes: z.number().int().positive(),
    addendumBytes: z.number().int().positive(),
    providerResponseBytes: z.number().int().positive(),
    exportFilenameLength: z.number().int().min(32),
    logMaxSize: z.number().int().positive(),
    logMaxFiles: z.number().int().positive()
  }),
  ai: z.object({
    defaultProvider: z.string(),
    defaultModel: z.string(),
    temperature: z.number().min(0).max(2),
    maxTokens: z.number().int().min(1),
    timeoutMs: z.number().int().positive(),
    maxConcurrency: z.number().int().min(1).max(20),
    defaultConcurrency: z.number().int().min(1).max(20),
    defaultDelayMs: z.number().int().min(0),
    maxDelayMs: z.number().int().min(0),
    maxRetries: z.number().int().min(0).max(10),
    backoffMinMs: z.number().int().min(0),
    backoffMaxMs: z.number().int().min(1)
  }),
  research: z.object({
    enabled: z.boolean(),
    timeoutMs: z.number().int().positive(),
    responseBytes: z.number().int().positive(),
    cacheSeconds: z.number().int().min(0),
    allowGoogleSheetsCsv: z.boolean(),
    browserChannel: z.string(),
    renderDelayMs: z.number().int().min(0).max(10000)
  }),
  modelSync: z.object({
    enabled: z.boolean(),
    startup: z.boolean(),
    intervalSeconds: z.number().int().min(0),
    cacheTtlSeconds: z.number().int().min(0),
    staleCatalogSeconds: z.number().int().positive(),
    missingGraceSeconds: z.number().int().min(0),
    providerTimeoutMs: z.number().int().positive(),
    maxRetries: z.number().int().min(0).max(10),
    backoffMinMs: z.number().int().min(0),
    backoffMaxMs: z.number().int().positive(),
    paginationLimit: z.number().int().positive(),
    maxResponseBytes: z.number().int().positive(),
    allowInferredCapabilities: z.boolean(),
    providerPreference: z.array(z.string()),
    manualSyncToken: z.string().optional(),
    requiredCapabilities: z.object({
      dataTypes: z.array(z.string()),
      inputModalities: z.array(z.string()),
      outputModalities: z.array(z.string()),
      structuredOutput: z.boolean(),
      minContextWindow: z.number().int().min(0)
    }),
    emergencyFallbackModels: z.array(z.record(z.unknown()))
  }),
  business: z.object({
    name: z.string(),
    city: z.string(),
    region: z.string(),
    email: z.string(),
    phone: z.string(),
    signature: z.string(),
    aiSmsUrl: z.string().url(),
    printFooter: z.string()
  })
});

export function loadAppConfig(overrides = {}) {
  const config = {
    rootDir,
    host: envString("HOST", "127.0.0.1"),
    port: envInt("PORT", 3000),
    nodeEnv: envString("NODE_ENV", "development"),
    dataDir: resolveFromRoot(envString("DATA_DIR", "storage")),
    databasePath: resolveFromRoot(envString("DATABASE_PATH", "storage/email-gen.sqlite")),
    outputDir: resolveFromRoot(envString("OUTPUT_DIR", "output")),
    promptsDir: resolveFromRoot(envString("PROMPTS_DIR", "prompts")),
    addendaDir: resolveFromRoot(envString("ADDENDA_DIR", "addenda")),
    logsDir: resolveFromRoot(envString("LOG_DIR", "logs")),
    logFileName: envString("LOG_FILE_NAME", "app.log"),
    logLevel: envString("LOG_LEVEL", "info"),
    diagnosticLogging: envBool("DIAGNOSTIC_LOGGING", false),
    limits: {
      uploadBytes: envInt("MAX_UPLOAD_BYTES", 5 * 1024 * 1024),
      records: envInt("MAX_RECORDS", 1000),
      fields: envInt("MAX_FIELDS", 100),
      fieldBytes: envInt("MAX_FIELD_BYTES", 12000),
      promptBytes: envInt("MAX_PROMPT_BYTES", 60000),
      addendumBytes: envInt("MAX_ADDENDUM_BYTES", 250000),
      providerResponseBytes: envInt("MAX_PROVIDER_RESPONSE_BYTES", 500000),
      exportFilenameLength: envInt("MAX_EXPORT_FILENAME_LENGTH", 160),
      logMaxSize: envInt("LOG_MAX_SIZE", 1024 * 1024),
      logMaxFiles: envInt("LOG_MAX_FILES", 5)
    },
    ai: {
      defaultProvider: envString("DEFAULT_AI_PROVIDER", "xai"),
      defaultModel: envString("DEFAULT_AI_MODEL", "grok-4.5"),
      temperature: envFloat("AI_TEMPERATURE", 0.45),
      maxTokens: envInt("AI_MAX_TOKENS", 1800),
      timeoutMs: envInt("PROVIDER_TIMEOUT_MS", 60000),
      maxConcurrency: envInt("MAX_CONCURRENCY", 4),
      defaultConcurrency: envInt("DEFAULT_CONCURRENCY", 1),
      defaultDelayMs: envInt("DEFAULT_DELAY_MS", 750),
      maxDelayMs: envInt("MAX_DELAY_MS", 10000),
      maxRetries: envInt("MAX_RETRIES", 2),
      backoffMinMs: envInt("BACKOFF_MIN_MS", 500),
      backoffMaxMs: envInt("BACKOFF_MAX_MS", 6000)
    },
    research: {
      enabled: envBool("RESEARCH_ENABLED", true),
      timeoutMs: envInt("RESEARCH_TIMEOUT_MS", 8000),
      responseBytes: envInt("RESEARCH_RESPONSE_BYTES", 500000),
      cacheSeconds: envInt("RESEARCH_CACHE_SECONDS", 86400),
      allowGoogleSheetsCsv: envBool("ALLOW_GOOGLE_SHEETS_CSV", true),
      browserChannel: envString("RESEARCH_BROWSER_CHANNEL", ""),
      renderDelayMs: envInt("RESEARCH_RENDER_DELAY_MS", 750)
    },
    modelSync: {
      enabled: envBool("MODEL_SYNC_ENABLED", true),
      startup: envBool("MODEL_SYNC_STARTUP", false),
      intervalSeconds: envInt("MODEL_SYNC_INTERVAL_SECONDS", 6 * 60 * 60),
      cacheTtlSeconds: envInt("MODEL_SYNC_CACHE_TTL_SECONDS", 60 * 60),
      staleCatalogSeconds: envInt("MODEL_SYNC_STALE_CATALOG_SECONDS", 24 * 60 * 60),
      missingGraceSeconds: envInt("MODEL_SYNC_MISSING_GRACE_SECONDS", 7 * 24 * 60 * 60),
      providerTimeoutMs: envInt("MODEL_SYNC_PROVIDER_TIMEOUT_MS", envInt("PROVIDER_TIMEOUT_MS", 60000)),
      maxRetries: envInt("MODEL_SYNC_MAX_RETRIES", envInt("MAX_RETRIES", 2)),
      backoffMinMs: envInt("MODEL_SYNC_BACKOFF_MIN_MS", envInt("BACKOFF_MIN_MS", 500)),
      backoffMaxMs: envInt("MODEL_SYNC_BACKOFF_MAX_MS", envInt("BACKOFF_MAX_MS", 6000)),
      paginationLimit: envInt("MODEL_SYNC_PAGINATION_LIMIT", 20),
      maxResponseBytes: envInt(
        "MODEL_SYNC_MAX_RESPONSE_BYTES",
        envInt("MAX_PROVIDER_RESPONSE_BYTES", 500000)
      ),
      allowInferredCapabilities: envBool("MODEL_SYNC_ALLOW_INFERRED_CAPABILITIES", false),
      providerPreference: envString(
        "MODEL_SYNC_PROVIDER_PREFERENCE",
        "xai,openai,anthropic,venice,custom,mock,lumaai"
      )
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
      manualSyncToken: envString("MODEL_SYNC_ADMIN_TOKEN", ""),
      requiredCapabilities: {
        dataTypes: envString("MODEL_SYNC_REQUIRED_DATA_TYPES", "email")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
        inputModalities: envString("MODEL_SYNC_REQUIRED_INPUT_MODALITIES", "text")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
        outputModalities: envString("MODEL_SYNC_REQUIRED_OUTPUT_MODALITIES", "text")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
        structuredOutput: envBool("MODEL_SYNC_REQUIRE_STRUCTURED_OUTPUT", true),
        minContextWindow: envInt("MODEL_SYNC_MIN_CONTEXT_WINDOW", 0)
      },
      emergencyFallbackModels: envJson("MODEL_SYNC_EMERGENCY_FALLBACK_MODELS", [])
    },
    business: {
      name: envString("BUSINESS_NAME", "Local AI SMS"),
      city: envString("BUSINESS_CITY", "Omaha"),
      region: envString("BUSINESS_REGION", "Nebraska"),
      email: envString("BUSINESS_EMAIL", "hello@example.com"),
      phone: envString("BUSINESS_PHONE", "(402) 555-0100"),
      signature: envString("BUSINESS_SIGNATURE", "Best,\\nKyle").replaceAll("\\n", "\n"),
      aiSmsUrl: envString("AI_SMS_URL", "https://example.com/ai-sms"),
      printFooter: envString("PRINT_FOOTER", "Generated locally by AI Batch Personalizer")
    },
    ...overrides
  };

  const parsed = ConfigSchema.safeParse(config);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    throw new Error(`Invalid application configuration: ${issues}`);
  }

  if (parsed.data.ai.defaultConcurrency > parsed.data.ai.maxConcurrency) {
    throw new Error("Invalid application configuration: DEFAULT_CONCURRENCY cannot exceed MAX_CONCURRENCY.");
  }
  if (parsed.data.ai.defaultDelayMs > parsed.data.ai.maxDelayMs) {
    throw new Error("Invalid application configuration: DEFAULT_DELAY_MS cannot exceed MAX_DELAY_MS.");
  }
  if (parsed.data.ai.backoffMinMs > parsed.data.ai.backoffMaxMs) {
    throw new Error("Invalid application configuration: BACKOFF_MIN_MS cannot exceed BACKOFF_MAX_MS.");
  }
  if (parsed.data.modelSync.backoffMinMs > parsed.data.modelSync.backoffMaxMs) {
    throw new Error(
      "Invalid application configuration: MODEL_SYNC_BACKOFF_MIN_MS cannot exceed MODEL_SYNC_BACKOFF_MAX_MS."
    );
  }

  return Object.freeze(parsed.data);
}

export { rootDir };
