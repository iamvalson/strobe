import MonitorDetail from "./MonitorDetail";
import { Monitor } from "../../components/types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

async function getMonitor(id: string): Promise<Monitor | null> {
  try {
    const res = await fetch(`${API_BASE}/api/monitors`, {
      next: { revalidate: 0 },
    });
    if (!res.ok) return null;
    const monitors: Monitor[] | null = await res.json();
    return monitors?.find((m) => m.id === id) ?? null;
  } catch {
    return null;
  }
}

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const monitor = await getMonitor(decodeURIComponent(id));
  return <MonitorDetail monitorId={decodeURIComponent(id)} initialMonitor={monitor} />;
}
