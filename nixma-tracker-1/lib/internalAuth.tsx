"use client";

import { createContext, useContext } from "react";

interface InternalAuthValue {
  isAdmin: boolean;
}

const InternalAuthContext = createContext<InternalAuthValue>({ isAdmin: false });

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

/** Access the signed-in internal user's admin flag from any /internal page. */
export function useInternalAuth(): InternalAuthValue {
  return useContext(InternalAuthContext);
}
