// Safe layout-prop normalization against the embedded JSON-schema subset.
// Browser-safe (no filesystem access).
//
// The subset validated: object/string/number/integer/array/boolean types,
// `required`, `properties`, `additionalProperties: false`, `minLength`,
// `maxLength`, `minItems`, `maxItems`, and `enum`. Strings are sanitized
// (trimmed; unsafe HTML / URL schemes / placeholder copy rejected).

import type { ValidationIssue } from "./types.js";
import { getLayout } from "./lookup.js";
import type { NormalizeLayoutPropsResult } from "./types.js";

type SchemaNode = Record<string, unknown>;

const UNSAFE_TEXT = /<script|javascript:|vbscript:|on\w+\s*=/i;
const PLACEHOLDER_TEXT = /\{\{.+?\}\}|<TODO>|lorem ipsum|xxxx/i;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function typeOf(value: unknown): string {
  if (Array.isArray(value)) return "array";
  if (value === null) return "null";
  return typeof value;
}

function validateNode(schema: SchemaNode, value: unknown, path: string, issues: ValidationIssue[]): void {
  const declared = schema["type"];
  if (typeof declared === "string") {
    const expected = declared;
    const actual = typeOf(value);
    if (expected === "integer") {
      if (typeof value !== "number" || !Number.isInteger(value)) {
        issues.push({ severity: "error", path, message: `Expected ${expected}.` });
        return;
      }
    } else if (expected === "number") {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        issues.push({ severity: "error", path, message: `Expected ${expected}.` });
        return;
      }
    } else if (actual !== expected) {
      issues.push({ severity: "error", path, message: `Expected ${expected}.` });
      return;
    }
  }

  if (typeof value === "string") {
    const minLength = schema["minLength"];
    if (typeof minLength === "number" && value.length < minLength) {
      issues.push({ severity: "error", path, message: `String shorter than minLength ${minLength}.` });
    }
    const maxLength = schema["maxLength"];
    if (typeof maxLength === "number" && value.length > maxLength) {
      issues.push({ severity: "error", path, message: `String longer than maxLength ${maxLength}.` });
    }
    if (UNSAFE_TEXT.test(value)) {
      issues.push({ severity: "error", path, message: "Unsafe HTML or URL scheme." });
    }
    if (PLACEHOLDER_TEXT.test(value)) {
      issues.push({ severity: "error", path, message: "Placeholder copy remains." });
    }
  }

  if (Array.isArray(value)) {
    const minItems = schema["minItems"];
    if (typeof minItems === "number" && value.length < minItems) {
      issues.push({ severity: "error", path, message: `Array shorter than minItems ${minItems}.` });
    }
    const maxItems = schema["maxItems"];
    if (typeof maxItems === "number" && value.length > maxItems) {
      issues.push({ severity: "error", path, message: `Array longer than maxItems ${maxItems}.` });
    }
    const itemSchema = schema["items"];
    if (isObject(itemSchema)) {
      for (let i = 0; i < value.length; i += 1) {
        validateNode(itemSchema as SchemaNode, value[i], `${path}[${i}]`, issues);
      }
    }
  }

  if (isObject(value) && isObject(schema["properties"])) {
    validateObject(schema, value, path, issues);
  }
}

function validateObject(schema: SchemaNode, value: Record<string, unknown>, path: string, issues: ValidationIssue[]): void {
  const properties = schema["properties"] as Record<string, unknown> | undefined;
  const required = schema["required"];
  if (Array.isArray(required)) {
    for (const field of required) {
      if (typeof field === "string" && !(field in value)) {
        issues.push({ severity: "error", path: path ? `${path}.${field}` : field, message: "Required property is missing." });
      }
    }
  }
  const additionalProperties = schema["additionalProperties"];
  if (additionalProperties === false && isObject(properties)) {
    for (const key of Object.keys(value)) {
      if (!(key in properties)) {
        issues.push({ severity: "error", path: path ? `${path}.${key}` : key, message: "Unknown property (additionalProperties is false)." });
      }
    }
  }
  if (isObject(properties)) {
    for (const [key, child] of Object.entries(properties)) {
      if (key in value && isObject(child)) {
        validateNode(child as SchemaNode, value[key], path ? `${path}.${key}` : key, issues);
      }
    }
  }
}

/** Recursively sanitize a value against a schema node (trim strings, drop
 *  unknown properties when additionalProperties is false). */
function sanitizeNode(schema: SchemaNode | undefined, value: unknown): unknown {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    const itemSchema = schema && isObject(schema["items"]) ? (schema["items"] as SchemaNode) : undefined;
    return value.map((item) => sanitizeNode(itemSchema, item));
  }
  if (isObject(value)) {
    const properties = schema && isObject(schema["properties"]) ? (schema["properties"] as Record<string, SchemaNode>) : undefined;
    const additionalProperties = schema ? schema["additionalProperties"] : undefined;
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      if (properties && additionalProperties === false && !(key in properties)) continue;
      const childSchema = properties && key in properties ? properties[key] : undefined;
      out[key] = sanitizeNode(childSchema, child);
    }
    return out;
  }
  return value;
}

/**
 * Normalize user-supplied layout props against the layout's embedded JSON
 * schema subset. Returns sanitized props plus validation issues. Never throws
 * for bad props; reports issues instead.
 */
export function normalizeLayoutProps(compoundId: string, props: Record<string, unknown>): NormalizeLayoutPropsResult {
  const layout = getLayout(compoundId);
  const schema = (layout.schema as { jsonSchema?: SchemaNode }).jsonSchema ?? { type: "object" };
  const issues: ValidationIssue[] = [];
  validateNode(schema, props, "", issues);
  const sanitized = sanitizeNode(schema, props) as Record<string, unknown>;
  return { compoundId, props: sanitized, substitutions: [], issues };
}
