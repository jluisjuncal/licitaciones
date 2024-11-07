const { format, parse } = require('date-fns');
const fs = require('fs').promises;
const { utils } = require('./utils');

async function scrape({ page }) {
  try {
    // Intercept image requests and cancel them 
    await page.route('**/*.{png,jpg,jpeg,gif,svg,PNG,css,ttf,jsp,ico,js}*', (route) => {
      route.abort();
    });

    // Navigate with retry logic
    await utils.retryOperation(async () => {
      await page.goto('https://contrataciondelestado.es/wps/portal/licitaciones', {
        waitUntil: 'networkidle',
        timeout: 60000
      });
    }, 3);

    // Wait for and click the search button
    const searchButtonSelector = '#viewns_Z7_AVEQAI930OBRD02JPMTPG21004_\\:form1\\:linkFormularioBusqueda';
    await page.waitForSelector(searchButtonSelector, { state: 'visible', timeout: 30000 });
    await page.click(searchButtonSelector);

    // Set filter for published listings
    await page.waitForSelector('select#viewns_Z7_AVEQAI930OBRD02JPMTPG21004_\\:form1\\:estadoLici', { timeout: 30000 });
    await page.selectOption('select#viewns_Z7_AVEQAI930OBRD02JPMTPG21004_\\:form1\\:estadoLici', {label: 'Publicada'});
    
    // Click search and wait for results
    const searchButton = page.getByRole('button', { name: 'Buscar' });
    await searchButton.click();
    await page.waitForSelector('table#myTablaBusquedaCustom', { timeout: 30000 });

    const allResults = [];
    let hasNextPage = true;
    let pageNum = 1;

    while (hasNextPage) {
      console.log(`Scraping page ${pageNum}...`);

      // Scrape current page
      const pageData = await utils.scrapeTable(page);
      allResults.push(...pageData);

      // Check for next page button
      const nextButton = await page.$('a.siguientePagina:not(.disabled)');
      if (nextButton) {
        await nextButton.click();
        await page.waitForSelector('table#myTablaBusquedaCustom', { state: 'visible' });
        await page.waitForTimeout(2000); // Allow table to update
        pageNum++;
      } else {
        hasNextPage = false;
      }
    }

    // Save results
    await fs.writeFile('licitaciones.json', JSON.stringify(allResults, null, 2));
    console.log(`Scraped ${allResults.length} listings`);

    return allResults;
  } catch (error) {
    console.error('Scraping failed:', error);
    throw error;
  }
}

module.exports = { scrape };