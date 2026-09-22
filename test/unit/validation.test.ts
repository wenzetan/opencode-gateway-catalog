import assert from "node:assert/strict";
import { test } from "node:test";
import { CatalogIntegrityError } from "../../src/errors.js";
import {
  isRecord,
  readBoolean,
  readCatalogData,
  readModelItems,
  readNonEmptyString,
  readNonNegativeInt,
  readNonNegativeNumber,
  readPositiveInt,
  readStringArray,
} from "../../src/validation.js";

test("isRecord only accepts plain objects", () => {
  assert.equal(isRecord({}), true);
  assert.equal(isRecord([]), false);
  assert.equal(isRecord(null), false);
  assert.equal(isRecord("x"), false);
});

test("readPositiveInt accepts safe positive integers only", () => {
  assert.equal(readPositiveInt(1), 1);
  assert.equal(readPositiveInt(100_000), 100_000);
  assert.equal(readPositiveInt(0), undefined);
  assert.equal(readPositiveInt(-1), undefined);
  assert.equal(readPositiveInt(1.5), undefined);
  assert.equal(readPositiveInt(Number.NaN), undefined);
  assert.equal(readPositiveInt(Number.POSITIVE_INFINITY), undefined);
  assert.equal(readPositiveInt("1000000"), undefined);
  assert.equal(readPositiveInt(Number.MAX_SAFE_INTEGER + 1), undefined);
  assert.equal(readPositiveInt(null), undefined);
});

test("readNonNegativeNumber accepts zero (free pricing) but rejects negatives/NaN", () => {
  assert.equal(readNonNegativeNumber(0), 0);
  assert.equal(readNonNegativeNumber(1.25), 1.25);
  assert.equal(readNonNegativeNumber(-0.01), undefined);
  assert.equal(readNonNegativeNumber(Number.NaN), undefined);
  assert.equal(readNonNegativeNumber(Number.NEGATIVE_INFINITY), undefined);
  assert.equal(readNonNegativeNumber("1"), undefined);
});

test("readNonNegativeInt and readBoolean", () => {
  assert.equal(readNonNegativeInt(0), 0);
  assert.equal(readNonNegativeInt(-1), undefined);
  assert.equal(readBoolean(true), true);
  assert.equal(readBoolean(false), false);
  assert.equal(readBoolean("true"), undefined);
});

test("readStringArray keeps empty arrays but rejects bad items", () => {
  assert.deepEqual(readStringArray(["text", "image"]), ["text", "image"]);
  assert.deepEqual(readStringArray([]), []);
  assert.equal(readStringArray(["text", ""]), undefined);
  assert.equal(readStringArray(["text", 1]), undefined);
  assert.equal(readStringArray("text"), undefined);
});

test("readNonEmptyString trims only for validation", () => {
  assert.equal(readNonEmptyString(" abc "), " abc ");
  assert.equal(readNonEmptyString("   "), undefined);
  assert.equal(readNonEmptyString(""), undefined);
  assert.equal(readNonEmptyString(12), undefined);
});

test("readCatalogData enforces the top-level envelope", () => {
  assert.deepEqual(readCatalogData({ data: [] }), []);
  assert.throws(() => readCatalogData([]), CatalogIntegrityError);
  assert.throws(() => readCatalogData({ data: {} }), CatalogIntegrityError);
  assert.throws(() => readCatalogData(null), CatalogIntegrityError);
});

test("readModelItems rejects missing/empty ids and duplicates", () => {
  const items = readModelItems([{ id: "a" }, { id: "b" }]);
  assert.deepEqual(
    items.map((entry) => entry.id),
    ["a", "b"],
  );
  assert.throws(() => readModelItems([{ id: "" }]), CatalogIntegrityError);
  assert.throws(() => readModelItems([{}]), CatalogIntegrityError);
  assert.throws(() => readModelItems(["x"]), CatalogIntegrityError);
  assert.throws(() => readModelItems([{ id: "dup" }, { id: "dup" }]), CatalogIntegrityError);
});
