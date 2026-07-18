export interface StudioLaunchSession {
  token: string;
  fileName: string;
  sourcePath: string;
  html: string;
  revision: string;
}

interface SaveResponse {
  saved: boolean;
  sourcePath: string;
  revision: string;
}

const endpoint = "/api/studio-session";

async function responseJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error || `Studio launch bridge failed with ${response.status}.`);
  }
  return response.json() as Promise<T>;
}

export function launchToken(search = window.location.search): string | null {
  const token = new URLSearchParams(search).get("session")?.trim();
  return token || null;
}

export async function loadLaunchSession(token: string, fetcher: typeof fetch = fetch): Promise<StudioLaunchSession> {
  const response = await fetcher(`${endpoint}?token=${encodeURIComponent(token)}`, {
    headers: { "x-slides-studio-session": token },
    cache: "no-store",
  });
  const payload = await responseJson<Omit<StudioLaunchSession, "token">>(response);
  if (!payload.fileName || !payload.sourcePath || typeof payload.html !== "string" || !payload.revision) throw new Error("Studio launch bridge returned an incomplete session.");
  return { token, ...payload };
}

export async function saveLaunchSession(session: Pick<StudioLaunchSession, "token">, html: string, fetcher: typeof fetch = fetch): Promise<SaveResponse> {
  const response = await fetcher(`${endpoint}?token=${encodeURIComponent(session.token)}`, {
    method: "PUT",
    headers: { "x-slides-studio-session": session.token, "content-type": "application/json" },
    body: JSON.stringify({ html }),
  });
  const result = await responseJson<SaveResponse>(response);
  if (!result.saved || !result.sourcePath || !result.revision) throw new Error("Studio launch bridge returned an incomplete save result.");
  return result;
}
