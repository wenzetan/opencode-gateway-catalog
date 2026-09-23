/**
 * Boundary validation primitives.
 *
 * Network JSON is treated as `unknown` until it has passed these functions.
 * The primitives return `undefined` instead of throwing for individual model
 * fields: a bad optional field is not allowed to corrupt the whole catalog.
 * Structural problems (missing ids, duplicate ids, `data` not an array) throw
 * CatalogIntegrityError because the catalog as a whole is untrustworthy.
 */
export declare function isRecord(value: unknown): value is Record<string, unknown>;
export declare function readNonEmptyString(value: unknown): string | undefined;
export declare function readBoolean(value: unknown): boolean | undefined;
/** Accepts only finite, safe integers greater than zero. */
export declare function readPositiveInt(value: unknown): number | undefined;
/** Accepts only finite, safe integers greater than or equal to zero. */
export declare function readNonNegativeInt(value: unknown): number | undefined;
/** Accepts only finite numbers greater than or equal to zero (pricing may be 0). */
export declare function readNonNegativeNumber(value: unknown): number | undefined;
/** Accepts an array of non-empty strings. Empty arrays are preserved. */
export declare function readStringArray(value: unknown): string[] | undefined;
/** Validates the top-level `{ object?: "list", data: unknown[] }` envelope. */
export declare function readCatalogData(payload: unknown): unknown[];
export interface RawModelItem {
    readonly index: number;
    readonly item: Record<string, unknown>;
    readonly id: string;
}
/**
 * Validates every item is an object with a non-empty string id and that ids are
 * unique. Duplicate or missing ids reject the whole refresh (a gateway that
 * returns them has a bug and its catalog cannot be trusted).
 */
export declare function readModelItems(data: readonly unknown[]): RawModelItem[];
export declare function assertJsonRecord(value: unknown, what: string): Record<string, unknown>;
//# sourceMappingURL=validation.d.ts.map