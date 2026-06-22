import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { searchPlayers } from "../lib/api/client";
import type { PlayerMe } from "../lib/api/types";
import { colors, radius, spacing } from "../lib/theme";

/*
 * Searchable player dropdown. Tap the field to open: it shows the top
 * players right away (browse), and you type to filter the list down. Tap a
 * result to pick it. `excludeIds` hides players already chosen.
 *
 * "Open on focus with an empty query" is what makes it feel like a dropdown
 * rather than a plain search box — searchPlayers("") returns the first
 * players, so there's always something to pick from.
 */
export function PlayerSearch({
  onPick,
  excludeIds = [],
  placeholder = "Tap to choose a player…",
}: {
  onPick: (player: PlayerMe) => void;
  excludeIds?: number[];
  placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  // Enabled whenever the dropdown is open — even with an empty query, so the
  // user can browse before typing.
  const q = useQuery({
    queryKey: ["search-players", debounced],
    queryFn: () => searchPlayers(debounced),
    enabled: open,
  });

  const results = (q.data ?? []).filter((p) => !excludeIds.includes(p.id));

  return (
    <View>
      {/* The field */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          borderWidth: 1,
          borderColor: open ? colors.primary : colors.border,
          borderRadius: radius.md,
          backgroundColor: colors.surface,
          paddingHorizontal: spacing.md,
        }}
      >
        <Ionicons name="search" size={18} color={colors.textMuted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          style={{
            flex: 1,
            height: 44,
            paddingHorizontal: spacing.sm,
            color: colors.text,
          }}
        />
        <Pressable
          onPress={() => {
            if (open) {
              setQuery("");
              setOpen(false);
            } else {
              setOpen(true);
            }
          }}
        >
          <Ionicons
            name={open ? "chevron-up" : "chevron-down"}
            size={18}
            color={colors.textMuted}
          />
        </Pressable>
      </View>

      {/* The dropdown panel */}
      {open ? (
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
              {debounced ? "No players match." : "No players found."}
            </Text>
          ) : (
            results.map((p) => (
              <Pressable
                key={p.id}
                onPress={() => {
                  onPick(p);
                  setQuery("");
                  setOpen(false);
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
