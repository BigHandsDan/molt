import Ajv, { ValidateFunction } from 'ajv';

const ajv = new Ajv({ allErrors: true, strict: false });

/** Result of validating data against a JSON Schema. */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate arbitrary data against a JSON Schema using Ajv.
 * @param schema - The JSON Schema object to validate against.
 * @param data - The data to validate.
 * @returns A ValidationResult indicating whether validation passed and any errors.
 */
export function validateData(schema: object, data: unknown): ValidationResult {
  let validate: ValidateFunction;
  try {
    validate = ajv.compile(schema);
  } catch (err) {
    return {
      valid: false,
      errors: [`Schema compilation error: ${(err as Error).message}`],
    };
  }

  const valid = validate(data);
  if (valid) {
    return { valid: true, errors: [] };
  }

  const errors = (validate.errors || []).map((e) => {
    const path = e.instancePath || '/';
    return `${path}: ${e.message}`;
  });

  return { valid: false, errors };
}
