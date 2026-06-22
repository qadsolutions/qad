export const EMBEDDING_DIM = 768;

/** Build a pgvector literal '[v0,…,v767]' (the driver doesn't serialize number[]). */
export function vectorLiteral(values: readonly number[]): string {
  return `[${values.join(",")}]`;
}

/** A 768-length vector that is `value` at index `hotIndex`, else 0. */
export function unitish(hotIndex: number, value = 1): number[] {
  const v = new Array<number>(EMBEDDING_DIM).fill(0);
  v[hotIndex] = value;
  return v;
}
