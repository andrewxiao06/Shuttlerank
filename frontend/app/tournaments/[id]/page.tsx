import { notFound } from "next/navigation";
import { TournamentDetailView } from "./tournament-detail-view";

export const dynamic = "force-dynamic";

export default async function TournamentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tid = Number(id);
  if (!Number.isFinite(tid)) notFound();
  return <TournamentDetailView tournamentId={tid} />;
}
