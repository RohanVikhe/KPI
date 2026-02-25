import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { Role } from "@prisma/client";
import { env } from "../config/env.js";
import { prisma } from "../db/prisma.js";
import { AppError } from "../utils/errors.js";

type JwtPayload = {
  sub: string;
  role: Role;
};

export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    throw new AppError("Authorization required", 401, "AUTH_REQUIRED");
  }

  const token = header.slice("Bearer ".length).trim();

  let payload: JwtPayload;
  try {
    payload = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
  } catch {
    throw new AppError("Invalid token", 401, "AUTH_INVALID");
  }

  const user = await prisma.user.findUnique({ where: { id: payload.sub } });
  if (!user || !user.isActive) {
    throw new AppError("User not found or inactive", 401, "AUTH_INVALID");
  }

  req.user = { id: user.id, role: user.role, managerId: user.managerId };
  next();
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      throw new AppError("Authorization required", 401, "AUTH_REQUIRED");
    }
    if (!roles.includes(req.user.role)) {
      throw new AppError("Insufficient permissions", 403, "FORBIDDEN");
    }
    next();
  };
}
