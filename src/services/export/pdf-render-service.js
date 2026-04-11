import { chromium } from 'playwright';

const CHROMIUM_ARGS = [
  '--disable-dev-shm-usage',
  '--disable-setuid-sandbox',
  '--font-render-hinting=none',
  '--no-sandbox'
];

export const withPdfBrowserContext = async (callback) => {
  const browser = await chromium.launch({
    headless: true,
    args: CHROMIUM_ARGS
  });
  const context = await browser.newContext();

  try {
    return await callback({
      browser,
      context
    });
  } finally {
    await context.close();
    await browser.close();
  }
};

export const renderPdfFromHtml = async ({
  context,
  html,
  layoutProfile
}) => {
  const page = await context.newPage();

  try {
    await page.setContent(html, {
      waitUntil: 'load'
    });

    return await page.pdf({
      width: `${layoutProfile.pageWidthIn}in`,
      height: `${layoutProfile.pageHeightIn}in`,
      margin: {
        top: '0in',
        right: '0in',
        bottom: '0in',
        left: '0in'
      },
      preferCSSPageSize: true,
      printBackground: true
    });
  } finally {
    await page.close();
  }
};

