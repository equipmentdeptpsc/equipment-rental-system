export const PERMISSIONS = {
  dashboard: ["dashboard.read"],
  equipment: [
    "equipment.read",
    "equipment.create",
    "equipment.update",
    "equipment.delete",
    "equipment.restore",
  ],
  assignment: ["assignment.read", "assignment.create", "assignment.manage"],
  rental: [
    "rental.read",
    "rental.create",
    "rental.update",
    "rental.manage",
    "rental.release",
    "rental.activate",
    "rental.return",
    "rental.approve",
    "rental.approval.submit",
    "rental.approval.decide",
    "rental.commercialTerms.manage",
    "rental.customerContact.update",
  ],
  deur: ["deur.read", "deur.create", "deur.review", "deur.correct", "deur.expectation.waive"],
  customer: ["customer.read", "customer.create", "customer.manage"],
  project: ["project.read", "project.manage"],
  operator: ["operator.read", "operator.create", "operator.update", "operator.manage"],
  maintenance: ["maintenance.read", "maintenance.manage"],
  dailyLog: ["dailyLog.read", "dailyLog.manage"],
  billing: ["billing.read", "billing.create", "billing.update"],
  collections: ["collections.read", "collections.manage"],
  reports: ["reports.read", "reports.view"],
  administration: [
    "users.read",
    "users.auditHistory.read",
    "users.deactivate",
    "users.manage",
    "roles.read",
    "roles.manage",
    "permissions.catalog.read",
    "settings.read",
    "settings.update",
    "settings.manage",
    "masterData.read",
    "masterData.create",
    "masterData.update",
    "masterData.manage",
  ],
} as const;

type PermissionGroup = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export type Permission = PermissionGroup[number];

export const ALL_PERMISSIONS: readonly Permission[] = Object.freeze(
  Object.values(PERMISSIONS).flat(),
);

class ImmutablePermissionSet implements ReadonlySet<Permission> {
  readonly #permissions: Set<Permission>;

  constructor(permissions: Iterable<Permission>) {
    this.#permissions = new Set(permissions);
    Object.freeze(this);
  }

  get size(): number {
    return this.#permissions.size;
  }

  has(permission: Permission): boolean {
    return this.#permissions.has(permission);
  }

  entries(): SetIterator<[Permission, Permission]> {
    return this.#permissions.entries();
  }

  keys(): SetIterator<Permission> {
    return this.#permissions.keys();
  }

  values(): SetIterator<Permission> {
    return this.#permissions.values();
  }

  forEach(
    callbackfn: (
      value: Permission,
      value2: Permission,
      set: ReadonlySet<Permission>,
    ) => void,
    thisArg?: unknown,
  ): void {
    this.#permissions.forEach((permission) => {
      callbackfn.call(thisArg, permission, permission, this);
    });
  }

  [Symbol.iterator](): SetIterator<Permission> {
    return this.values();
  }

  get [Symbol.toStringTag](): string {
    return "ImmutablePermissionSet";
  }
}

export function immutablePermissionSet(
  permissions: Iterable<Permission>,
): ReadonlySet<Permission> {
  return new ImmutablePermissionSet(permissions);
}
