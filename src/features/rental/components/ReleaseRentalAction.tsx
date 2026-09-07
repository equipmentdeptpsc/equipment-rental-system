import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";

import Button from "@/components/ui/Button";
import Select from "@/components/ui/Select";
import { useToast } from "@/components/ui/toast/ToastContext";
import { useAuth } from "@/features/auth/AuthContext";
import { useRental } from "@/features/rental/context/RentalContext";
import { useApplicationDependenciesCompatibility } from "@/app/composition";
import { canUseCanonicalRemoteRentalMutations, canUseCanonicalRemoteRentalReleaseMutation, canUseLegacyRentalMutations } from "@/features/rental/services/rentalRuntimeCapability";
import { requestCanonicalRentalRefresh } from "@/features/rental/remote/canonicalRentalRefresh";

interface Props {
  rentalId: string;
}

export default function ReleaseRentalAction({ rentalId }: Props) {
  const dependencies = useApplicationDependenciesCompatibility();
  const { configuration } = dependencies;
  const legacyMutations = canUseLegacyRentalMutations(configuration);
  const canonicalMutations = (canUseCanonicalRemoteRentalMutations(configuration) || canUseCanonicalRemoteRentalReleaseMutation(configuration)) && Boolean(dependencies.commandRepositories.canonicalRental);
  const mutationsAvailable = legacyMutations || canonicalMutations;
  const { user, hasPermission } = useAuth();
  const { releaseRental } = useRental();
  const { showToast } = useToast();
  const location = useLocation();
  const adminUsers = useMemo(() => user ? [user] : [], [user]);
  const [releasedById, setReleasedById] = useState("");
  const [pending, setPending] = useState(false);
  const identity = useRef<{ commandId: string; idempotencyKey: string } | undefined>(undefined);

  useEffect(() => {
    setReleasedById(adminUsers[0]?.id ?? "");
  }, [adminUsers]);

  if (!mutationsAvailable) return null;
  if (canonicalMutations) return hasPermission("rental.release") ? <Button variant="secondary" disabled={pending} onClick={async () => {
    if (pending) return; setPending(true);
    const rental = await dependencies.readRepositories.rentals.getById(rentalId);
    if (!rental.success || !rental.value || typeof rental.value.rowVersion !== "number") { showToast("Canonical Rental version is unavailable. Refresh and try again.", "error"); setPending(false); return; }
    const commandIdentity = identity.current ??= { commandId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID() };
    const result = await dependencies.commandRepositories.canonicalRental!.release({ ...commandIdentity, rentalId, expectedVersion: rental.value.rowVersion });
    if (result.success) { identity.current = undefined; requestCanonicalRentalRefresh(); }
    showToast(result.success ? "Equipment released successfully." : result.message, result.success ? "success" : "error"); setPending(false);
  }}>{pending ? "Releasing…" : "Release"}</Button> : null;

  if (adminUsers.length === 0) {
    return (
      <p className="text-sm text-amber-700">
        {user ? "Only an Admin can release this equipment." : "Sign in as Admin to release this equipment. "}
        {!user && <Link className="underline font-medium" to={`/login?returnTo=${encodeURIComponent(location.pathname + location.search)}`}>Sign in</Link>}
      </p>
    );
  }

  function release() {
    const admin = adminUsers.find((candidate) => candidate.id === releasedById);
    const result = releaseRental(rentalId, admin?.name ?? "");

    if (!result.success) {
      showToast(result.message ?? "Unable to release equipment.", "error");
      return;
    }

    showToast("Equipment released successfully.", "success");
  }

  return (
    <div className="flex items-end gap-2">
      <Select
        label="Released By"
        value={releasedById}
        options={adminUsers.map((admin) => ({ value: admin.id, label: admin.name }))}
        onChange={(event) => setReleasedById(event.target.value)}
      />
      <Button variant="secondary" onClick={release}>Release</Button>
    </div>
  );
}
