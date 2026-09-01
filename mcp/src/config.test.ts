import { describe, it, expect, beforeEach, afterEach } from "bun:test";

function saveEnv(): Record<string, string | undefined> {
  return {
    API_URL: process.env.API_URL,
    SCM_TOKEN: process.env.SCM_TOKEN,
    LOCAL_REPOS: process.env.LOCAL_REPOS,
  };
}

function restoreEnv(saved: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function clearEnv() {
  delete process.env.API_URL;
  delete process.env.SCM_TOKEN;
  delete process.env.LOCAL_REPOS;
}

describe("getConfig", () => {
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = saveEnv();
    clearEnv();
  });

  afterEach(() => restoreEnv(savedEnv));

  it("reads API_URL and SCM_TOKEN from env", async () => {
    process.env.API_URL = "https://api.example.com";
    process.env.SCM_TOKEN = "ghp-test";
    const { getConfig } = await import("./config");
    const config = getConfig();
    expect(config.apiUrl).toBe("https://api.example.com");
    expect(config.scmToken).toBe("ghp-test");
  });

  it("throws if API_URL is missing", async () => {
    process.env.SCM_TOKEN = "ghp-test";
    const { getConfig } = await import("./config");
    expect(() => getConfig()).toThrow("API_URL");
  });

  it("throws if SCM_TOKEN is missing", async () => {
    process.env.API_URL = "https://api.example.com";
    const { getConfig } = await import("./config");
    expect(() => getConfig()).toThrow("SCM_TOKEN");
  });

  it("throws if API_URL is not a valid URL", async () => {
    process.env.API_URL = "not-a-url";
    process.env.SCM_TOKEN = "test";
    const { getConfig } = await import("./config");
    expect(() => getConfig()).toThrow();
  });

  it("LOCAL_REPOS set to valid JSON → config.localRepos has the parsed value", async () => {
    process.env.API_URL = "https://api.example.com";
    process.env.SCM_TOKEN = "ghp-test";
    process.env.LOCAL_REPOS = '{"compras-e.doc":"/home/joao/repos/compras-e.doc"}';
    const { getConfig } = await import("./config");
    const config = getConfig();
    expect(config.localRepos).toEqual({ "compras-e.doc": "/home/joao/repos/compras-e.doc" });
  });

  it("LOCAL_REPOS not set → config.localRepos is {}", async () => {
    process.env.API_URL = "https://api.example.com";
    process.env.SCM_TOKEN = "ghp-test";
    const { getConfig } = await import("./config");
    const config = getConfig();
    expect(config.localRepos).toEqual({});
  });

  it("LOCAL_REPOS is invalid JSON → config.localRepos is {}, no crash", async () => {
    process.env.API_URL = "https://api.example.com";
    process.env.SCM_TOKEN = "ghp-test";
    process.env.LOCAL_REPOS = "not-json";
    const { getConfig } = await import("./config");
    const config = getConfig();
    expect(config.localRepos).toEqual({});
  });
});