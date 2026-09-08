import type { EquipmentRecord } from "@/features/equipment/types";

/**
 * New Rental does not have a complete requested interval while this list is
 * built. Keep the canonical active fleet visible; the canonical create command
 * remains responsible for interval enforcement at submission time.
 */
export function selectableRentalEquipment(equipment: readonly EquipmentRecord[]): EquipmentRecord[] {
  return equipment.filter((item) => item.active !== false && !item.deleted);
}
