import { collection, doc, getDoc, getDocs, orderBy, query } from "firebase/firestore";
import { db } from "./firebase";

const MIME = {
  epub: "application/epub+zip",
  pdf: "application/pdf",
  front_cover: "image/jpeg",
  back_cover: "image/jpeg",
  paperback_cover: "image/jpeg",
};

const EXT = {
  epub: "epub",
  pdf: "pdf",
  front_cover: "jpg",
  back_cover: "jpg",
  paperback_cover: "jpg",
};

function base64ToBlob(base64, mimeType) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

export async function fetchDeliveryFileUrl(requestId, fileKey) {
  const fileDoc = await getDoc(doc(db, "requests", requestId, "files", fileKey));
  if (!fileDoc.exists()) return null;

  const chunksSnap = await getDocs(
    query(collection(db, "requests", requestId, "files", fileKey, "chunks"), orderBy("index"))
  );
  const base64 = chunksSnap.docs.map((d) => d.data().data).join("");
  const mimeType = fileDoc.data().mimeType || MIME[fileKey] || "application/octet-stream";
  return URL.createObjectURL(base64ToBlob(base64, mimeType));
}

export async function downloadDeliveryFile(requestId, fileKey, fileNamePrefix) {
  const fileDoc = await getDoc(doc(db, "requests", requestId, "files", fileKey));
  if (!fileDoc.exists()) throw new Error(`${fileKey} is not ready yet`);

  const chunksSnap = await getDocs(
    query(collection(db, "requests", requestId, "files", fileKey, "chunks"), orderBy("index"))
  );
  const base64 = chunksSnap.docs.map((d) => d.data().data).join("");

  const mimeType = fileDoc.data().mimeType || MIME[fileKey] || "application/octet-stream";
  const blob = base64ToBlob(base64, mimeType);
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `${fileNamePrefix}-${fileKey}.${EXT[fileKey] || "bin"}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
