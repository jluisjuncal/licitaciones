import { test, expect } from '@playwright/test';
import fs from 'fs/promises';

interface CPVNode {
  code: string;
  description: string;
  level: number;
  children?: CPVNode[];
}

async function expandAllNodes(page) {
  let keepExpanding = true;
  let iterations = 0;
  const maxIterations = 100; // Safety limit

  while (keepExpanding && iterations < maxIterations) {
    const expandButtons = await page.$$('img[alt="Click to expand"]');
    if (expandButtons.length === 0) {
      keepExpanding = false;
      continue;
    }

    console.log(`Expanding ${expandButtons.length} nodes in iteration ${iterations + 1}`);
    
    // Click all visible expand buttons
    for (const button of expandButtons) {
      try {
        const isVisible = await button.isVisible();
        if (isVisible) {
          await button.click();
          // Small delay to prevent overwhelming the page
          await page.waitForTimeout(50);
        }
      } catch (error) {
        console.warn('Failed to click expand button:', error.message);
      }
    }

    // Wait for potential new nodes to load
    await page.waitForTimeout(500);
    iterations++;
  }

  console.log(`Finished expanding after ${iterations} iterations`);
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

  // Get all tree nodes after full expansion
  const nodes = await page.$$('table[class="tree_nodeStyle"]');
  console.log(`Found ${nodes.length} total nodes to process`);

  // Create a map to store nodes by their level and position
  const nodeMap = new Map<string, CPVNode>();
  const rootNodes: CPVNode[] = [];

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

      // Generate a unique path for this node based on its position in the DOM
      const path = await node.evaluate(el => {
        const indices = [];
        let current = el;
        while (current.parentElement) {
          const children = Array.from(current.parentElement.children);
          indices.unshift(children.indexOf(current));
          current = current.parentElement;
        }
        return indices.join('-');
      });

      nodeMap.set(path, cpvNode);

      // Find parent node
      const parentPath = path.split('-').slice(0, -1).join('-');
      const parent = nodeMap.get(parentPath);

      if (parent) {
        parent.children = parent.children || [];
        parent.children.push(cpvNode);
      } else {
        rootNodes.push(cpvNode);
      }
    } catch (error) {
      console.error('Error processing node:', error);
    }
  }

  return rootNodes;
}

test('scrape complete CPV tree', async ({ page }) => {
  // Increase timeouts for deep scraping
  test.setTimeout(300000); // 5 minutes
  page.setDefaultTimeout(60000); // 1 minute

  // Navigate to the page
  await page.goto('https://contrataciondelestado.es/wps/portal/plataforma');
  await page.getByRole('link', { name: 'Buscar publicaciones' }).click();
  await page.getByRole('link', { name: 'Licitaciones Búsqueda de' }).click();
  await page.getByRole('link', { name: 'Selección CPV' }).click();

  // Wait for the initial tree to load
  await page.waitForSelector('.tree_nodeStyle');

  console.log('Starting tree expansion...');
  await expandAllNodes(page);
  console.log('Tree expansion completed');

  // Scrape the fully expanded tree
  console.log('Starting tree scraping...');
  const cpvData = await scrapeCPVTree(page);
  console.log('Tree scraping completed');

  // Save the results
  await fs.writeFile('cpv_tree.json', JSON.stringify(cpvData, null, 2));

  // Create a simple HTML table for visualization
  const tableContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>CPV Tree Structure</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        table { 
          border-collapse: collapse; 
          width: 100%;
          margin-top: 20px;
        }
        th, td { 
          border: 1px solid #ddd; 
          padding: 12px 8px; 
          text-align: left; 
        }
        tr:nth-child(even) { background-color: #f8f9fa; }
        tr:hover { background-color: #f5f5f5; }
        th { 
          background-color: #4CAF50; 
          color: white;
          position: sticky;
          top: 0;
        }
        .indent { padding-left: 20px; }
        .code { font-family: monospace; }
        .level-indicator {
          color: #666;
          font-size: 0.9em;
        }
      </style>
    </head>
    <body>
      <h1>CPV (Common Procurement Vocabulary) Tree Structure</h1>
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
  
  // Verify we got data and it includes deep nodes
  expect(cpvData.length).toBeGreaterThan(0);
  
  // Log statistics about the scraped data
  const stats = calculateTreeStats(cpvData);
  console.log('Tree Statistics:', stats);
});

function calculateTreeStats(nodes: CPVNode[]) {
  let totalNodes = 0;
  let maxDepth = 0;
  let nodesByLevel = new Map<number, number>();

  function traverse(node: CPVNode, depth: number) {
    totalNodes++;
    maxDepth = Math.max(maxDepth, depth);
    
    nodesByLevel.set(depth, (nodesByLevel.get(depth) || 0) + 1);

    if (node.children) {
      node.children.forEach(child => traverse(child, depth + 1));
    }
  }

  nodes.forEach(node => traverse(node, 0));

  return {
    totalNodes,
    maxDepth,
    nodesByLevel: Object.fromEntries(nodesByLevel)
  };
}

function generateTableRows(nodes: CPVNode[], level = 0): string {
  let rows = '';
  for (const node of nodes) {
    rows += `
      <tr>
        <td class="code">${node.code || '─'}</td>
        <td class="indent" style="padding-left: ${level * 20}px">
          ${node.description}
          <span class="level-indicator">${'│'.repeat(level)}</span>
        </td>
        <td>${node.level}</td>
      </tr>
    `;
    if (node.children?.length) {
      rows += generateTableRows(node.children, level + 1);
    }
  }
  return rows;
}