import { z } from "zod";

const envSchema = z.object({
  API_URL: z.string().url(),
  SCM_TOKEN: z.string().min(1),
  LOCAL_REPOS: z.string().optional(),
  DEFAULT_PROJECT: z.string().min(1).optional(),
});

export interface McpConfig {
  apiUrl: string;
  scmToken: string;
  localRepos: Record<string, string>;
  defaultProject?: string;
}

export function getConfig(): McpConfig {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  const env = parsed.data;
  let localRepos: Record<string, string> = {};
  if (env.LOCAL_REPOS) {
    try {
      localRepos = JSON.parse(env.LOCAL_REPOS);
    } catch {
      console.error("Warning: LOCAL_REPOS is not valid JSON, using empty object");
    }
  }
  return { apiUrl: env.API_URL, scmToken: env.SCM_TOKEN, localRepos, defaultProject: env.DEFAULT_PROJECT };
}