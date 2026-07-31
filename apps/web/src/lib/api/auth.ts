import { apiRequest } from "@/lib/api/client";
import type { AuthUser } from "@/lib/api/types";

export function getMeApi() {
  return apiRequest<AuthUser | null>("/v1/auth/me");
}

export function loginApi(email: string, password: string) {
  return apiRequest<{ user: AuthUser }>("/v1/auth/login", {
    method: "POST",
    body: { email, password },
  });
}

export function registerApi(email: string, password: string) {
  return apiRequest<{ user: AuthUser }>("/v1/auth/register", {
    method: "POST",
    body: { email, password },
  });
}

export function logoutApi() {
  return apiRequest<void>("/v1/auth/logout", { method: "POST" });
}
