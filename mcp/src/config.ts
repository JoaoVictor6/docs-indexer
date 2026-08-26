import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  OPENROUTER_API_KEY: z.string().min(1),
  OPENROUTER_BASE_URL: z.string().url().default("https://openrouter.ai/api/v1"),
  EMBEDDING_MODEL: z.string().min(1).default("openai/text-embedding-3-small"),
  SCM_TOKEN: z.string().min(1),
});

export interface McpConfig {
  databaseUrl: string;
  openrouterApiKey: string;
  openrouterBaseUrl: string;
  embeddingModel: string;
  scmToken: string;
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
  return {
    databaseUrl: env.DATABASE_URL,
    openrouterApiKey: env.OPENROUTER_API_KEY,
    openrouterBaseUrl: env.OPENROUTER_BASE_URL,
    embeddingModel: env.EMBEDDING_MODEL,
    scmToken: env.SCM_TOKEN,
  };
}
