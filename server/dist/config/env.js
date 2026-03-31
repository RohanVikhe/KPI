import "dotenv/config";
import { z } from "zod";
const envSchema = z.object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().default(4000),
    DATABASE_URL: z.string().min(1),
    JWT_SECRET: z.string().min(32),
    JWT_EXPIRES_IN: z.string().default("1d"),
    CORS_ORIGIN: z.string().default("http://localhost:5173"),
});
const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
    console.error("Invalid environment variables", parsed.error.flatten().fieldErrors);
    throw new Error("Invalid environment variables");
}
export const env = parsed.data;
