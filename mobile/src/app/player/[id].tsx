import { useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { PlayerProfile } from "../../../components/PlayerProfile";
import { colors } from "../../../lib/theme";

/*
 * View any player's profile by id. Reached from the player search on the
 * Leaderboard. Reuses the shared PlayerProfile component.
 */
export default function PlayerById() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={["bottom"]}>
      <PlayerProfile playerId={Number(id)} />
    </SafeAreaView>
  );
}
