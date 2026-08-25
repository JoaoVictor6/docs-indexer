import { describe, it, expect, beforeEach, afterEach } from "bun:test";

function saveEnv(): Record<string, string | undefined> {
  return {
    DATABASE_URL: process.env.DATABASE_URL,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    OPENROUTER_BASE_URL: process.env.OPENROUTER_BASE_URL,
    EMBEDDING_MODEL: process.env.EMBEDDING_MODEL,
    PORT: process.env.PORT,
  };
}

function restoreEnv(saved: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function clearEnv() {
  delete process.env.DATABASE_URL;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_BASE_URL;
  delete process.env.EMBEDDING_MODEL;
  delete process.env.PORT;
}

describe("getConfig", () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = saveEnv();
    clearEnv();
  });

  afterEach(() => restoreEnv(savedEnv));

  it("reads DATABASE_URL and OPENROUTER_API_KEY from env", async () => {
    process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/db";
    process.env.OPENROUTER_API_KEY = "sk-test-key";
    const { getConfig } = await import("./config");
    const config = getConfig();
    expect(config.databaseUrl).toBe("postgres://user:pass@localhost:5432/db");
    expect(config.openrouterApiKey).toBe("sk-test-key");
  });

  it("applies defaults for optional vars", async () => {
    process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/db";
    process.env.OPENROUTER_API_KEY = "sk-test-key";
    const { getConfig } = await import("./config");
    const config = getConfig();
    expect(config.openrouterBaseUrl).toBe("https://openrouter.ai/api/v1");
    expect(config.embeddingModel).toBe("openai/text-embedding-3-small");
    expect(config.port).toBe(3000);
  });

  it("reads overridden optional vars", async () => {
    process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/db";
    process.env.OPENROUTER_API_KEY = "sk-test-key";
    process.env.OPENROUTER_BASE_URL = "https://custom.api/v1";
    process.env.EMBEDDING_MODEL = "custom-model";
    process.env.PORT = "8080";
    const { getConfig } = await import("./config");
    const config = getConfig();
    expect(config.openrouterBaseUrl).toBe("https://custom.api/v1");
    expect(config.embeddingModel).toBe("custom-model");
    expect(config.port).toBe(8080);
  });

  it("throws if DATABASE_URL is missing", async () => {
    process.env.OPENROUTER_API_KEY = "sk-test-key";
    const { getConfig } = await import("./config");
    expect(() => getConfig()).toThrow("DATABASE_URL");
  });

  it("throws if DATABASE_URL is empty", async () => {
    process.env.DATABASE_URL = "";
    process.env.OPENROUTER_API_KEY = "sk-test-key";
    const { getConfig } = await import("./config");
    expect(() => getConfig()).toThrow("DATABASE_URL");
  });

  it("throws if OPENROUTER_API_KEY is missing", async () => {
    process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/db";
    const { getConfig } = await import("./config");
    expect(() => getConfig()).toThrow("OPENROUTER_API_KEY");
  });

  it("throws if OPENROUTER_API_KEY is empty", async () => {
    process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/db";
    process.env.OPENROUTER_API_KEY = "";
    const { getConfig } = await import("./config");
    expect(() => getConfig()).toThrow("OPENROUTER_API_KEY");
  });

  it("coerces PORT to a number", async () => {
    process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/db";
    process.env.OPENROUTER_API_KEY = "sk-test-key";
    process.env.PORT = "8080";
    const { getConfig } = await import("./config");
    const config = getConfig();
    expect(config.port).toBe(8080);
  });
});
