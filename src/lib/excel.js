/**
 * Excel import/export for sheets.
 * Import: xlsx buffer -> Luckysheet JSON string (via luckyexcel).
 * Export: Luckysheet JSON string -> xlsx buffer (via ExcelJS).
 */

function importExcelToLuckysheetJson(buffer) {
  return new Promise((resolve, reject) => {
    let LuckyExcel;
    try {
      LuckyExcel = require('luckyexcel');
    } catch (e) {
      return reject(new Error('luckyexcel not installed. Run: npm install luckyexcel'));
    }
    LuckyExcel.transformExcelToLucky(buffer, (exportJson, luckysheetfile) => {
      if (!luckysheetfile || !Array.isArray(luckysheetfile)) {
        return reject(new Error('Invalid or empty Excel file'));
      }
      resolve(JSON.stringify(luckysheetfile));
    });
  });
}

async function exportLuckysheetJsonToExcelBuffer(contentStr, workbookName) {
  const ExcelJS = require('exceljs');
  let sheets;
  try {
    sheets = typeof contentStr === 'string' ? JSON.parse(contentStr) : contentStr;
  } catch (_) {
    throw new Error('Invalid sheet content');
  }
  if (!Array.isArray(sheets) || sheets.length === 0) {
    throw new Error('No sheet data');
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Private Web Sheets';
  workbook.created = new Date();

  for (let s = 0; s < sheets.length; s++) {
    const sheetDef = sheets[s];
    const name = (sheetDef.name || `Sheet${s + 1}`).toString().slice(0, 31);
    const worksheet = workbook.addWorksheet(name, { properties: {} });

    const celldata = sheetDef.celldata || sheetDef.data || [];
    if (Array.isArray(celldata)) {
      for (const cell of celldata) {
        const r = cell.r != null ? cell.r : cell.row;
        const c = cell.c != null ? cell.c : cell.column;
        if (r == null || c == null) continue;
        const row = worksheet.getRow(r + 1);
        const value = cell.v !== undefined ? cell.v : (cell.m !== undefined ? cell.m : null);
        if (value !== undefined && value !== null) row.getCell(c + 1).value = value;
      }
    }
    const rowObj = sheetDef.config?.rowlen || sheetDef.row || {};
    const colObj = sheetDef.config?.columnlen || sheetDef.column || {};
    if (Object.keys(rowObj).length) {
      for (const [idx, h] of Object.entries(rowObj)) {
        const r = parseInt(idx, 10) + 1;
        if (worksheet.getRow(r)) worksheet.getRow(r).height = Number(h) || 19;
      }
    }
    if (Object.keys(colObj).length) {
      for (const [idx, w] of Object.entries(colObj)) {
        const c = parseInt(idx, 10) + 1;
        worksheet.getColumn(c).width = Number(w) ? Math.min(Number(w) / 8, 50) : 10;
      }
    }
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

module.exports = {
  importExcelToLuckysheetJson,
  exportLuckysheetJsonToExcelBuffer,
};
