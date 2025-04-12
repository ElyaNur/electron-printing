const fs = require("fs");
const path = require("path");
const { isOfficeDocument, convertToPdf } = require("./file-converter");

/**
 * Check if a file is previewable directly (without conversion)
 * @param {string} filePath - Path to the file
 * @returns {boolean} - True if the file can be previewed directly
 */
function isDirectlyPreviewable(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const previewableExtensions = [
    ".pdf", // PDF documents
    ".txt", // Text files
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".bmp",
    ".webp", // Images
  ];

  return previewableExtensions.includes(ext);
}

/**
 * Get the appropriate preview type for a file
 * @param {string} filePath - Path to the file
 * @returns {string} - Preview type ('pdf', 'image', 'text', or 'none')
 */
function getPreviewType(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === ".pdf") {
    return "pdf";
  } else if ([".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp"].includes(ext)) {
    return "image";
  } else if (ext === ".txt") {
    return "text";
  } else {
    return "none";
  }
}

/**
 * Generate a preview for a file
 * @param {string} filePath - Path to the file
 * @returns {Promise<Object>} - Preview information including type and data
 */
async function generatePreview(filePath) {
  try {
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    // For directly previewable files
    if (isDirectlyPreviewable(filePath)) {
      const previewType = getPreviewType(filePath);

      if (previewType === "text") {
        // For text files, read the content
        const content = fs.readFileSync(filePath, "utf8");
        return {
          type: "text",
          content: content,
          path: filePath,
        };
      } else {
        // For PDFs and images, just return the path
        return {
          type: previewType,
          path: filePath,
        };
      }
    }
    // For Office documents that need conversion
    else if (isOfficeDocument(filePath)) {
      // Return a pending state while conversion happens in the main process
      return {
        type: "converting",
        originalPath: filePath,
      };
    }
    // For unsupported files
    else {
      return {
        type: "unsupported",
        path: filePath,
      };
    }
  } catch (error) {
    console.error(`Error generating preview: ${error.message}`);
    return {
      type: "error",
      error: error.message,
    };
  }
}

/**
 * Update preview after conversion is complete
 * @param {string} originalPath - Original file path
 * @param {string} convertedPath - Converted PDF file path
 * @returns {Object} - Updated preview information
 */
function updatePreviewAfterConversion(originalPath, convertedPath) {
  return {
    type: "pdf",
    path: convertedPath,
    originalPath: originalPath,
  };
}

module.exports = {
  isDirectlyPreviewable,
  getPreviewType,
  generatePreview,
  updatePreviewAfterConversion,
};
