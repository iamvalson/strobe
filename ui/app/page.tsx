import Dashboard from "./components/Dashboard";
import { Monitor } from "./components/types";

// Server-side: must use absolute URL since rewrites only apply in the browser.
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

async function getInitialMonitors(): Promise<Monitor[]> {
  try {
    const res = await fetch(`${API_BASE}/api/monitors`, {
      next: { revalidate: 0 }, // always fresh
    });
    if (!res.ok) return [];
    // Go marshals a nil slice as JSON `null` — normalise to []
    return (await res.json()) ?? [];
  } catch {
    return [];
  }
}

export default async function Page() {
  const initialMonitors = await getInitialMonitors();
  return <Dashboard initialMonitors={initialMonitors} />;
}
