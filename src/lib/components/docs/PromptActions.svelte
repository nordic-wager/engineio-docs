<script lang="ts">
	import { base } from '$app/paths';

	let { contentEl }: { contentEl: HTMLElement | undefined } = $props();
	let copied = $state(false);
	let copilotCopied = $state(false);
	let copyBtnEl: HTMLButtonElement | undefined = $state();

	function getPageContent(): string {
		if (!contentEl) return '';

		const clone = contentEl.cloneNode(true) as HTMLElement;
		clone.querySelectorAll('.prompt-actions, button').forEach((el) => el.remove());

		let text = '';
		const h1 = clone.querySelector('h1');
		if (h1) {
			text += `# ${h1.textContent?.trim()}\n\n`;
		}

		function tableToMarkdown(table: Element): string {
			const rows = table.querySelectorAll('tr');
			if (rows.length === 0) return '';
			let md = '';
			rows.forEach((row, i) => {
				const cells = row.querySelectorAll('th, td');
				const line = Array.from(cells)
					.map((c) => c.textContent?.trim() || '')
					.join(' | ');
				md += `| ${line} |\n`;
				if (i === 0) {
					md += `| ${Array.from(cells)
						.map(() => '---')
						.join(' | ')} |\n`;
				}
			});
			return md;
		}

		clone.querySelectorAll('h2, h3, p, li, pre, code, table').forEach((el) => {
			const tag = el.tagName.toLowerCase();
			// Skip elements nested inside already-handled parents
			if (tag !== 'table' && el.closest('table')) return;
			if (tag === 'code' && el.closest('pre')) return;

			const content = el.textContent?.trim() || '';

			if (tag === 'h2') {
				text += `\n## ${content}\n\n`;
			} else if (tag === 'h3') {
				text += `\n### ${content}\n\n`;
			} else if (tag === 'p' && el.parentElement?.tagName !== 'LI') {
				text += `${content}\n\n`;
			} else if (tag === 'li') {
				text += `- ${content}\n`;
			} else if (tag === 'pre') {
				text += `\`\`\`\n${content}\n\`\`\`\n\n`;
			} else if (tag === 'table') {
				text += tableToMarkdown(el) + '\n';
			}
		});

		return text.trim();
	}

	function buildPrompt(): string {
		const content = getPageContent();
		if (!content) return '';

		const url = window.location.href;
		return `I'm sharing documentation from Stake Engine Docs.\n\nSource: ${url}\n\n---\n\n${content}\n\n---\n\nUsing the documentation above as context, help me understand and work with this part of the system.`;
	}

	function buildCopilotPrompt(): string {
		const content = getPageContent();
		if (!content) return '';

		const url = window.location.href;
		const path = window.location.pathname;
		const stack = path.includes('/math-sdk')
			? 'Python (Stake Engine Math SDK: GameConfig, GameState, executables, events, win manager)'
			: path.includes('/web-sdk')
				? 'Svelte 5 + PixiJS (Stake Engine Web SDK: bookEvents, emitterEvents, Svelte components)'
				: path.includes('/api')
					? 'TypeScript/JavaScript (Stake Engine RGS wallet and game-round HTTP API)'
					: 'the relevant Stake Engine SDK (Python math SDK or Svelte/PixiJS web SDK)';

		return [
			`You are a senior pair programmer helping me implement a Stake Engine slot game in ${stack}.`,
			'',
			`Context from the official docs (${url}):`,
			'',
			'---',
			'',
			content,
			'',
			'---',
			'',
			'Instructions:',
			'- Answer with working code first, then a short explanation of why it works.',
			'- Follow the patterns, file layout, and API shapes shown in the docs above.',
			'- If my request is ambiguous, pick the most likely interpretation, say what you assumed, and continue.',
			'- Keep snippets minimal and complete enough to paste into the project.'
		].join('\n');
	}

	async function copyText(text: string): Promise<boolean> {
		if (!text) return false;

		try {
			await navigator.clipboard.writeText(text);
		} catch {
			const textarea = document.createElement('textarea');
			textarea.value = text;
			textarea.style.cssText = 'position:fixed;opacity:0';
			document.body.appendChild(textarea);
			textarea.select();
			document.execCommand('copy');
			document.body.removeChild(textarea);
		}

		return true;
	}

	async function copyAsPrompt() {
		if (!(await copyText(buildPrompt()))) return;

		copied = true;
		setTimeout(() => (copied = false), 2000);
	}

	function openInChatGPT() {
		const prompt = encodeURIComponent(buildPrompt());
		window.open(`https://chat.openai.com/?q=${prompt}`, '_blank');
	}

	function openInClaude() {
		const prompt = encodeURIComponent(buildPrompt());
		window.open(`https://claude.ai/new?q=${prompt}`, '_blank');
	}

	function openInPerplexity() {
		const prompt = encodeURIComponent(buildPrompt());
		window.open(`https://www.perplexity.ai/search/new?q=${prompt}`, '_blank');
	}

	async function copyForCopilot() {
		if (!(await copyText(buildCopilotPrompt()))) return;

		copilotCopied = true;
		setTimeout(() => (copilotCopied = false), 2000);
	}
