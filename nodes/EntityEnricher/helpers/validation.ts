/**
 * Shared validation helpers for entity input validation against schema search keys.
 */

/**
 * Recursively extract search key paths from schema properties.
 * Skips into nested objects but bypasses arrays of objects.
 * Returns dot-separated paths (e.g. "engine.manufacturer.name").
 *
 * A property is a search key when it carries `identifying: true`.
 */
export function extractSearchKeys(
	properties: Record<string, unknown>,
	prefix: string,
): string[] {
	const keys: string[] = [];
	for (const [name, rawProp] of Object.entries(properties)) {
		const prop = rawProp as Record<string, unknown>;
		const path = prefix ? `${prefix}.${name}` : name;

		if (prop.identifying === true) {
			keys.push(path);
		}

		// Recurse into nested objects, skip arrays of objects
		if (prop.type === 'object' && prop.properties) {
			keys.push(
				...extractSearchKeys(prop.properties as Record<string, unknown>, path),
			);
		}
	}
	return keys;
}

/** True when `value` holds at least one non-empty scalar, at any depth. */
function carriesAnyValue(value: unknown): boolean {
	if (Array.isArray(value)) return value.some(carriesAnyValue);
	if (value !== null && typeof value === 'object') {
		return Object.values(value as Record<string, unknown>).some(carriesAnyValue);
	}
	if (value === null || value === undefined) return false;
	if (typeof value === 'string') return value.trim() !== '';
	return true;
}

/**
 * Validate that an entity carries something to enrich from.
 *
 * Mirrors the backend gate (`schema_runtime/input_contract.py`): input whose
 * field names differ from the schema's is NOT an error — the enrichment prompt
 * carries the raw input JSON, so any field naming the entity identifies it, and
 * an entity of the wrong type is what the optional classification model
 * discards. Only input carrying no value at all is refused, since it leaves the
 * model nothing to identify and everything to invent.
 *
 * The schema's search keys are used as guidance in the message, nothing more.
 * Returns an error message string if validation fails, or null if valid.
 */
export function validateEntityInput(
	entity: Record<string, unknown>,
	searchKeys: string[],
): string | null {
	if (carriesAnyValue(entity)) return null;

	const guidance = searchKeys.length
		? ` The schema identifies its entity by ${searchKeys.join(', ')} — supply one of those,`
			+ ' or any other field naming the entity: the enrichment reads the raw input, so its'
			+ " field names need not match the schema's."
		: '';
	return `Empty input: this item carries no value, so nothing identifies the entity to enrich.${guidance}`;
}
