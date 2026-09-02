const defined_base = process.env.BASE_PATH ?? '';
const base = defined_base.replace(/\/+$/, '');

/**
 * Svelte preprocessor that rewrites internal absolute hrefs in .svx files.
 * Runs as a markup preprocessor — works on raw source before Svelte compilation.
 */
export function baseRewrite() {
	return {
		/** @param {{ content: string, filename?: string }} markup */
		markup({ content, filename }) {
			if (!base) return;
			if (!filename?.endsWith('.svx')) return;

			const rewritten = content.replace(
				/href="(\/[^\"]*?)"/g,
				/** @param {string} match @param {string} path */
				(match, path) => `href="${base}${path}"`
			);

			if (rewritten !== content) {
				return { code: rewritten };
			}
		}
	};
}
