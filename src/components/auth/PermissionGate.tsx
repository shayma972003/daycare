"use client";

import type { ReactNode } from "react";
import { grants } from "@/lib/permissions";
import { usePermissions, type PermissionStatus } from "@/lib/use-permissions";

export interface PermissionGateProps {
  children?: ReactNode;
  /** A single required permission. */
  permission?: string;
  /** Alternatively, access when at least one permission is held. */
  anyOf?: readonly string[];
  /** Safe, non-protected content to show when access is unavailable. */
  fallback?: ReactNode;
}

export function permits(
  held: readonly string[],
  permission?: string,
  anyOf: readonly string[] = []
): boolean {
  const required = permission ? [permission, ...anyOf] : [...anyOf];
  return required.length > 0 && required.some((key) => grants([...held], key));
}

/**
 * Pure rendering half, exported so the secure loading/error behaviour can be
 * tested with React's server renderer without a browser test dependency.
 */
export function PermissionGateResult({
  children,
  permission,
  anyOf,
  fallback = null,
  status,
  permissions,
}: PermissionGateProps & {
  status: PermissionStatus;
  permissions: readonly string[];
}) {
  if (status !== "ready" || !permits(permissions, permission, anyOf)) return fallback;
  return children;
}

export function PermissionGate(props: PermissionGateProps) {
  const { me, status } = usePermissions();
  return (
    <PermissionGateResult
      {...props}
      status={status}
      permissions={me?.permissions ?? []}
    />
  );
}

export const Can = PermissionGate;
