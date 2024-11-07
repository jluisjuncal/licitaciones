import { test, expect } from '@playwright/test';
import fs from 'fs/promises';

interface CPVNode {
  code: string;
  description: string;
  level: number;
  children?: CPVNode[];
}

async function scrapeCPVTree(page) {
  const cpvData: CPVNode[] = [];

  // Helper function to extract code and description from label text
  const parseLabel = (text: string) => {
    const match = text.match(/^(\d{8})?-?(.+)$/);
    return {
      code: match?.[1] || '',
      description: match?.[2]?.trim() || text.trim()
    };
  };

  // Helper function to get node level from indentation
  const getNodeLevel = async (element) => {
    const width = await element.$eval('td[width]', td => 
      parseInt(td.getAttribute('style')?.match(/width:\s*(\d+)px/)?.[1] || '0')
    );
    return Math.floor(width / 19); // Each level is indented by 19px
  };

  // Get all tree nodes
  const nodes = await page.$$('table[class="tree_nodeStyle"]');

  for (const node of nodes) {
    try {
      // Get the label element
      const labelElement = await node.$('label[class*="tree_label"]');
      if (!labelElement) continue;

      // Get the label text
      const labelText = await labelElement.textContent();
      if (!labelText) continue;

      // Parse the node data
      const { code, description } = parseLabel(labelText);
      const level = await getNodeLevel(node);

      // Create node object
      const cpvNode: CPVNode = {
        code,
        description,
        level,
        children: []
      };

      // Add to appropriate place in tree
      if (level === 0) {
        cpvData.push(cpvNode);
      } else {
        // Find parent node
        let currentLevel = cpvData;
        for (let i = 0; i < level - 1; i++) {
          currentLevel = currentLevel[currentLevel.length - 1].children || [];
        }
        currentLevel.push(cpvNode);
      }
    } catch (error) {
      console.error('Error processing node:', error);
    }
  }

  return cpvData;
}

test('scrape CPV tree', async ({ page }) => {
  // Navigate to the page
  await page.goto('https://contrataciondelestado.es/wps/portal/plataforma');
  await page.getByRole('link', { name: 'Buscar publicaciones' }).click();
  await page.getByRole('link', { name: 'Licitaciones Búsqueda de' }).click();
  await page.getByRole('link', { name: 'Selección CPV' }).click();

  // Wait for the tree to load
  await page.waitForSelector('.tree_nodeStyle');

  // Expand all nodes (optional, depending on if you want to get all levels)
  const expandButtons = await page.$$('img[alt="Click to expand"]');
  for (const button of expandButtons) {
    await button.click();
    await page.waitForTimeout(100); // Small delay to let the tree update
  }

  // Scrape the tree
  const cpvData = await scrapeCPVTree(page);

  // Save the results
  await fs.writeFile('cpv_tree.json', JSON.stringify(cpvData, null, 2));

  // Create a simple HTML table for visualization
  const tableContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        table { border-collapse: collapse; width: 100%; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        tr:nth-child(even) { background-color: #f2f2f2; }
        th { background-color: #4CAF50; color: white; }
        .indent { padding-left: 20px; }
      </style>
    </head>
    <body>
      <table>
        <thead>
          <tr>
            <th>Code</th>
            <th>Description</th>
            <th>Level</th>
          </tr>
        </thead>
        <tbody>
          ${generateTableRows(cpvData)}
        </tbody>
      </table>
    </body>
    </html>
  `;

  await fs.writeFile('cpv_tree.html', tableContent);
  
  // Verify we got some data
  expect(cpvData.length).toBeGreaterThan(0);
});

function generateTableRows(nodes: CPVNode[], level = 0): string {
  let rows = '';
  for (const node of nodes) {
    rows += `
      <tr>
        <td>${node.code}</td>
        <td class="indent" style="padding-left: ${level * 20}px">${node.description}</td>
        <td>${node.level}</td>
      </tr>
    `;
    if (node.children?.length) {
      rows += generateTableRows(node.children, level + 1);
    }
  }
  return rows;
}