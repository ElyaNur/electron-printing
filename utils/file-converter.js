const fs = require("fs");
const path = require("path");
const libre = require("libreoffice-convert");
const { promisify } = require("util");

// Convert the callback-based libre.convert to a Promise-based function
const libreConvert = promisify(libre.convert);

/**
 * Check if a file is a Microsoft Office document
 * @param {string} filePath - Path to the file
 * @returns {boolean} - True if the file is a Microsoft Office document
 */
function isOfficeDocument(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const officeExtensions = [
    ".doc",
    ".docx", // Word
    ".xls",
    ".xlsx", // Excel
    ".ppt",
    ".pptx", // PowerPoint
  ];

  return officeExtensions.includes(ext);
}

/**
 * Convert a Microsoft Office document to PDF
 * @param {string} inputPath - Path to the input file
 * @param {string} outputPath - Path to the output PDF file (optional)
 * @returns {Promise<string>} - Path to the converted PDF file
 */
async function convertToPdf(inputPath, outputPath = null) {
  // If the file is not an Office document, return the original path
  if (!isOfficeDocument(inputPath)) {
    return inputPath;
  }

  // If no output path is provided, create one in the same directory
  if (!outputPath) {
    const dir = path.dirname(inputPath);
    const filename = path.basename(inputPath, path.extname(inputPath));
    outputPath = path.join(dir, `${filename}.pdf`);
  }

  try {
    // Read the file
    const docxBuf = fs.readFileSync(inputPath);

    // Set the output format to PDF
    const outputFormat = ".pdf";

    // Convert the document
    const pdfBuf = await libreConvert(docxBuf, outputFormat, undefined);

    // Write the PDF to disk
    fs.writeFileSync(outputPath, pdfBuf);

    console.log(`Successfully converted ${inputPath} to ${outputPath}`);
    return outputPath;
  } catch (error) {
    console.error(`Error converting file to PDF: ${error.message}`);
    throw error;
  }
}

module.exports = {
  isOfficeDocument,
  convertToPdf,
};
