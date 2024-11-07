const { test, expect } = require('@playwright/test');
const { scrape } = require('./scraper');

test('scrape procurement listings', async ({ page }) => {
  const results = await scrape({ page });
  expect(results.length).toBeGreaterThan(0);

  // Verificar que el JSON se haya guardado correctamente
  const fs = require('fs').promises;
  const fileContent = await fs.readFile('licitaciones.json', 'utf8');
  const data = JSON.parse(fileContent);
  expect(data.length).toEqual(results.length);
});