</script>

<div class="prompt-actions not-prose fade-in">
	<div class="prompt-bar">
		<button
			bind:this={copyBtnEl}
			onclick={copyAsPrompt}
			class="bar-btn copy-btn"
			class:copied
			title="Copy page as AI prompt"
		>
			<span class="copy-icon" class:pop={copied}>
				{#if copied}
					<svg
						width="16"
						height="16"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						stroke-width="2.5"
					>
						<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
					</svg>
				{:else}
					<svg
						width="16"
						height="16"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						stroke-width="2"
					>
						<path
							stroke-linecap="round"
							stroke-linejoin="round"
							d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
						/>
					</svg>
				{/if}
			</span>
		</button>

		<span class="divider"></span>

		<button onclick={openInChatGPT} title="Open in ChatGPT" class="bar-btn">
			<img
				src="{base}/icons/chatgpt.svg"
				alt="ChatGPT"
				width="18"
				height="18"
				onerror={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')}
			/>
		</button>
		<button onclick={openInClaude} title="Open in Claude" class="bar-btn">
			<img
				src="{base}/icons/claude.svg"
				alt="Claude"
				width="18"
				height="18"
				onerror={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')}
			/>
		</button>
		<button onclick={openInPerplexity} title="Open in Perplexity" class="bar-btn">
			<img
				src="{base}/icons/perplexity.svg"
				alt="Perplexity"
				width="18"
				height="18"
				onerror={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')}
			/>
		</button>
		<button
			onclick={copyForCopilot}
			title="Copy prompt for GitHub Copilot"
			class="bar-btn"
			class:copied={copilotCopied}
		>
			<img src="{base}/icons/copilot.svg" alt="GitHub Copilot" width="18" height="18" />
		</button>
	</div>
</div>

<style>
	@keyframes fadeSlideIn {
		from {
			opacity: 0;
			transform: translateY(-6px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
	.fade-in {
		animation: fadeSlideIn 0.35s ease-out 0.1s both;
	}

	.prompt-actions {
		flex-shrink: 0;
	}

	.prompt-bar {
		display: flex;
		align-items: center;
		border-radius: 4px;
		border: 1px solid var(--engine-border);
		background: rgba(20, 20, 20, 0.8);
		backdrop-filter: blur(12px);
	}

	.bar-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		flex: 1;
		height: 34px;
		border: none;
		background: transparent;
		cursor: pointer;
		color: var(--engine-muted);
		transition:
			color 0.15s,
			background 0.15s;
	}

	.bar-btn:first-child {
		border-radius: 8px 0 0 8px;
	}
	.bar-btn:last-child {
		border-radius: 0 8px 8px 0;
	}

	.bar-btn:hover {
		background: rgba(255, 0, 106, 0.1);
		color: rgba(255, 255, 255, 0.9);
	}

	.bar-btn.copied {
		color: var(--engine-pink);
	}

	.bar-btn img {
		opacity: 0.45;
		transition: opacity 0.15s;
	}
	.bar-btn:hover img {
		opacity: 0.95;
	}

	.copy-icon {
		display: flex;
		align-items: center;
	}

	@keyframes popIn {
		0% {
			transform: scale(0);
		}
		50% {
			transform: scale(1.3);
		}
		100% {
			transform: scale(1);
		}
	}
	.copy-icon.pop {
		animation: popIn 0.35s cubic-bezier(0.34, 1.56, 0.64, 1);
	}

	.divider {
		width: 1px;
		height: 16px;
		background: rgba(255, 255, 255, 0.08);
		flex-shrink: 0;
	}
</style>
