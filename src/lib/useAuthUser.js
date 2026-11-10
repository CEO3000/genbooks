import { useEffect, useState } from "react";
import { onAuthStateChanged, signInAnonymously } from "firebase/auth";
import { auth } from "./firebase";

// Every visitor gets a real (anonymous) identity as soon as they land, so
// their in-progress request can be owned by someone from the first click,
// with no separate "logged out" state to design around. Registering later
// upgrades this same identity in place (see /register), so nothing about
// their request changes ownership.
export function useAuthUser() {
  const [user, setUser] = useState(undefined);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    return onAuthStateChanged(auth, async (u) => {
      if (!u) {
        signInAnonymously(auth).catch(() => {});
        return;
      }
      setUser(u);
      // force=true here was unconditionally refreshing the ID token on
      // every single auth-state event, not just the first one - verified
      // for real that a normal sign-in's token already carries the admin
      // custom claim without it. Forcing a refresh is a real, documented
      // way to trigger Firebase's own token-refresh machinery, which can
      // itself re-fire onAuthStateChanged - a real, plausible source of
      // exactly the kind of unexpected re-render a reported bug described
      // (the /support admin toggle reverting on its own after switching
      // views, with no user action). Reading the token as-is avoids that
      // churn; force is only ever needed right after setting a *new*
      // custom claim, which does not happen during normal page use.
      const token = await u.getIdTokenResult();
      setIsAdmin(token.claims.admin === true);
    });
  }, []);

  return { user, isAdmin, isRegistered: Boolean(user && !user.isAnonymous) };
}
