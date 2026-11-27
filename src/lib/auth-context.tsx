"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { auth, db, firebaseConfigured } from "./firebase";
import { can, seesMoney, seesNonGst, type Action, type Role, type UserProfile } from "./permissions";
import type { ModuleKey } from "./modules";

interface AuthState {
  loading: boolean;
  user: User | null;
  profile: UserProfile | null;
  role: Role | null;
  can: (m: ModuleKey, a: Action) => boolean;
  nonGst: boolean;
  /** Can see money (project values, commercial documents, figures). */
  money: boolean;
  isAdmin: boolean;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [profileReady, setProfileReady] = useState(false);

  useEffect(() => {
    if (!firebaseConfigured) {
      setAuthReady(true);
      return;
    }
    return onAuthStateChanged(auth(), (u) => {
      setUser(u);
      setAuthReady(true);
      if (!u) {
        setProfile(null);
        setRole(null);
        setProfileReady(true);
      } else {
        setProfileReady(false);
      }
    });
  }, []);

  useEffect(() => {
    if (!user) return;
    return onSnapshot(
      doc(db(), "users", user.uid),
      (s) => {
        setProfile(s.exists() ? ({ uid: s.id, ...s.data() } as UserProfile) : null);
        if (!s.exists()) setProfileReady(true);
      },
      () => setProfileReady(true),
    );
  }, [user]);

  useEffect(() => {
    if (!profile?.roleId) return;
    return onSnapshot(
      doc(db(), "roles", profile.roleId),
      (s) => {
        setRole(s.exists() ? ({ id: s.id, ...s.data() } as Role) : null);
        setProfileReady(true);
      },
      () => setProfileReady(true),
    );
  }, [profile?.roleId]);

  const activeRole = profile?.active ? role : null;
  const value: AuthState = {
    loading: !authReady || (Boolean(user) && !profileReady),
    user,
    profile,
    role: activeRole,
    can: (m, a) => can(activeRole, m, a),
    nonGst: seesNonGst(activeRole),
    money: seesMoney(activeRole),
    isAdmin: Boolean(activeRole?.isAdmin),
    logout: () => signOut(auth()),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used inside AuthProvider");
  return v;
}
