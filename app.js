import * as pdfjsLib from "https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.149/build/pdf.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.149/build/pdf.worker.mjs";

const pdfInput = document.querySelector("#pdfInput");
const uploadPanel = document.querySelector("#uploadPanel");
const viewer = document.querySelector("#viewer");
const fieldsElement = document.querySelector("#fields");
const pagePosition = document.querySelector("#pagePosition");
const slipTitle = document.querySelector("#slipTitle");
const previousButton = document.querySelector("#previousButton");
const nextButton = document.querySelector("#nextButton");
const showCustomerButton = document.querySelector("#showCustomerButton");
const quantityWarning = document.querySelector("#quantityWarning");
const customerDialog = document.querySelector("#customerDialog");
const customerData = document.querySelector("#customerData");
const closeCustomerButton = document.querySelector("#closeCustomerButton");
const newPdfButton = document.querySelector("#newPdfButton");
const status = document.querySelector("#status");

let slips = [];
let currentPage = 0;

function cleanValue(value) {
  return value
    ?.replace(/&#160;/g, " ")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim() || "";
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
  return {
    name: lines[0],
    address: lines.slice(1).filter((line) => line !== phone),
    phone: phone ? phone.replace(/[^\d]/g, "") : null,
  };
}

function parsePackingSlip(text) {
  text = text.replace(/\r/g, "");

  const orderMatch = text.match(/ORDER #\s*(\S+).*?SHIPMENT ID #\s*ORDER DATE\s*\n([^\n]+)/s);
  const shipmentLine = cleanValue(orderMatch?.[2]).split(/\s+/);
  const shipMatch = text.match(/SHIP METHOD\s+SHIP BY\s*\n([^\n]+)/);
  const shippingLine = cleanValue(shipMatch?.[1]);
  const dateMatch = shippingLine.match(/^(.*?)(?:\s+(\d{1,2}\/\d{1,2}\/\d{4}))$/);

  const quantityMatch = text.match(/QTY\s+SKU #\s+ITEM DESCRIPTION\s+ADDITIONAL INFO\s*\n([^\n]+)/);
  let item = null;

  if (quantityMatch) {
    const itemParts = cleanValue(quantityMatch[1]).split(/\s+/);
    const quantity = itemParts.shift();
    const sku = itemParts.shift();

    item = {
      quantity: quantity ? Number(quantity) : null,
      sku: sku || null,
      description: itemParts.join(" ") || null,
      additionalInfo: {},
    };

    const itemLineEnd = text.indexOf(quantityMatch[1]);
    const sectionEnd = text.indexOf("uncommongoods.com", itemLineEnd);
    const itemSection = text.slice(
      itemLineEnd + quantityMatch[1].length,
      sectionEnd === -1 ? text.length : sectionEnd,
    );

    for (const match of itemSection.matchAll(/(?:^|\n)\s*([^:\n]+?):\s*:\s*([^\n]+)/g)) {
      const key = cleanValue(match[1]);
      const value = cleanValue(match[2]);
      if (key && value) item.additionalInfo[key] = value;
    }

    const giftMatch = itemSection.match(/GIFT MESSAGE\s*\n([^\n]+)/);
    if (giftMatch) item.giftMessage = cleanValue(giftMatch[1]);
  }

  const careMatch = text.match(/CARE INSTRUCTIONS\s*\n?(.+?)(?=\s+\d{6,}|\n\d{6,}|\nPURCHASER|\sPURCHASER)/);

  return {
    careInstructions: cleanValue(careMatch?.[1]) || null,
    purchaser: parsePerson(text, "PURCHASER", "RECIPIENT"),
    recipient: parsePerson(text, "RECIPIENT", "ORDER #"),
    orderNumber: cleanValue(orderMatch?.[1]) || null,
    shipmentId: shipmentLine[0] || null,
    orderDate: shipmentLine[1] || null,
    shipMethod: cleanValue(dateMatch?.[1]) || null,
    shipBy: cleanValue(dateMatch?.[2]) || null,
    item,
  };
}

async function extractPdf(file) {
  status.textContent = "Reading PDF…";
  const data = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const pages = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    let text = "";

    for (const item of content.items) {
      text += item.str;
      text += item.hasEOL ? "\n" : " ";
    }

    pages.push(parsePackingSlip(text));
  }

  return pages;
}

function personFields(person) {
  if (!person) return [];
  return [
    ["Name", person.name],
    ["Address", person.address.join("\n")],
    ["Phone", person.phone],
  ].filter(([, value]) => value);
}

function toKebabCase(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function getDisplayFields(slip) {
  const fields = [];
  const additionalInfo = Object.entries(slip.item?.additionalInfo || {});

  additionalInfo.slice(0, 2).forEach(([label, value]) => {
    fields.push([label, value]);
  });

  if (slip.item?.description) {
    const productName = slip.item.description
      .replace(/\bpersonalized\b\s*/i, "")
      .trim();
    const firstCustomText = additionalInfo[0]?.[1];

    if (firstCustomText) {
      const baseFileName = `${toKebabCase(productName)}-${toKebabCase(firstCustomText)}`;
      const quantity = Number(slip.item.quantity);

      fields.push(["File Name", baseFileName]);

      if (quantity !== 1) {
        for (let copyNumber = 2; copyNumber <= quantity; copyNumber++) {
          fields.push([`File Name ${copyNumber}`, `${baseFileName}-${copyNumber}`]);
        }
      }
    }
  }

  return fields.filter(([, value]) => value !== null && value !== undefined && value !== "");
}

async function copyText(text, button) {
  await navigator.clipboard.writeText(text);
  const original = button.textContent;
  button.textContent = "Copied";
  button.classList.add("copied");
  window.setTimeout(() => {
    button.textContent = original;
    button.classList.remove("copied");
  }, 1200);
}

function render() {
  const slip = slips[currentPage];
  if (!slip) return;

  pagePosition.textContent = `Page ${currentPage + 1} of ${slips.length}`;
  const orderNumber = slip.orderNumber ? `Order ${slip.orderNumber}` : "Packing Slip";
  const itemDescription = slip.item?.description ? ` — ${slip.item.description}` : "";
  slipTitle.textContent = `${orderNumber}${itemDescription}`;

  const quantity = Number(slip.item?.quantity);
  if (quantity !== 1) {
    quantityWarning.hidden = false;
    quantityWarning.textContent = `⚠ Quantity is ${quantity || "unknown"}. Check order before processing.`;
  } else {
    quantityWarning.hidden = true;
    quantityWarning.textContent = "";
  }

  previousButton.disabled = currentPage === 0;
  nextButton.disabled = currentPage === slips.length - 1;
  nextButton.textContent = currentPage === slips.length - 1 ? "Last page" : "Next →";

  fieldsElement.replaceChildren();
  for (const [label, value] of getDisplayFields(slip)) {
    const group = document.createElement("div");
    group.className = "field-group";

    if (["Address", "Purchaser Address", "Recipient Address", "Gift Message"].includes(label)) {
      group.classList.add("full-width");
    }

    const labelElement = document.createElement("span");
    labelElement.className = "field-label";
    labelElement.textContent = label;

    const row = document.createElement("div");
    row.className = "copy-row";

    const valueElement = document.createElement("div");
    valueElement.className = "field-value";
    valueElement.textContent = value;

    const copyButton = document.createElement("button");
    copyButton.className = "copy-button";
    copyButton.type = "button";
    copyButton.textContent = "Copy";
    copyButton.addEventListener("click", () => copyText(String(value), copyButton));

    row.append(valueElement, copyButton);
    group.append(labelElement, row);
    fieldsElement.append(group);
  }
}

pdfInput.addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;

  try {
    slips = await extractPdf(file);
    currentPage = 0;
    status.textContent = "";
    uploadPanel.hidden = true;
    viewer.hidden = false;
    render();
  } catch (error) {
    console.error(error);
    status.textContent = `Could not read this PDF: ${error.message}`;
  } finally {
    pdfInput.value = "";
  }
});

previousButton.addEventListener("click", () => {
  if (currentPage > 0) {
    currentPage--;
    render();
  }
});

nextButton.addEventListener("click", () => {
  if (currentPage < slips.length - 1) {
    currentPage++;
    render();
  }
});

showCustomerButton.addEventListener("click", () => {
  const slip = slips[currentPage];
  if (!slip) return;

  customerData.replaceChildren();

  for (const [sectionLabel, person] of [["Purchaser", slip.purchaser], ["Recipient", slip.recipient]]) {
    for (const [label, value] of personFields(person)) {
      const group = document.createElement("div");
      group.className = "field-group";

      const labelElement = document.createElement("span");
      labelElement.className = "field-label";
      labelElement.textContent = `${sectionLabel} ${label}`;

      const row = document.createElement("div");
      row.className = "copy-row";

      const valueElement = document.createElement("div");
      valueElement.className = "field-value";
      valueElement.textContent = value;

      const copyButton = document.createElement("button");
      copyButton.className = "copy-button";
      copyButton.type = "button";
      copyButton.textContent = "Copy";
      copyButton.addEventListener("click", () => copyText(String(value), copyButton));

      row.append(valueElement, copyButton);
      group.append(labelElement, row);
      customerData.append(group);
    }
  }

  customerDialog.showModal();
});

closeCustomerButton.addEventListener("click", () => {
  customerDialog.close();
});

newPdfButton.addEventListener("click", () => {
  slips = [];
  currentPage = 0;
  viewer.hidden = true;
  uploadPanel.hidden = false;
  status.textContent = "";
  pdfInput.click();
});
