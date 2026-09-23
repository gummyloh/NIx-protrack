"use client";

import { createContext, useContext } from "react";

export type UserRole =
  | "admin"
  | "finance"
  | "procurement"
  | "mechanical"
  | "electrical"
  | "wiring"
  | "assembly"
  | "software"
  | "member";

export const ROLE_LABELS: Record<UserRole, string> = {
  admin:       "Admin",
  finance:     "Finance",
  procurement: "Procurement",
  mechanical:  "Mechanical",
  electrical:  "Electrical",
  wiring:      "Wiring",
  assembly:    "Assembly",
  software:    "Software",
  member:      "Member",
};

interface InternalAuthValue {
  role: UserRole;
  isAdmin: boolean;
  canViewFinance: boolean;      // Margin + Procurement
  canViewProcurement: boolean;  // Procurement only
}

const defaults: InternalAuthValue = {
  role: "member",
  isAdmin: false,
  canViewFinance: false,
  canViewProcurement: false,
};

const InternalAuthContext = createContext<InternalAuthValue>(defaults);

export function roleToPerms(role: UserRole): InternalAuthValue {
  return {
    role,
    isAdmin:           role === "admin",
    canViewFinance:    role === "admin" || role === "finance",
    canViewProcurement: role === "admin" || role === "finance" || role === "procurement",
  };
}

export function InternalAuthProvider({
  value,
  children,
}: {
  value: InternalAuthValue;
  children: React.ReactNode;
}) {
  return (
    <InternalAuthContext.Provider value={value}>
      {children}
    </InternalAuthContext.Provider>
  );
}

/** Access the signed-in internal user's role and permission flags from any /internal page. */
export function useInternalAuth(): InternalAuthValue {
  return useContext(InternalAuthContext);
}
