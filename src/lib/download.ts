/** Trigger a client-side file download of `content` as `filename`. */
export function downloadText(
  filename: string,
  content: string,
  mime = "application/x-ndjson",
): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick so the click has definitely started the download.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
