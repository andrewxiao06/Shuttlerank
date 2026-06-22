import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { searchPlayers } from "../lib/api/client";
import type { PlayerMe } from "../lib/api/types";
import { colors, radius, spacing } from "../lib/theme";

/*
 * Debounced player search. Type a name → results appear → tap one to pick it.
 * `excludeIds` hides players already chosen (e.g. on the other team).
 *
 * New RN bits:
 *  - TextInput is the editable text field (RN's <input>).
 *  - We debounce with a setTimeout so we don't fire a request on every
 *    keystroke — only ~250ms after the user stops typing.
 */
export function PlayerSearch({
  onPick,
  excludeIds = [],
  placeholder = "Search players…",
}: {
  onPick: (player: PlayerMe) => void;
  excludeIds?: number[];
  placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  const q = useQuery({
    queryKey: ["search-players", debounced],
    queryFn: () => searchPlayers(debounced),
    enabled: debounced.length > 0,
  });

  const results = (q.data ?? []).filter((p) => !excludeIds.includes(p.id));

  return (
    <View>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        autoCapitalize="none"
        style={{
          height: 44,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: radius.md,
          paddingHorizontal: spacing.md,
          backgroundColor: colors.surface,
          color: colors.text,
        }}
      />

      {debounced.length > 0 ? (
        <View
          style={{
            marginTop: spacing.xs,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: radius.md,
            backgroundColor: colors.surface,
            overflow: "hidden",
          }}
        >
          {q.isPending ? (
            <View style={{ padding: spacing.md }}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : results.length === 0 ? (
            <Text style={{ padding: spacing.md, color: colors.textMuted }}>
              No players found.
            </Text>
          ) : (
            results.map((p) => (
              <Pressable
                key={p.id}
                onPress={() => {
                  onPick(p);
                  setQuery("");
                  setDebounced("");
                }}
                style={{
                  padding: spacing.md,
                  borderBottomWidth: 1,
                  borderBottomColor: colors.border,
                }}
              >
                <Text style={{ color: colors.text, fontSize: 15 }}>
                  {p.display_name ?? p.name}
                </Text>
              </Pressable>
            ))
          )}
        </View>
      ) : null}
    </View>
  );
}
