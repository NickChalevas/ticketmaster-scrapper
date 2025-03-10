const express = require('express');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

const app = express();
const port = 3000;

let latestCurlCommand = ''; // Store the curl command to render on HTML

const residentialProxies = [
    'aCHNFXCCtg:hJd7QDCOPz@137.155.108.12:8072',
    'aCHNFXCCtg:hJd7QDCOPz@137.155.108.68:8128',
    'aCHNFXCCtg:hJd7QDCOPz@137.155.103.147:6932',
    'aCHNFXCCtg:hJd7QDCOPz@137.155.108.99:8159'
];

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

app.get('/', (req, res) => {
    res.send(`
        <html>
            <head><title>Scraping Result</title></head>
            <body style="font-family: monospace; white-space: pre-wrap; padding: 20px;">
                <h2>CURL Command Output:</h2>
                <code>${latestCurlCommand || 'No data yet. Please wait or refresh.'}</code>
            </body>
        </html>
    `);
});

app.listen(port, () => {
    console.log(`[SERVER] App listening on http://localhost:${port}`);
    startScraping(); // Start scraping after server is ready
});

async function startScraping() {
    let browser;
    let totalSent = 0;
    let totalReceived = 0;

    try {
        const randomProxy = residentialProxies[Math.floor(Math.random() * residentialProxies.length)];
        const [proxyAuth, proxyAddress] = randomProxy.split('@');
        const [username, password] = proxyAuth.split(':');

        console.log(`[DEBUG] Using proxy: http://${proxyAddress}`);

        const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

        try {
            browser = await puppeteer.launch({
                headless: true,
                executablePath: chromePath,
                args: [
                    `--proxy-server=http://${proxyAddress}`,
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-images',
                    '--disable-webgl',
                    '--blink-settings=imagesEnabled=false',
                    '--disable-extensions',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--disable-webrtc',
                    '--disable-background-networking',
                    '--disable-background-timer-throttling',
                    '--disable-backgrounding-occluded-windows',
                    '--disable-breakpad'
                ]
            });
        } catch (e) {
            console.log(`[ERROR] Primary Chrome path failed: ${e.message}`);
            const altChromePath = 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';

            browser = await puppeteer.launch({
                headless: true,
                executablePath: altChromePath,
                args: [
                    `--proxy-server=http://${proxyAddress}`,
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-images',
                    '--disable-webgl',
                    '--blink-settings=imagesEnabled=false'
                ]
            });
        }

        const page = await browser.newPage();
        await page.authenticate({ username, password });

        const client = await page.target().createCDPSession();
        await client.send('Network.enable');
        await client.send('Network.setCacheDisabled', { cacheDisabled: true });
        await client.send('Network.setBlockedURLs', {
            urls: [
                '*.jpg', '*.jpeg', '*.png', '*.gif', '*.css', '*.woff', '*.woff2', '*.svg',
                '*analytics*', '*tracker*', '*logging*', '*stats*', '*pixel*', '*facebook*',
                '*google*', '*doubleclick*', '*ads*', '*metrics*', '*cdn*', '*tracking*',
                '*mapsapi*', '*tmol.io*', '*marketing*'
            ]
        });

        await page.setExtraHTTPHeaders({
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.1',
            'DNT': '1',
            'Upgrade-Insecure-Requests': '1',
            'Cache-Control': 'max-age=0'
        });

        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

        client.on('Network.requestWillBeSent', (event) => {
            totalSent += JSON.stringify(event.request).length;
        });
        client.on('Network.dataReceived', (event) => {
            totalReceived += event.dataLength;
        });

        console.log('[DEBUG] Navigating to DuckDuckGo Lite...');
        await page.goto('https://lite.duckduckgo.com/lite/', {
            waitUntil: 'domcontentloaded',
            timeout: 30000
        });

        await page.type('input.query', '00006142CB7477BC');
        await page.click('input.submit');

        const ticketmasterSelector = 'a[href*="ticketmaster.com"]';
        await page.waitForSelector(ticketmasterSelector, { timeout: 5000 })
            .catch(() => console.log('[WARNING] Selector timeout, attempting to continue'));

        console.log('[DEBUG] Looking for Ticketmaster link...');
        const ticketmasterLink = await page.$(ticketmasterSelector);
        if (ticketmasterLink) {
            const href = await page.evaluate(el => el.href, ticketmasterLink);
            console.log('[DEBUG] Navigating directly to event page...');
            await page.goto(`https://www.ticketmaster.com/event/00006142CB7477BC`, {
                waitUntil: 'domcontentloaded',
                timeout: 30000
            });
        } else {
            console.log('[WARNING] Ticketmaster link not found. Trying direct navigation');
            await page.goto(`https://www.ticketmaster.com/event/00006142CB7477BC`, {
                waitUntil: 'domcontentloaded',
                timeout: 30000
            });
        }

        const targetXHRPattern = /https:\/\/services\.ticketmaster\.com\/api\/ismds\/event\/[A-Za-z0-9]+\/quickpicks/;

        console.log('[DEBUG] Monitoring for XHR requests...');
        page.on('response', async (response) => {
            const url = response.url();
            if (targetXHRPattern.test(url)) {
                console.log('[SUCCESS] Response received for XHR:', url);

                const headers = response.headers();
                const cookies = await page.cookies(url);

                const curlCommand = `curl -X ${response.request().method()} '${url}' \\\n` +
                    `${Object.entries(headers).map(([key, value]) => `-H '${key}: ${value}'`).join(' \\\n')} \\\n` +
                    `${cookies.map(cookie => `-H 'Cookie: ${cookie.name}=${cookie.value}'`).join(' \\\n')} \\\n` +
                    `--compressed`;

                latestCurlCommand = curlCommand;
                console.log('[SUCCESS] CURL command captured and ready to view on /');
            }
        });

        await delay(2000);
        console.log('[DEBUG] Attempting to trigger XHR request...');
        await page.evaluate(() => {
            fetch(`https://services.ticketmaster.com/api/ismds/event/00006142CB7477BC/quickpicks`, {
                method: 'GET',
                credentials: 'include'
            });
        });

        await delay(5000);

    } catch (error) {
        console.error('[ERROR] An error occurred:', error.message);
    } finally {
        if (browser) {
            console.log('[RESULT] Total data sent:', (totalSent / 1024 / 1024).toFixed(2), 'MB');
            console.log('[RESULT] Total data received:', (totalReceived / 1024 / 1024).toFixed(2), 'MB');
            await browser.close();
        }
    }
}
