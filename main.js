const { app, BrowserWindow, ipcMain, dialog, Tray, Menu } = require("electron");
const path = require("path");
const os = require("os");
const fs = require("fs");
const express = require("express");
const http = require("http");
const socketIO = require("socket.io");
const multer = require("multer");
const Store = require("electron-store");
const { getPrinters } = require("pdf-to-printer");
const { print } = require("pdf-to-printer");
const FormData = require("form-data");
const fetch = require("node-fetch");
const { globalShortcut } = require("electron");
const log = require("electron-log");
const libreOfficeInstaller = require("./utils/libreoffice-installer");

app.whenReady().then(async () => {
  createTray();
  // Ensure LibreOffice is installed before proceeding
  // This will show a blocking progress UI to the user
  try {
    log.info("Starting LibreOffice installation check/process...");
    await libreOfficeInstaller.install();
    log.info("LibreOffice installation process completed");
  } catch (error) {
    log.error("Failed to install LibreOffice:", error);
    dialog.showErrorBox(
      "Installation Error",
      "Failed to install LibreOffice. Some document conversion features may not work."
    );
  }
  globalShortcut.register("CommandOrControl+Shift+I", () => {
    const focusedWindow = BrowserWindow.getFocusedWindow();
    if (focusedWindow) focusedWindow.webContents.toggleDevTools();
  });
});

// Configuration
const DEFAULT_PORT = 9631;
const store = new Store({
  schema: {
    serverPort: {
      type: "number",
      default: DEFAULT_PORT,
    },
    sharedPrinters: {
      type: "array",
      default: [],
    },
    recentJobs: {
      type: "array",
      default: [],
    },
    lastServerAddress: {
      type: "string",
      default: "",
    },
    lastClientName: {
      type: "string",
      default: os.hostname(),
    },
  },
});

// Application state
let mainWindow = null;
let serverWindow = null;
let clientWindow = null;
let expressApp = null;
let httpServer = null;
let io = null;
let isServer = false;
let isClient = false;
let connectedClients = [];
let clientSocket = null;
let tray = null;

// Create system tray
function createTray() {
  tray = new Tray(path.join(__dirname, "assets", "icon.png"));
  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Show",
      click: () => {
        if (mainWindow) mainWindow.show();
        if (serverWindow) serverWindow.show();
        if (clientWindow) clientWindow.show();
      },
    },
    {
      label: "Hide",
      click: () => {
        if (mainWindow) mainWindow.hide();
        if (serverWindow) serverWindow.hide();
        if (clientWindow) clientWindow.hide();
      },
    },
    { type: "separator" },
    { label: "Quit", click: () => app.quit() },
  ]);

  tray.setToolTip("Electron Printing");
  tray.setContextMenu(contextMenu);

  tray.on("double-click", () => {
    if (mainWindow) mainWindow.show();
    if (serverWindow) serverWindow.show();
    if (clientWindow) clientWindow.show();
  });
}

// Create main window
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    icon: path.join(__dirname, "assets", "icon.png"),
  });

  mainWindow.loadFile(path.join(__dirname, "index.html"));

  mainWindow.on("close", (event) => {
    event.preventDefault();
    mainWindow.hide();
  });
}

// Create server window
function createServerWindow() {
  serverWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    icon: path.join(__dirname, "assets", "icon.png"),
  });

  serverWindow.loadFile(path.join(__dirname, "server", "index.html"));

  serverWindow.on("close", (event) => {
    event.preventDefault();
    serverWindow.hide();
  });

  isServer = true;
  startServer();
}

// Create client window
function createClientWindow() {
  clientWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    icon: path.join(__dirname, "assets", "icon.png"),
  });

  clientWindow.loadFile(path.join(__dirname, "client", "index.html"));

  clientWindow.on("close", (event) => {
    event.preventDefault();
    clientWindow.hide();
  });

  isClient = true;
}

