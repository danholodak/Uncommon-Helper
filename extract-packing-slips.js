const fs = require("fs");
const path = require("path");
const { PDFParse } = require("pdf-parse");

function cleanValue(value) {
  return value
    ?.replace(/&#160;/g, " ")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim() || null;
}

function splitBlock(text, startLabel, endLabel) {
  const start = text.indexOf(startLabel);
  if (start === -1) return [];

  const end = endLabel ? text.indexOf(endLabel, start + startLabel.length) : text.length;
  const block = text.slice(start + startLabel.length, end === -1 ? text.length : end);
  return block.split("\n").map(cleanValue).filter(Boolean);
}

function parsePerson(text, nameLabel, endLabel) {
  const lines = splitBlock(text, nameLabel, endLabel);
  if (!lines.length) return null;

  const phone = lines.find((line) => /^\d{10}$/.test(line.replace(/[^\d]/g, "")));
  const addressLines = lines.slice(1).filter((line) => line !== phone);

  return {
    name: lines[0],
    address: addressLines,
    phone: phone ? phone.replace(/[^\d]/g, "") : null,
  };
}

function parsePackingSlip(rawText) {
  const text = rawText.replace(/\r/g, "");

  const orderMatch = text.match(/ORDER #\s*(\S+).*?SHIPMENT ID #\s*ORDER DATE\s*\n([^\n]+)/s);
  const shipmentLine = orderMatch?.[2]?.trim().split(/\s+/) || [];

  const shipMatch = text.match(/SHIP METHOD\s+SHIP BY\s*\n([^\n]+)/);

  let shipMethod = null;
  let shipBy = null;
  if (shipMatch) {
    const shippingLine = cleanValue(shipMatch[1]);
    const dateMatch = shippingLine?.match(/^(.*?)(?:\s+(\d{1,2}\/\d{1,2}\/\d{4}))$/);
    shipMethod = cleanValue(dateMatch?.[1]);
    shipBy = cleanValue(dateMatch?.[2]);
  }

  const quantityMatch = text.match(/QTY\s+SKU #\s+ITEM DESCRIPTION\s+ADDITIONAL INFO\s*\n([^\n]+)/);
  let item = null;

  if (quantityMatch) {
    const itemLine = quantityMatch[1].trim().split(/\s+/);
    const quantity = itemLine.shift();
    const sku = itemLine.shift();
    const description = itemLine.join(" ");

    item = {
      quantity: quantity ? Number(quantity) : null,
      sku: sku || null,
      description: description || null,
      additionalInfo: {},
    };

    const itemLineEnd = text.indexOf(quantityMatch[1]);
    const sectionEnd = text.indexOf("uncommongoods.com", itemLineEnd);
    const itemSection = text.slice(itemLineEnd + quantityMatch[1].length,
      sectionEnd === -1 ? text.length : sectionEnd);

    for (const match of itemSection.matchAll(/(?:^|\n)\s*([^:\n]+?):\s*:\s*([^\n]+)/g)) {
      const key = cleanValue(match[1]);
      const value = cleanValue(match[2]);
      if (key && value) {
        item.additionalInfo[key] = value;
      }
    }

    const giftMatch = itemSection.match(/GIFT MESSAGE\s*\n([^\n]+)/);
    if (giftMatch) {
      item.giftMessage = cleanValue(giftMatch[1]);
    }
  }

  const careMatch = text.match(/CARE INSTRUCTIONS\s*\n([^\n]+)/);

  return {
    careInstructions: cleanValue(careMatch?.[1]),
    purchaser: parsePerson(text, "PURCHASER", "RECIPIENT"),
    recipient: parsePerson(text, "RECIPIENT", "ORDER #"),
    orderNumber: cleanValue(orderMatch?.[1]),
    shipmentId: cleanValue(shipmentLine[0]),
    orderDate: cleanValue(shipmentLine[1]),
    shipMethod: shipMethod,
    shipBy: shipBy,
    item,
    rawText: text.trim(),
  };
}

async function extractPdf(filePath) {
  const parser = new PDFParse({ data: fs.readFileSync(filePath) });

  try {
    const result = await parser.getText();
    return {
      sourceFile: path.basename(filePath),
      pageCount: result.total,
      slips: result.pages.map((page) => parsePackingSlip(page.text)),
    };
  } finally {
    await parser.destroy();
  }
}

async function main() {
  const inputFiles = process.argv.slice(2);

  if (!inputFiles.length) {
    console.error("Usage: node extract-packing-slips.js <pdf-file> [pdf-file...] [--out file.json]");
    process.exitCode = 1;
    return;
  }

  const outIndex = inputFiles.indexOf("--out");
  const outputPath = outIndex !== -1 ? inputFiles[outIndex + 1] : null;
  const pdfFiles = inputFiles.filter((file, index) => file !== "--out" && index !== outIndex + 1);

  const output = [];
  for (const pdfFile of pdfFiles) {
    output.push(await extractPdf(path.resolve(pdfFile)));
  }

  const value = output.length === 1 ? output[0] : output;

  if (outputPath) {
    fs.writeFileSync(path.resolve(outputPath), JSON.stringify(value, null, 2));
  }

  console.log(JSON.stringify(value, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { extractPdf, parsePackingSlip };
