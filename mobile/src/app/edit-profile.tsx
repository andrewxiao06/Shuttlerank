import { useUser } from "@clerk/clerk-expo";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Avatar } from "../../components/ui/Avatar";
import { Button } from "../../components/ui/Button";
import { getMe, patchMe } from "../../lib/api/client";
import type { PlayerGender } from "../../lib/api/types";
import { colors, radius, spacing } from "../../lib/theme";

const GENDERS: { value: PlayerGender; label: string }[] = [
  { value: "M", label: "Man" },
  { value: "W", label: "Woman" },
  { value: "X", label: "Prefer not to say" },
];

const LEVELS = [1.0, 2.0, 3.0, 3.5, 4.0, 4.5];

/*
 * Edit your profile — display name, photo, age, location, gender, and
 * (before your first match) starting level. Photo upload goes through
 * Clerk's image hosting, then syncs the URL into our backend.
 */
export default function EditProfile() {
  const router = useRouter();
  const qc = useQueryClient();
  const { user } = useUser();
  const meQ = useQuery({ queryKey: ["me"], queryFn: getMe });

  const [displayName, setDisplayName] = useState("");
  const [age, setAge] = useState("");
  const [location, setLocation] = useState("");
  const [gender, setGender] = useState<PlayerGender | "">("");
  const [level, setLevel] = useState<number | null>(null);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);

  useEffect(() => {
    if (meQ.data) {
      setDisplayName(meQ.data.display_name ?? meQ.data.name ?? "");
      setAge(meQ.data.age != null ? String(meQ.data.age) : "");
      setLocation(meQ.data.location ?? "");
      setGender((meQ.data.gender as PlayerGender | null) ?? "");
      setLevel(meQ.data.ratings[0]?.display ?? null);
      setAvatar(meQ.data.avatar_url ?? null);
    }
  }, [meQ.data]);

  const canPickLevel = (meQ.data?.ratings[0]?.match_count ?? 0) === 0;

  const save = useMutation({
    mutationFn: () =>
      patchMe({
        display_name: displayName.trim() || null,
        age: age.trim() ? Number(age) : null,
        location: location.trim() || null,
        gender: gender || null,
        starting_rating: canPickLevel && level != null ? level : undefined,
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["me"] });
      router.back();
    },
  });

  const [photoError, setPhotoError] = useState<string | null>(null);

  async function pickPhoto() {
    if (!user) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setPhotoError("Photo permission denied — enable it in Settings.");
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.6,
    });
    if (res.canceled || !res.assets[0]?.uri) return;
    setPhotoBusy(true);
    setPhotoError(null);
    try {
      // Clerk accepts a Blob; fetch the picked file URI into one.
      const blob = await (await fetch(res.assets[0].uri)).blob();
      await user.setProfileImage({ file: blob });
      await user.reload();
      await patchMe({ avatar_url: user.imageUrl });
      setAvatar(user.imageUrl);
      // Match rows embed the avatar url too — refresh everything, not just me.
      await qc.invalidateQueries();
    } catch (e) {
      setPhotoError((e as Error)?.message ?? "Couldn't upload photo.");
    } finally {
      setPhotoBusy(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={["bottom"]}>
      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.lg }}
        keyboardShouldPersistTaps="handled"
      >
        {/* Photo */}
        <View style={{ alignItems: "center", gap: spacing.sm }}>
          <Avatar src={avatar} name={displayName} size={88} />
          <Pressable onPress={pickPhoto} disabled={photoBusy}>
            <Text style={{ color: colors.primary, fontWeight: "600" }}>
              {photoBusy ? "Uploading…" : "Change photo"}
            </Text>
          </Pressable>
          {photoError ? (
            <Text style={{ color: colors.danger, fontSize: 12, textAlign: "center" }}>
              {photoError}
            </Text>
          ) : null}
        </View>

        <Field label="Display name">
          <TextInput
            value={displayName}
            onChangeText={(t) => setDisplayName(t.slice(0, 120))}
            placeholder="e.g. A. Xiao"
            placeholderTextColor={colors.textMuted}
            style={inputStyle}
          />
        </Field>

        <View style={{ flexDirection: "row", gap: spacing.md }}>
          <View style={{ flex: 1 }}>
            <Field label="Age">
              <TextInput
                value={age}
                onChangeText={(t) => setAge(t.replace(/[^0-9]/g, "").slice(0, 3))}
                keyboardType="number-pad"
                placeholder="27"
                placeholderTextColor={colors.textMuted}
                style={inputStyle}
              />
            </Field>
          </View>
          <View style={{ flex: 2 }}>
            <Field label="Location">
              <TextInput
                value={location}
                onChangeText={(t) => setLocation(t.slice(0, 120))}
                placeholder="NJ, US"
                placeholderTextColor={colors.textMuted}
                style={inputStyle}
              />
            </Field>
          </View>
        </View>

        <Field label="Gender (optional)">
          <View style={{ flexDirection: "row", gap: spacing.sm }}>
            {GENDERS.map((g) => (
              <Pressable
                key={g.value}
                onPress={() => setGender(g.value)}
                style={{
                  flex: 1,
                  paddingVertical: spacing.sm,
                  borderRadius: radius.md,
                  borderWidth: 1,
                  alignItems: "center",
                  borderColor: gender === g.value ? colors.primary : colors.border,
                  backgroundColor: gender === g.value ? colors.accentSoft : colors.surface,
                }}
              >
                <Text style={{ color: gender === g.value ? colors.primary : colors.text, fontSize: 12 }}>
                  {g.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </Field>

        {canPickLevel ? (
          <Field label="Starting level">
            <Text style={{ color: colors.textMuted, fontSize: 12, marginBottom: spacing.sm }}>
              Rate yourself honestly — locks once you play a match.
            </Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
              {LEVELS.map((l) => (
                <Pressable
                  key={l}
                  onPress={() => setLevel(l)}
                  style={{
                    paddingVertical: spacing.sm,
                    paddingHorizontal: spacing.md,
                    borderRadius: radius.md,
                    borderWidth: 1,
                    borderColor: level === l ? colors.primary : colors.border,
                    backgroundColor: level === l ? colors.accentSoft : colors.surface,
                  }}
                >
                  <Text style={{ color: level === l ? colors.primary : colors.text }}>
                    {l.toFixed(1)}
                  </Text>
                </Pressable>
              ))}
            </View>
          </Field>
        ) : null}

        {save.isError ? (
          <Text style={{ color: colors.danger }}>
            Couldn&apos;t save: {(save.error as Error).message}
          </Text>
        ) : null}

        <Button
          label={save.isPending ? "Saving…" : "Save"}
          onPress={() => save.mutate()}
          disabled={!displayName.trim()}
          loading={save.isPending}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: spacing.xs }}>
      <Text style={{ color: colors.textSecondary, fontSize: 13, textTransform: "uppercase" }}>
        {label}
      </Text>
      {children}
    </View>
  );
}

const inputStyle = {
  height: 48,
  borderWidth: 1,
  borderColor: colors.border,
  borderRadius: radius.md,
  paddingHorizontal: spacing.md,
  backgroundColor: colors.surface,
  color: colors.text,
  fontSize: 16,
} as const;