// Start the server
async function startServer() {
  const port = store.get("serverPort");

  // Create Express app
  expressApp = express();
  httpServer = http.createServer(expressApp);
  io = socketIO(httpServer);

  // Set up file upload storage
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      const uploadDir = path.join(
        app.getPath("temp"),
        "electron-printing-uploads"
      );
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }
      cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
      cb(null, `${Date.now()}-${file.originalname}`);
    },
  });

  const upload = multer({ storage });

  // Express routes
  expressApp.get("/api/printers", async (req, res) => {
    try {
      const allPrinters = await getPrinters();
      const sharedPrinters = store.get("sharedPrinters");

      const printers = allPrinters
        .filter((printer) => sharedPrinters.includes(printer.name))
        .map((printer) => ({
          name: printer.name,
          description: printer.description || "",
          status: "ready", // Default status
          shared: true,
        }));

      res.json(printers);
    } catch (error) {
      log.error("Error getting printers:", error);
      console.error("Error getting printers:", error);
      res.status(500).json({ error: "Failed to get printers" });
    }
  });

  expressApp.post("/api/print", upload.single("file"), async (req, res) => {
    try {
      const { printer, options } = req.body;
      const filePath = req.file.path;
      const sharedPrinters = store.get("sharedPrinters");

      // Check if printer is shared
      if (!sharedPrinters.includes(printer)) {
        return res.status(403).json({ error: "Printer is not shared" });
      }

      // Parse options
      const printOptions = {};
      if (options) {
        const parsedOptions = JSON.parse(options);
        if (parsedOptions.copies) printOptions.copies = parsedOptions.copies;
        if (parsedOptions.orientation)
          printOptions.orientation = parsedOptions.orientation;
        // Add other options as needed
      }

      // Print the document
      await print(filePath, {
        printer,
        ...printOptions,
      });

      // Add to recent jobs
      const newJob = {
        id: Date.now().toString(),
        documentName: req.file.originalname,
        printerName: printer,
        status: "completed",
        timestamp: Date.now(),
        clientName: req.body.clientName || "Unknown",
        pages: req.body.pages || "Unknown",
      };

      const recentJobs = store.get("recentJobs");
      recentJobs.unshift(newJob);
      if (recentJobs.length > 50) recentJobs.pop(); // Keep only the 50 most recent jobs
      store.set("recentJobs", recentJobs);

      // Notify server window about new job
      if (serverWindow) {
        serverWindow.webContents.send("print-jobs", recentJobs);
      }

      res.json({ success: true });
    } catch (error) {
      log.error("Error printing document:", error); // Log the error for debuggin
      console.error("Error printing document:", error);
      res.status(500).json({ error: "Failed to print document" });
    } finally {
      // Clean up the uploaded file
      if (req.file && req.file.path) {
        fs.unlink(req.file.path, (err) => {
          if (err) console.error("Error deleting temporary file:", err);
        });
      }
    }
  });

  // Socket.IO connection handling
  io.on("connection", (socket) => {
    console.log("Client connected:", socket.id);

    // Add client to connected clients list
    const clientInfo = {
      id: socket.id,
      name: socket.handshake.query.clientName || "Unknown Client",
      address: socket.handshake.address,
    };

    connectedClients.push(clientInfo);

    // Notify server window about new client
    if (serverWindow) {
      serverWindow.webContents.send(
        "connected-clients",
        connectedClients.length
      );
    }

    // Handle client disconnect
    socket.on("disconnect", () => {
      console.log("Client disconnected:", socket.id);

      // Remove client from connected clients list
      const index = connectedClients.findIndex(
        (client) => client.id === socket.id
      );
      if (index !== -1) {
        connectedClients.splice(index, 1);
      }

      // Notify server window about client disconnect
      if (serverWindow) {
        serverWindow.webContents.send(
          "connected-clients",
          connectedClients.length
        );
      }
    });
  });

  // Start the server
  try {
    await new Promise((resolve, reject) => {
      httpServer.listen(port, () => {
        console.log(`Server running on port ${port}`);
        resolve();
      });

      httpServer.on("error", (error) => {
        reject(error);
      });
    });

    // Notify server window that server is online
    if (serverWindow) {
      serverWindow.webContents.send("server-status", "online");
    }

    return true;
  } catch (error) {
    console.error("Error starting server:", error);

    // Notify server window that server failed to start
    if (serverWindow) {
      serverWindow.webContents.send("server-status", "offline");
    }

    return false;
  }
}

// Stop the server
function stopServer() {
  if (httpServer) {
    httpServer.close();
    httpServer = null;
  }

  io = null;
  expressApp = null;
  connectedClients = [];

  // Notify server window that server is offline
  if (serverWindow) {
    serverWindow.webContents.send("server-status", "offline");
    serverWindow.webContents.send("connected-clients", 0);
  }
}

