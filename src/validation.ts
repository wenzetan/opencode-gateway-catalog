/**
 * Boundary validation primitives.
 *
 * Network JSON is treated as `unknown` until it has passed these functions.
 * The primitives return `undefined` instead of throwing for individual model
 * fields: a bad optional field is not allowed to corrupt the whole catalog.
 * Structural problems (missing ids, duplicate ids, `data` not an array) throw
 * CatalogIntegrityError because the catalog as a whole is untrustworthy.
 */

import { CatalogIntegrityError, ValidationError } from "./errors.js";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? value : undefined;
}

export function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

/** Accepts only finite, safe integers greater than zero. */
export function readPositiveInt(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (!Number.isSafeInteger(value)) return undefined;
  return value > 0 ? value : undefined;
}

/** Accepts only finite, safe integers greater than or equal to zero. */
export function readNonNegativeInt(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (!Number.isSafeInteger(value)) return undefined;
  return value >= 0 ? value : undefined;
}

/** Accepts only finite numbers greater than or equal to zero (pricing may be 0). */
export function readNonNegativeNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return value >= 0 ? value : undefined;
}

/** Accepts an array of non-empty strings. Empty arrays are preserved. */
export function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || item.trim().length === 0) return undefined;
    result.push(item);
  }
  return result;
}

/** Validates the top-level `{ object?: "list", data: unknown[] }` envelope. */
export function readCatalogData(payload: unknown): unknown[] {
  if (!isRecord(payload)) {
    throw new CatalogIntegrityError("catalog response top-level must be a JSON object");
  }
  const data = payload["data"];
  if (!Array.isArray(data)) {
    throw new CatalogIntegrityError('catalog response "data" must be an array');
  }
  return data;
}

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
export function readModelItems(data: readonly unknown[]): RawModelItem[] {
  const items: RawModelItem[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < data.length; index += 1) {
    const item = data[index];
    if (!isRecord(item)) {
      throw new CatalogIntegrityError(`catalog item at index ${index} is not an object`);
    }
    const id = readNonEmptyString(item["id"]);
    if (id === undefined) {
      throw new CatalogIntegrityError(`catalog item at index ${index} has no usable "id"`);
    }
    if (seen.has(id)) {
      throw new CatalogIntegrityError(`duplicate model id "${id}" in catalog response`);
    }
    seen.add(id);
    items.push({ index, item, id });
  }
  return items;
}

export function assertJsonRecord(value: unknown, what: string): Record<string, unknown> {
  if (!isRecord(value)) throw new ValidationError(`${what} must be a JSON object`);
  return value;
}
