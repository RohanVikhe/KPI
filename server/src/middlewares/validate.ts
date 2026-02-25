import { z } from "zod";
import type { Request, Response, NextFunction } from "express";

type RequestPart = "body" | "params" | "query";

export function validate(part: RequestPart, schema: z.ZodSchema) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[part]);
    if (!result.success) {
      throw result.error;
    }
    (req as Request & Record<string, unknown>)[part] = result.data;
    next();
  };
}

export const validateBody = (schema: z.ZodSchema) => validate("body", schema);
export const validateParams = (schema: z.ZodSchema) => validate("params", schema);
export const validateQuery = (schema: z.ZodSchema) => validate("query", schema);
