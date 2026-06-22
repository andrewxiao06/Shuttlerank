import { ReactNode } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { colors, spacing } from "../../lib/theme";

/*
 * AsyncBoundary — the loading/error boilerplate every data screen repeated.
 * Pass a query's flags; it renders a spinner while pending, an error message
 * on failure, and your children once data is ready.
 *
 * Usage:
 *   const q = useQuery(...)
 *   return (
 *     <AsyncBoundary isPending={q.isPending} isError={q.isError} error={q.error}>
 *       ...uses q.data...
 *     </AsyncBoundary>
 *   )
 */
export function AsyncBoundary({
  isPending,
  isError,
  error,
  children,
  errorPrefix = "Something went wrong.",
}: {
  isPending: boolean;
  isError: boolean;
  error?: unknown;
  children: ReactNode;
  errorPrefix?: string;
}) {
  if (isPending) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  if (isError) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          padding: spacing.xl,
        }}
      >
        <Text style={{ color: colors.danger, textAlign: "center" }}>
          {errorPrefix}
          {"\n"}
          {(error as Error)?.message ?? ""}
        </Text>
      </View>
    );
  }
  return <>{children}</>;
}
