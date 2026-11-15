import {defineConfig} from '@playwright/test';

export default defineConfig({
	testDir: './tests/browser',
	testMatch: '**/*.spec.mjs',
	workers: 1,
	use: {
		viewport: {width: 1200, height: 800},
		channel: process.platform === 'win32' ? 'msedge' : undefined,
		headless: true,
	},
});
