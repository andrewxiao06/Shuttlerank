import { notFound } from "next/navigation";
import { ProfileView } from "./profile-view";

/*
 * Profile route — Next 16 passes `params` as a Promise; we resolve the
 * id server-side, validate, then hand off to the client view which owns
 * the category selector + match list.
 */
export default async function PlayerProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const playerId = Number(id);
  if (!Number.isFinite(playerId)) notFound();
  return <ProfileView playerId={playerId} />;
}
