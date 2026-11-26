"use client";
import { useCallback, useEffect, useState } from "react";
import { useMe } from "@/features/auth/hooks/useAuth";

const key = (userId: string | undefined) => `media.rightsAck.v1:${userId ?? "guest"}`;

/**
 * Has this person confirmed they may download what they pick? Remembered per signed-in user (guests share one
 * slot on the device). `acked` is null until localStorage has been read, so the server and first client render agree.
 */
export function useRightsAck() {
  const me = useMe();
  const userId = me.data?.user?.id;
  const ready = me.isSuccess;
  const [acked, setAcked] = useState<boolean | null>(null);

  useEffect(() => {
    if (!ready) return;
    try {
      setAcked(window.localStorage.getItem(key(userId)) === "1");
    } catch {
      setAcked(false);
    }
  }, [ready, userId]);

  const remember = useCallback(() => {
    setAcked(true);
    try {
      window.localStorage.setItem(key(userId), "1");
    } catch {
      /* private mode: the statement still counts for this visit */
    }
  }, [userId]);

  return { acked, remember };
}
