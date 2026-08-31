import { describe, expect, it, vi } from "vitest";
import { parse } from "pg-connection-string";
import { postgresRuntimeUrl } from "@/lib/postgres-connection";

describe("explicit PostgreSQL certificate verification", () => {
  it.each(["prefer", "require", "verify-ca"])("preserves current pg verification for %s without a deprecation warning", (mode) => {
    const source = `postgresql://test:p%40ss@db.example.invalid:5432/test?schema=public&sslmode=${mode}&channel_binding=require`;
    const warn = vi.spyOn(process, "emitWarning").mockImplementation(() => {});
    try {
      const result = postgresRuntimeUrl(source);
      const parsed = parse(result);
      expect(new URL(result).searchParams.get("sslmode")).toBe("verify-full");
      expect(parsed).toMatchObject({ host: "db.example.invalid", database: "test", password: "p@ss", ssl: {} });
      expect(parsed.ssl).not.toHaveProperty("rejectUnauthorized", false);
      expect(new URL(result).searchParams.get("schema")).toBe("public");
      expect(new URL(result).searchParams.get("channel_binding")).toBe("require");
      expect(warn).not.toHaveBeenCalled();
      expect(source).toContain(`sslmode=${mode}`);
    } finally { warn.mockRestore(); }
  });
  it.each(["", "?sslmode=disable", "?sslmode=verify-full", "?sslmode=require&uselibpqcompat=true"])("preserves the explicit operator policy %s", (query) => {
    const source = `postgresql://test:test@127.0.0.1:1/test${query}`;
    expect(postgresRuntimeUrl(source)).toBe(source);
  });
});
