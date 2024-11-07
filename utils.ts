const { format, parse } = require('date-fns');

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

module.exports = { utils: {
  retryOperation,
  scrapeTable,
  extractRowData,
  extractExpediente,
  extractTipoContrato,
  extractText,
  extractImporte,
  extractFecha,
  extractOrganoContratacion
}};