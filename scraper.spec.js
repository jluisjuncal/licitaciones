const { test, expect } = require('@playwright/test');
const { format, parse } = require('date-fns');
const fs = require('fs').promises;

test('scrape procurement listings', async ({ page }) => {
  try {
    // Navigate with retry logic
    await retryOperation(async () => {
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
      const pageData = await scrapeTable(page);
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

    expect(allResults.length).toBeGreaterThan(0);
  } catch (error) {
    console.error('Scraping failed:', error);
    throw error;
  }
});

async function scrapeTable(page) {
  const rows = await page.$$('table#myTablaBusquedaCustom tbody tr');
  const results = [];

  for (const row of rows) {
    try {
      const result = await extractRowData(row);
      results.push(result);
    } catch (error) {
      console.error('Error processing row:', error);
    }
  }

  return results;
}

async function extractRowData(row) {
  const expediente = await extractExpediente(row);
  const tipoContrato = await extractTipoContrato(row);
  const estado = await extractText(row, '.tdEstado');
  const importe = await extractImporte(row);
  const fechaPresentacion = await extractFecha(row);
  const organoContratacion = await extractOrganoContratacion(row);

  return {
    expediente,
    tipoContrato,
    estado,
    importe,
    fechaPresentacion,
    organoContratacion
  };
}

async function extractExpediente(row) {
  return await row.$eval('.tdExpediente', cell => {
    return {
      numero: cell.querySelector('span[id*="textoEnlace"]')?.textContent?.trim() || '',
      descripcion: cell.querySelector('div:nth-child(2)')?.textContent?.trim() || '',
      licitacionElectronica: cell.querySelector('.imgELicitacion') !== null,
      enlace: cell.querySelector('a[href*="deeplink"]')?.href || ''
    };
  });
}

async function extractTipoContrato(row) {
  return await row.$eval('.tdTipoContrato', cell => ({
    tipo: cell.querySelector('div:nth-child(1)')?.textContent?.trim() || '',
    subtipo: cell.querySelector('div:nth-child(2)')?.textContent?.trim() || ''
  }));
}

async function extractText(row, selector) {
  const element = await row.$(selector);
  return element ? (await element.textContent()).trim() : '';
}

async function extractImporte(row) {
  const importeText = await extractText(row, '.tdImporte');
  const numericValue = importeText.replace(/[^\d,]/g, '').replace(',', '.');
  return numericValue ? parseFloat(numericValue) : 0;
}

async function extractFecha(row) {
  const fechaText = await extractText(row, '.tdFechaLimite');
  try {
    const date = parse(fechaText, 'dd/MM/yyyy', new Date());
    return format(date, 'yyyy-MM-dd');
  } catch {
    return fechaText;
  }
}

async function extractOrganoContratacion(row) {
  return await row.$eval('.tdOrganoContratacion', cell => ({
    nombre: cell.textContent.trim(),
    enlace: cell.querySelector('a')?.href || ''
  }));
}

async function retryOperation(operation, maxAttempts = 3) {
  let lastError;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts) break;
      await new Promise(resolve => setTimeout(resolve, attempt * 1000));
    }
  }
  
  throw lastError;
}