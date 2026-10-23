/** Browser-side helpers for buttons that fetch a PDF and save it (client components only). */

/** The server's refusal in plain words (the `{ error: { message } }` envelope). */
export async function refusal(res: Response, fallback: string) {
  const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
  return json.error?.message ?? `${fallback} (${res.status}).`;
}

/** Saves a PDF response under the server's file name. */
export async function savePdf(res: Response, fallbackName: string) {
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1];
  const url = URL.createObjectURL(await res.blob());
  Object.assign(document.createElement('a'), { href: url, download: name ?? fallbackName }).click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000); // revoking at once can cancel the download
}
