"use client";

import { useEffect, useState } from "react";
import {
  collection,
  doc,
  onSnapshot,
  query,
  where,
  type QueryConstraint,
} from "firebase/firestore";
import { db } from "./firebase";
import { useAuth } from "./auth-context";
import type { Doc } from "./data";

interface Opts {
  /** Collection holds GST and non-GST records (field `billingType`). */
  gstAware?: boolean;
  /** Include soft-deleted records. */
  includeDeleted?: boolean;
  enabled?: boolean;
}

/**
 * Live collection query. For GST-aware collections, users without the non-GST
 * permission only query GST records (the security rules enforce the same).
 */
export function useCollection(col: string, constraints: QueryConstraint[] = [], opts: Opts = {}, deps: unknown[] = []) {
  const { nonGst, user } = useAuth();
  const [rows, setRows] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const enabled = opts.enabled !== false && Boolean(user);

  useEffect(() => {
    if (!enabled) return;
    const cs = [...constraints];
    if (opts.gstAware && !nonGst) cs.push(where("billingType", "==", "gst"));
    setLoading(true);
    return onSnapshot(
      query(collection(db(), col), ...cs),
      (s) => {
        let r = s.docs.map((d) => ({ id: d.id, ...d.data() }) as Doc);
        if (!opts.includeDeleted) r = r.filter((d) => !d.deleted);
        setRows(r);
        setLoading(false);
        setError(null);
      },
      (e) => {
        setError(e.message);
        setLoading(false);
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [col, nonGst, enabled, ...deps]);

  return { rows, loading, error };
}

export function useDoc(col: string, id: string | undefined) {
  const { user } = useAuth();
  const [data, setData] = useState<Doc | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!id || !user) return;
    return onSnapshot(
      doc(db(), col, id),
      (s) => {
        setData(s.exists() ? ({ id: s.id, ...s.data() } as Doc) : null);
        setLoading(false);
      },
      (e) => {
        setError(e.message);
        setLoading(false);
      },
    );
  }, [col, id, user]);
  return { data, loading, error };
}
