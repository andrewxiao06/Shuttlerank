import { Placeholder } from "../../../components/Placeholder";

// 🎓 YOUR SCREEN (Phase 3). Build the leaderboard here.
//
// Hints when you're ready:
//   - Data: import { getLeaderboard } from "../../../lib/api/client"
//           import { useQuery } from "@tanstack/react-query"
//           const q = useQuery({ queryKey: ["leaderboard"], queryFn: () => getLeaderboard() })
//   - Render q.data.entries with a <FlatList> (RN's efficient scrolling list).
//   - Each row: rank, name, formatRating(entry.display), tierLabel(entry.display).
//     (import those from "../../../lib/format")
//   - Dim calibrating rows (entry.calibrating) and you can highlight "you" later.
export default function Leaderboard() {
  return (
    <Placeholder
      title="Leaderboard"
      subtitle="🎓 Your screen to build. See the hints in this file's comments."
    />
  );
}