// Connect to server
async function connectToServer(serverAddress, serverPort, clientName) {
  try {
    // Disconnect if already connected
    if (clientSocket) {
      clientSocket.disconnect();
    }

    // Connect to server
    clientSocket = require("socket.io-client")(
      `http://${serverAddress}:${serverPort}`,
      {
        query: {
          clientName,
        },
      }
    );

    // Handle connection events
    clientSocket.on("connect", () => {
      console.log("Connected to server");

      // Save last server address and client name
      store.set("lastServerAddress", serverAddress);
      store.set("lastClientName", clientName);

      // Notify client window that connection is established
      if (clientWindow) {
        clientWindow.webContents.send("connection-status", "connected");
      }

      // Get available printers
      fetchPrinters();
    });

    clientSocket.on("disconnect", () => {
      console.log("Disconnected from server");

      // Notify client window that connection is lost
      if (clientWindow) {
        clientWindow.webContents.send("connection-status", "disconnected");
      }
    });

    clientSocket.on("connect_error", (error) => {
      console.error("Connection error:", error);

      // Notify client window about connection error
      if (clientWindow) {
        clientWindow.webContents.send("connection-status", "disconnected");
        dialog.showErrorBox(
          "Connection Error",
          `Failed to connect to server: ${error.message}`
        );
      }
    });

    return true;
  } catch (error) {
    console.error("Error connecting to server:", error);

    // Notify client window about connection error
    if (clientWindow) {
      clientWindow.webContents.send("connection-status", "disconnected");
      dialog.showErrorBox(
        "Connection Error",
        `Failed to connect to server: ${error.message}`
      );
    }

    return false;
  }
}

// Disconnect from server
function disconnectFromServer() {
  try {
    // Check if socket exists and is connected before disconnecting
    if (clientSocket && clientSocket.connected) {
      clientSocket.disconnect();
    }
    clientSocket = null;

    // Only notify window if it exists and hasn't been destroyed
    if (clientWindow && !clientWindow.isDestroyed()) {
      clientWindow.webContents.send("connection-status", "disconnected");
    }
  } catch (error) {
    log.error("Error during disconnect:", error);
  }
}

// Fetch printers from server
async function fetchPrinters() {
  try {
    if (!clientSocket || !clientSocket.connected) {
      throw new Error("Not connected to server");
    }

    const serverAddress = store.get("lastServerAddress");
    const serverPort = store.get("serverPort");

    const response = await fetch(
      `http://${serverAddress}:${serverPort}/api/printers`
    );
    if (!response.ok) {
      throw new Error(
        `Server returned ${response.status} ${response.statusText}`
      );
    }

    const printers = await response.json();

    // Notify client window about available printers
    if (clientWindow) {
      clientWindow.webContents.send("printers-list", printers);
    }

    return printers;
  } catch (error) {
    console.error("Error fetching printers:", error);

    // Notify client window about error
    if (clientWindow) {
      clientWindow.webContents.send("printers-list", []);
    }

    return [];
  }
}

// Import file converter and preview utilities
const { isOfficeDocument, convertToPdf } = require("./utils/file-converter");
const {
  generatePreview,
  updatePreviewAfterConversion,
} = require("./utils/file-preview");

// Print document
async function printDocument(printer, filePath, options, clientName) {
  try {
    if (!clientSocket || !clientSocket.connected) {
      throw new Error("Not connected to server");
    }

    const serverAddress = store.get("lastServerAddress");
    const serverPort = store.get("serverPort");

    // Check if file is an Office document and convert to PDF if needed
    let fileToSend = filePath;
    if (isOfficeDocument(filePath)) {
      // Notify client window about conversion
      if (clientWindow) {
        clientWindow.webContents.send("conversion-status", {
          status: "converting",
          fileName: path.basename(filePath),
        });
      }

      try {
        fileToSend = await convertToPdf(filePath);

        // Notify client window about successful conversion
        if (clientWindow) {
          clientWindow.webContents.send("conversion-status", {
            status: "converted",
            fileName: path.basename(fileToSend),
          });

          // Send updated preview after conversion
          const previewData = updatePreviewAfterConversion(
            filePath,
            fileToSend
          );
          clientWindow.webContents.send("file-preview", previewData);
        }
      } catch (conversionError) {
        // Notify client window about conversion error
        if (clientWindow) {
          clientWindow.webContents.send("conversion-status", {
            status: "error",
            error: conversionError.message,
          });
        }
        throw new Error(
          `Failed to convert document: ${conversionError.message}`
        );
      }
    }

    // Create form data using form-data package
    const formData = new FormData();
    formData.append("file", fs.createReadStream(fileToSend));
    formData.append("printer", printer);
    formData.append("options", JSON.stringify(options));
    formData.append("clientName", clientName);

    // Send print request to server
    const response = await fetch(
      `http://${serverAddress}:${serverPort}/api/print`,
      {
        method: "POST",
        body: formData,
        headers: formData.getHeaders(),
      }
    );

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(
        errorData.error ||
          `Server returned ${response.status} ${response.statusText}`
      );
    }

    const result = await response.json();

    // Notify client window about print result
    if (clientWindow) {
      clientWindow.webContents.send("print-result", {
        success: true,
        printerName: printer,
      });
    }

    return true;
  } catch (error) {
    console.error("Error printing document:", error);

    // Notify client window about error
    if (clientWindow) {
      clientWindow.webContents.send("print-result", {
        success: false,
        error: error.message,
      });
    }

    return false;
  }
}

