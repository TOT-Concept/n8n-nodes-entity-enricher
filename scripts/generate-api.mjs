/**
 * Regenerate nodes/EntityEnricher/helpers/generated/schema.ts from the backend's
 * OpenAPI schema.
 *
 * The backend port is per working copy (docs/LOCAL_ENVIRONMENTS.md: dev :18808,
 * test :18908), so it is resolved instead of hardcoded — a hardcoded :18808 made
 * a test working copy generate its types against the OTHER checkout's running
 * backend, silently producing types for code that isn't there. Same resolution
 * as frontend/scripts/generate-api.mjs, which was fixed for that reason first.
 *
 * Resolution order: EE_API_TARGET → EE_APP_PORT in the repo-root .env (written
 * by scripts/dev-env.mjs) → http://localhost:18808.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = resolve(packageDir, '..', '..', '..')

function targetFromEnvFile() {
	try {
		const text = readFileSync(resolve(repoRoot, '.env'), 'utf8')
		const port = text.match(/^\s*EE_APP_PORT\s*=\s*(\d+)/m)?.[1]
		return port ? `http://localhost:${port}` : undefined
	} catch {
		return undefined  // no generated env file: single working copy on the default port
	}
}

const target = process.env.EE_API_TARGET || targetFromEnvFile() || 'http://localhost:18808'
console.log(`Generating API types from ${target}`)

const result = spawnSync(
	'npx',
	[
		'openapi-typescript', `${target}/api/openapi.json`,
		'-o', 'nodes/EntityEnricher/helpers/generated/schema.ts',
		'--root-types', '--root-types-no-schema-prefix', '-t', '--alphabetize',
	],
	{ cwd: packageDir, stdio: 'inherit' },
)
process.exit(result.status ?? 1)
