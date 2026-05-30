import { notFound } from "next/navigation";
import { MatchDetailView } from "./match-detail-view";

export const dynamic = "force-dynamic";

export default async function MatchDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const matchId = Number(id);
  if (!Number.isFinite(matchId)) notFound();
  return <MatchDetailView matchId={matchId} />;
}