// Get local printers
async function getLocalPrinters() {
  try {
    const printers = await getPrinters();
    const sharedPrinters = store.get("sharedPrinters");

    return printers.map((printer) => ({
      name: printer.name,
      description: printer.description || "",
      status: "ready", // Default status
      shared: sharedPrinters.includes(printer.name),
    }));
  } catch (error) {
    console.error("Error getting local printers:", error);
    return [];
  }
}

// App events
app.on("ready", () => {
  // Check command line arguments
  const args = process.argv.slice(1);

  if (args.includes("--server")) {
    createServerWindow();
  } else if (args.includes("--client")) {
    createClientWindow();
  } else {
    createMainWindow();
  }
});

app.on("window-all-closed", (event) => {
  event.preventDefault();
});

app.on("before-quit", () => {
  // Clean up resources
  if (tray) {
    tray.destroy();
    tray = null;
  }
  if (serverWindow) {
    stopServer();
    serverWindow.destroy();
    serverWindow = null;
    isServer = false;
  }
  if (clientWindow) {
    disconnectFromServer();
    clientWindow.destroy();
    clientWindow = null;
    isClient = false;
  }
  if (mainWindow) {
    mainWindow.destroy();
    mainWindow = null;
  }
});

app.on("activate", () => {
  if (mainWindow === null && serverWindow === null && clientWindow === null) {
    createMainWindow();
  }
});

// IPC events

// Main window events
ipcMain.on("start-server", () => {
  if (mainWindow) {
    mainWindow.close();
    mainWindow = null;
  }
  createServerWindow();
});

ipcMain.on("start-client", () => {
  if (mainWindow) {
    mainWindow.close();
    mainWindow = null;
  }
  createClientWindow();
});

// Server events
ipcMain.on("refresh-printers", async (event) => {
  const printers = await getLocalPrinters();
  event.sender.send("printers-list", printers);
});

ipcMain.on("refresh-jobs", (event) => {
  const recentJobs = store.get("recentJobs");
  event.sender.send("print-jobs", recentJobs);
});

ipcMain.on("save-settings", (event, settings) => {
  // Save server port
  if (settings.port) {
    store.set("serverPort", parseInt(settings.port));
  }

  // Save shared printers
  if (settings.sharedPrinters) {
    store.set("sharedPrinters", settings.sharedPrinters);
  }

  // Restart server if it's running
  if (isServer) {
    stopServer();
    startServer();
  }

  // Notify server window that settings are saved
  event.sender.send("settings-saved");
});

// Client events
ipcMain.on(
  "connect-to-server",
  async (event, { serverAddress, serverPort, clientName }) => {
    const success = await connectToServer(
      serverAddress,
      serverPort,
      clientName
    );
    if (!success) {
      event.sender.send("connection-status", "disconnected");
    }
  }
);

ipcMain.on("disconnect-from-server", () => {
  disconnectFromServer();
});

ipcMain.on("print-document", async (event, { printer, filePath, options }) => {
  const clientName = store.get("lastClientName");
  await printDocument(printer, filePath, options, clientName);
});

// File preview handling
ipcMain.handle("generate-preview", async (event, filePath) => {
  try {
    // Generate preview data
    const previewData = await generatePreview(filePath);

    // If the file needs conversion, start the conversion process
    if (previewData.type === "converting") {
      // Notify client window about conversion
      if (clientWindow) {
        clientWindow.webContents.send("conversion-status", {
          status: "converting",
          fileName: path.basename(filePath),
        });
      }

      try {
        // Convert the document
        const convertedPath = await convertToPdf(filePath);

        // Notify client window about successful conversion
        if (clientWindow) {
          clientWindow.webContents.send("conversion-status", {
            status: "converted",
            fileName: path.basename(convertedPath),
          });
        }

        // Return updated preview data with the converted file
        return updatePreviewAfterConversion(filePath, convertedPath);
      } catch (conversionError) {
        // Notify client window about conversion error
        if (clientWindow) {
          clientWindow.webContents.send("conversion-status", {
            status: "error",
            error: conversionError.message,
          });
        }
        throw conversionError;
      }
    }

    return previewData;
  } catch (error) {
    console.error("Error generating preview:", error);
    return {
      type: "error",
      error: error.message,
    };
  }
});

ipcMain.handle("get-hostname", () => {
  return os.hostname();
});
