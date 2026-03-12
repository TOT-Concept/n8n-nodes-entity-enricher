/**
 * Shared validation helpers for entity input validation against schema search keys.
 */

/**
 * Check if a dot-separated key path exists in data (case-insensitive).
 * E.g. hasNestedKey({CommonName: "x"}, "commonName") → true
 */
export function hasNestedKey(data: Record<string, unknown>, keyPath: string): boolean {
	const parts = keyPath.split('.');
	let current: unknown = data;
	for (const part of parts) {
		if (current == null || typeof current !== 'object') return false;
		const obj = current as Record<string, unknown>;
		const matchingKey = Object.keys(obj).find(
			(k) => k.toLowerCase() === part.toLowerCase(),
		);
		if (!matchingKey) return false;
		current = obj[matchingKey];
	}
	return true;
}

/**
 * Flatten object keys into dot-separated paths (top-level + one level of nesting).
 */
export function flattenKeys(data: Record<string, unknown>, prefix = ''): string[] {
	const keys: string[] = [];
	for (const [k, v] of Object.entries(data)) {
		const path = prefix ? `${prefix}.${k}` : k;
		keys.push(path);
		if (v != null && typeof v === 'object' && !Array.isArray(v)) {
			keys.push(...flattenKeys(v as Record<string, unknown>, path));
		}
	}
	return keys;
}

/**
 * Recursively extract search key paths from schema properties.
 * Skips into nested objects but bypasses arrays of objects.
 * Returns dot-separated paths (e.g. "engine.manufacturer.name").
 */
export function extractSearchKeys(
	properties: Record<string, unknown>,
	prefix: string,
): string[] {
	const keys: string[] = [];
	for (const [name, rawProp] of Object.entries(properties)) {
		const prop = rawProp as Record<string, unknown>;
		const path = prefix ? `${prefix}.${name}` : name;

		if (prop.search_key === 'search') {
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

/**
 * Validate that an entity has at least one matching search key from the schema.
 * Returns an error message string if validation fails, or null if valid.
 */
export function validateEntitySearchKeys(
	entity: Record<string, unknown>,
	searchKeys: string[],
): string | null {
	if (!searchKeys.length) return null;

	const matchingKeys = searchKeys.filter((keyPath) => hasNestedKey(entity, keyPath));
	if (matchingKeys.length === 0) {
		const inputKeys = flattenKeys(entity);
		return `Input data has no matching search keys. The schema expects: ${searchKeys.join(', ')}. Input has: ${inputKeys.join(', ')}`;
	}
	return null;
}
