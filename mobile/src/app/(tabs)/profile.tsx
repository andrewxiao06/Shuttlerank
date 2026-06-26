import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Screen } from "../../../components/ui/Screen";
import { AsyncBoundary } from "../../../components/ui/AsyncBoundary";
import { PlayerProfile } from "../../../components/PlayerProfile";
import { getMe } from "../../../lib/api/client";

/*
 * Profile tab — your own profile. Fetches getMe and hands it to the shared
 * PlayerProfile component (the same one used to view other players).
 */
export default function Profile() {
  const router = useRouter();
  const meQ = useQuery({ queryKey: ["me"], queryFn: getMe });

  return (
    <Screen padded={false}>
      <AsyncBoundary
        isPending={meQ.isPending}
        isError={meQ.isError}
        error={meQ.error}
        errorPrefix="Couldn't load your profile."
      >
        {meQ.data ? (
          <PlayerProfile
            player={meQ.data}
            onEdit={() => router.push("/edit-profile")}
          />
        ) : null}
      </AsyncBoundary>
    </Screen>
  );
}
