const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
    testDir: './tests',
    use: { baseURL: 'http://127.0.0.1:4173' },
    webServer: {
        command: 'npx http-server . -p 4173 -a 127.0.0.1 -s -c-1',
        url: 'http://127.0.0.1:4173/index.html',
        reuseExistingServer: true
    }
});
