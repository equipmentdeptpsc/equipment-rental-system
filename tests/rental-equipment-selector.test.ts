import { describe, expect, it } from "vitest";

import type { EquipmentRecord } from "@/features/equipment/types";
import { selectableRentalEquipment } from "@/features/rental/services/selectableRentalEquipment";

const equipment = (overrides: Partial<EquipmentRecord> = {}): EquipmentRecord => ({
  id: "equipment-1",
  prefixId: "prefix-1",
  assetNo: "D3-E1-20260908",
  equipmentName: "D3-E1 — Rental vs Rental",
  category: "Moving Equipment",
  status: undefined as unknown as EquipmentRecord["status"],
  statusId: "status-available",
  maintenanceType: "Engine Hours",
  currentReading: 0,
  projectId: "",
  operatorId: "",
  active: true,
  ...overrides,
});

describe("New Rental selectable Equipment", () => {
  it("keeps a newly-created canonical Equipment visible when the read model supplies statusId rather than a legacy status label", () => {
    expect(selectableRentalEquipment([equipment()]).map((item) => item.id)).toEqual(["equipment-1"]);
  });

  it("does not apply stale current-status or commitment exclusions before canonical interval enforcement", () => {
    const futureCommitted = equipment({ id: "future-commitment", statusId: "status-assigned" });
    expect(selectableRentalEquipment([futureCommitted]).map((item) => item.id)).toEqual(["future-commitment"]);
  });

  it("still excludes inactive and deleted canonical Equipment", () => {
    expect(selectableRentalEquipment([equipment({ active: false }), equipment({ id: "deleted", deleted: true })])).toEqual([]);
  });
});
