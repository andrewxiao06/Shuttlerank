import { Placeholder } from "../../../components/Placeholder";

// 🎓 YOUR SCREEN (Phase 3). Build the profile here.
//
// Hints when you're ready (do this AFTER auth lands in Phase 2, so getMe works):
//   - Data: import { getMe } from "../../../lib/api/client"
//           const q = useQuery({ queryKey: ["me"], queryFn: getMe })
//   - The player's single rating is q.data.ratings[0].
//   - Hero: big formatRating(rating.display) + tierLabel(rating.display).
//     (import from "../../../lib/format")
//   - Show rating.match_count and an isCalibrating(rating.rd) badge.
export default function Profile() {
  return (
    <Placeholder
      title="Profile"
      subtitle="🎓 Your screen to build. See the hints in this file's comments."
    />
  );
}
