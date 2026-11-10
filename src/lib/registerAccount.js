import {
  EmailAuthProvider, linkWithCredential, createUserWithEmailAndPassword, updateProfile, sendEmailVerification,
} from "firebase/auth";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { auth, db } from "./firebase";

// Turns the visitor into a registered account and sends the "confirm your
// email" message. A visitor who is still anonymous is upgraded in place, so
// anything they already own keeps the same uid. Throws with err.code set
// (Firebase's own codes, plus "disposable-email") for the caller to show.
export async function registerAccount({ fullName, email, password }) {
  const cleanEmail = email.trim();
  const check = await fetch("/api/email-check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: cleanEmail }),
  }).then((r) => r.json());
  if (!check.ok) {
    const err = new Error(check.error);
    err.code = "disposable-email";
    throw err;
  }

  let user;
  if (auth.currentUser?.isAnonymous) {
    const result = await linkWithCredential(auth.currentUser, EmailAuthProvider.credential(cleanEmail, password));
    user = result.user;
  } else {
    user = (await createUserWithEmailAndPassword(auth, cleanEmail, password)).user;
  }

  await updateProfile(user, { displayName: fullName.trim() });
  await setDoc(doc(db, "users", user.uid), { fullName: fullName.trim(), email: cleanEmail, createdAt: serverTimestamp() });
  // The book page offers "send it again" if this one goes astray.
  await sendEmailVerification(user).catch(() => {});
  return user;
}

export function registrationErrorMessage(err) {
  if (err.code === "disposable-email") return err.message;
  if (err.code === "auth/email-already-in-use" || err.code === "auth/credential-already-in-use") {
    return "An account with this email already exists. Choose \"I already have an account\" to sign in instead.";
  }
  if (err.code === "auth/invalid-email") return "Please enter a valid email address.";
  if (err.code === "auth/weak-password") return "Please choose a stronger password (at least 8 characters).";
  return "Could not create your account. Please try again.";
}
