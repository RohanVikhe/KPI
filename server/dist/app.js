import express from "express";
import cors from "cors";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import "express-async-errors";
import routes from "./routes/index.js";
import { env } from "./config/env.js";
import { errorHandler } from "./middlewares/error.js";
export const app = express();
const allowedOrigins = env.CORS_ORIGIN.split(",").map((origin) => origin.trim());
app.use(helmet());
app.use(cors({
    origin: allowedOrigins,
    credentials: true,
    exposedHeaders: ["Content-Disposition"],
}));
app.use(express.json({ limit: "1mb" }));
app.use(pinoHttp());
app.get("/health", (_req, res) => res.json({ status: "ok" }));
app.use("/api", routes);
app.use(errorHandler);
