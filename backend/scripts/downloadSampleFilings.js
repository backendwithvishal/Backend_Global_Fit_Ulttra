/**
 * Global_Fit_Ulttra - Live Filing & Report Downloader
 * 
 * Fetches official financial PDF filings and macroeconomic statements directly
 * from Federal Reserve and SEC EDGAR servers with compliant headers.
 */

import fs from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const docsDir = path.join(__dirname, '..', 'data', 'financial_documents');

if (!fs.existsSync(docsDir)) {
  fs.mkdirSync(docsDir, { recursive: true });
}

function downloadFile(url, dest, headers = {}) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const req = https.get(url, { headers, timeout: 30000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadFile(res.headers.location, dest, headers).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.unlink(dest, () => {});
        return reject(new Error(`HTTP ${res.statusCode} from ${url}`));
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Timeout downloading from ${url}`));
    });

    req.on('error', (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

const LIVE_SOURCES = [
  {
    name: 'FED FOMC Statement 2024',
    filename: 'FED_FOMC_Statement_2024.pdf',
    url: 'https://www.federalreserve.gov/monetarypolicy/files/monetary20240131a1.pdf',
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
  },
  {
    name: 'SEC Form 10-K Guidelines',
    filename: 'SEC_Form_10K_Guidelines.pdf',
    url: 'https://www.sec.gov/files/form10-k.pdf',
    headers: { 'User-Agent': 'GlobalFitUlttraPlatform/1.0 (compliance@global-fit-ulttra.internal)' }
  }
];

export async function downloadLiveFilings() {
  console.log('Downloading live official financial filings and reports...');
  for (const src of LIVE_SOURCES) {
    const targetPath = path.join(docsDir, src.filename);
    try {
      console.log(`Downloading ${src.name}...`);
      await downloadFile(src.url, targetPath, src.headers);
      const stats = fs.statSync(targetPath);
      console.log(`✅ Saved ${src.filename} (${Math.round(stats.size / 1024)} KB)`);
    } catch (err) {
      console.warn(`⚠️  Could not download ${src.name} (${err.message}). Using existing/local copies.`);
    }
  }
}

if (process.argv[1] === __filename) {
  downloadLiveFilings().catch(console.error);
}
