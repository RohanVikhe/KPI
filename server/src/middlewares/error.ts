import type { Request, Response, NextFunction } from "express";
import { Prisma } from "@prisma/client";
import jwt from "jsonwebtoken";
import { ZodError } from "zod";
import { env } from "../config/env.js";
import { AppError } from "../utils/errors.js";

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({ error: err.code ?? "APP_ERROR", message: err.message });
  }

  if (err instanceof ZodError) {
    return res.status(400).json({
      error: "VALIDATION_ERROR",
      message: "Validation failed",
      details: err.issues,
    });
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      return res.status(409).json({ error: "CONFLICT", message: "Duplicate value" });
    }
    if (err.code === "P2025") {
      return res.status(404).json({ error: "NOT_FOUND", message: "Record not found" });
    }
  }

  if (err instanceof Error && (err.name === "TokenExpiredError" || err.name === "JsonWebTokenError")) {
    return res.status(401).json({ error: "AUTH_INVALID", message: "Invalid or expired token" });
  }

  if (env.NODE_ENV !== "production") {
    console.error(err);
  }

  return res.status(500).json({ error: "INTERNAL_ERROR", message: "Something went wrong" });
}
