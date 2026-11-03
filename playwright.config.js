const { defineConfig } = require('@playwright/test');

// Browser tests: tests/functional (one feature at a time) and tests/e2e (whole user journeys).
// Unit tests in tests/unit run under Node's own runner instead (npm run test:unit).
module.exports = defineConfig({
    testDir: './tests',
    testIgnore: '**/unit/**',
    use: {
        baseURL: 'http://127.0.0.1:4173',
        // Start as a returning user (tour already seen). Tour tests opt out with an empty storageState.
        storageState: 'tests/fixtures/returning-user.json'
    },
    webServer: {
        command: 'npx http-server . -p 4173 -a 127.0.0.1 -s -c-1',
        url: 'http://127.0.0.1:4173/index.html',
        reuseExistingServer: true
    }
});
