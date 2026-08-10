import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  PermissionGateResult,
  permits,
} from "@/components/auth/PermissionGate";

function renderGate({
  status = "ready",
  permissions = [],
  permission,
  anyOf,
  fallback,
}: {
  status?: "idle" | "loading" | "ready" | "error";
  permissions?: string[];
  permission?: string;
  anyOf?: string[];
  fallback?: React.ReactNode;
}) {
  return renderToStaticMarkup(
    React.createElement(
      PermissionGateResult,
      { status, permissions, permission, anyOf, fallback },
      React.createElement("button", null, "protected-action")
    )
  );
}

describe("PermissionGate", () => {
  it("hides an action without its permission and renders it when granted", () => {
    expect(renderGate({ permission: "students.manage" })).not.toContain("protected-action");
    expect(
      renderGate({ permission: "students.manage", permissions: ["students.manage"] })
    ).toContain("protected-action");
  });

  it.each(["idle", "loading", "error"] as const)(
    "does not render protected content while status is %s",
    (status) => {
      expect(
        renderGate({ status, permission: "students.manage", permissions: ["students.manage"] })
      ).not.toContain("protected-action");
    }
  );

  it("honours wildcard, any-of and fallback", () => {
    expect(renderGate({ permission: "schedule.delete", permissions: ["*"] })).toContain(
      "protected-action"
    );
    expect(
      renderGate({ anyOf: ["classes.manage", "classes.assign"], permissions: ["classes.assign"] })
    ).toContain("protected-action");
    expect(
      renderGate({ permission: "staff.delete", fallback: React.createElement("span", null, "safe") })
    ).toContain("safe");
    expect(permits(["*"], "anything.added.later")).toBe(true);
  });
});
