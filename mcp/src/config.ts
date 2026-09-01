import { z } from "zod";

const envSchema = z.object({
  API_URL: z.string().url(),
  SCM_TOKEN: z.string().min(1),
});

export interface McpConfig {
  apiUrl: string;
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
  return { apiUrl: env.API_URL, scmToken: env.SCM_TOKEN };
}