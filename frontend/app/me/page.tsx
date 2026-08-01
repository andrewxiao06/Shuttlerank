import { Suspense } from "react";
import { MeSettingsView } from "./me-view";

// MeSettingsView reads useSearchParams (the ?next= redirect), so it needs a
// Suspense boundary now that the page is statically prerendered.
export default function MePage() {
  return (
    <Suspense>
      <MeSettingsView />
    </Suspense>
  );
}
