const path = require("path");
const fs = require("fs");
const os = require("os");
const { app, BrowserWindow, ipcMain } = require("electron");
const { execFile } = require("child_process");
const fetch = require("node-fetch");
const log = require("electron-log");
const EventEmitter = require("events");

// LibreOffice installer configuration
const LIBREOFFICE_VERSION = "25.2.2"; // Latest stable version

// Platform-specific installer URLs
const INSTALLER_URLS = {
  win32: `https://download.documentfoundation.org/libreoffice/stable/${LIBREOFFICE_VERSION}/win/x86_64/LibreOffice_${LIBREOFFICE_VERSION}_Win_x86-64.msi`,
  darwin: `https://download.documentfoundation.org/libreoffice/stable/${LIBREOFFICE_VERSION}/mac/x86_64/LibreOffice_${LIBREOFFICE_VERSION}_MacOS_x86-64.dmg`,
  linux: `https://download.documentfoundation.org/libreoffice/stable/${LIBREOFFICE_VERSION}/deb/x86_64/LibreOffice_${LIBREOFFICE_VERSION}_Linux_x86-64_deb.tar.gz`,
};

// Platform-specific installer file extensions
const INSTALLER_EXTENSIONS = {
  win32: ".msi",
  darwin: ".dmg",
  linux: ".tar.gz",
};

class LibreOfficeInstaller extends EventEmitter {
  constructor() {
    super();
    this.platform = process.platform;
    this.installerPath = path.join(
      app.getPath("temp"),
      `LibreOffice_installer${INSTALLER_EXTENSIONS[this.platform]}`
    );
    this.progressWindow = null;
  }
  // Create a progress window that blocks user interaction
  createProgressWindow() {
    // If there's already a progress window, destroy it first
    if (this.progressWindow && !this.progressWindow.isDestroyed()) {
      this.progressWindow.close();
      this.progressWindow = null;
    }

    this.progressWindow = new BrowserWindow({
      width: 500,
      height: 250,
      resizable: false,
      minimizable: false,
      maximizable: false,
      closable: false,
      alwaysOnTop: true,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
      },
    });

    // Create a simple HTML content for the progress window
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>LibreOffice Installation</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            padding: 20px;
            background-color: #f5f5f5;
            color: #333;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 100vh;
            margin: 0;
            overflow: hidden;
          }
          h2 {
            margin-bottom: 20px;
          }
          .progress-container {
            width: 100%;
            max-width: 400px;
            margin-bottom: 20px;
          }
          progress {
            width: 100%;
            height: 20px;
          }
          .status {
            margin-top: 10px;
            text-align: center;
          }
        </style>
      </head>
      <body>
        <h2>Installing LibreOffice</h2>
        <div class="progress-container">
          <progress id="progress" value="0" max="100"></progress>
        </div>
        <div class="status" id="status">Preparing installation...</div>

        <script>
          const { ipcRenderer } = require('electron');
          
          // Listen for progress updates
          ipcRenderer.on('installation-progress', (event, data) => {
            const progressBar = document.getElementById('progress');
            const statusText = document.getElementById('status');
            
            progressBar.value = data.percent;
            statusText.textContent = data.message;
          });
        </script>
      </body>
      </html>
    `;

    // Write the HTML content to a temporary file
    const tempHtmlPath = path.join(
      app.getPath("temp"),
      "libreoffice-progress.html"
    );
    fs.writeFileSync(tempHtmlPath, htmlContent);

    // Load the HTML file
    this.progressWindow.loadFile(tempHtmlPath);

    // Set up IPC handlers for progress updates
    ipcMain.on("get-installation-progress", (event) => {
      event.reply("installation-progress", {
        percent: 0,
        message: "Preparing installation...",
      });
    });

    return this.progressWindow;
  }

  async isLibreOfficeInstalled() {
    try {
      let possiblePaths = [];

      switch (this.platform) {
        case "win32":
          const programFiles = process.env.PROGRAMFILES || "C:\\Program Files";
          possiblePaths = [
            path.join(programFiles, "LibreOffice"),
            path.join(programFiles, "LibreOffice 7"),
          ];
          break;
        case "darwin":
          possiblePaths = [
            "/Applications/LibreOffice.app",
            "/Applications/LibreOffice 7.app",
          ];
          break;
        case "linux":
          possiblePaths = [
            "/usr/bin/libreoffice",
            "/usr/lib/libreoffice",
            "/opt/libreoffice7.6",
          ];
          break;
        default:
          throw new Error(`Unsupported platform: ${this.platform}`);
      }

      for (const dirPath of possiblePaths) {
        if (fs.existsSync(dirPath)) {
          return true;
        }
      }
      return false;
    } catch (error) {
      log.error("Error checking LibreOffice installation:", error);
      return false;
    }
  }

  async downloadInstaller() {
    try {
      log.info("Downloading LibreOffice installer...");

      // Update progress window
      if (this.progressWindow) {
        this.progressWindow.webContents.send("installation-progress", {
          percent: 10,
          message: "Downloading LibreOffice installer...",
        });
      }

      const response = await fetch(INSTALLER_URLS[this.platform]);
      if (!response.ok) {
        throw new Error(`Failed to download installer: ${response.statusText}`);
      }

      // Get the total size for progress calculation
      const totalSize =
        parseInt(response.headers.get("content-length"), 10) || 0;
      let downloadedSize = 0;

      // Create a transform stream to track download progress
      const progressStream = new (require("stream").Transform)({
        transform: (chunk, encoding, callback) => {
          downloadedSize += chunk.length;
          const percent = totalSize
            ? Math.round((downloadedSize / totalSize) * 50)
            : 0; // Download is 50% of total progress

          // Emit progress event
          if (this.progressWindow) {
            this.progressWindow.webContents.send("installation-progress", {
              percent: 10 + percent,
              message: `Downloading: ${Math.round(
                (downloadedSize / totalSize) * 100
              )}%`,
            });
          }

          callback(null, chunk);
        },
      });

      const fileStream = fs.createWriteStream(this.installerPath);
      await new Promise((resolve, reject) => {
        response.body.pipe(progressStream).pipe(fileStream);
        response.body.on("error", reject);
        progressStream.on("error", reject);
        fileStream.on("finish", resolve);
      });

      log.info("LibreOffice installer downloaded successfully");

      // Update progress
      if (this.progressWindow) {
        this.progressWindow.webContents.send("installation-progress", {
          percent: 60,
          message: "Download complete. Preparing installation...",
        });
      }

      return this.installerPath;
    } catch (error) {
      log.error("Error downloading LibreOffice installer:", error);

      // Update progress window with error
      if (this.progressWindow) {
        this.progressWindow.webContents.send("installation-progress", {
          percent: 0,
          message: `Error downloading: ${error.message}`,
        });
      }

      throw error;
    }
  }

  async install() {
    try {
      // First check if LibreOffice is already installed
      if (await this.isLibreOfficeInstalled()) {
        log.info("LibreOffice is already installed");
        // Return true without showing any UI
        return true;
      }

      // Only create progress window if installation is needed
      this.createProgressWindow();

      // Download the installer if it doesn't exist
      if (!fs.existsSync(this.installerPath)) {
        await this.downloadInstaller();
      } else {
        // Skip download progress if installer already exists
        if (this.progressWindow) {
          this.progressWindow.webContents.send("installation-progress", {
            percent: 60,
            message: "Installer found. Preparing installation...",
          });
        }
      }

      // Run the installer based on platform
      log.info("Installing LibreOffice...");

      // Update progress
      if (this.progressWindow) {
        this.progressWindow.webContents.send("installation-progress", {
          percent: 70,
          message: "Installing LibreOffice...",
        });
      }

      await new Promise((resolve, reject) => {
        let command, args;

        switch (this.platform) {
          case "win32":
            command = "powershell.exe";
            args = [
              "-Command",
              `Start-Process msiexec.exe -Wait -ArgumentList '/i "${this.installerPath}" /qn /norestart' -Verb RunAs`,
            ];
            break;
          case "darwin":
            command = "hdiutil";
            args = ["attach", this.installerPath];
            break;
          case "linux":
            command = "sudo";
            if (fs.existsSync("/usr/bin/apt")) {
              args = ["apt", "install", "-y", "libreoffice"];
            } else if (fs.existsSync("/usr/bin/dnf")) {
              args = ["dnf", "install", "-y", "libreoffice"];
            } else if (fs.existsSync("/usr/bin/yum")) {
              args = ["yum", "install", "-y", "libreoffice"];
            } else {
              reject(new Error("No supported package manager found"));
              return;
            }
            break;
          default:
            reject(new Error(`Unsupported platform: ${this.platform}`));
            return;
        }

        execFile(command, args, (error, stdout, stderr) => {
          if (error) {
            log.error("Installation process error:", error);
            if (stdout) log.error("Installation stdout:", stdout);
            if (stderr) log.error("Installation stderr:", stderr);
            reject(error);
          } else {
            if (this.platform === "darwin") {
              // For macOS, we need to copy the app to Applications folder
              const dmgMountPoint = "/Volumes/LibreOffice";
              const appPath = path.join(dmgMountPoint, "LibreOffice.app");
              if (fs.existsSync(appPath)) {
                execFile("cp", ["-R", appPath, "/Applications/"], (cpError) => {
                  execFile("hdiutil", ["detach", dmgMountPoint], () => {
                    if (cpError) reject(cpError);
                    else resolve();
                  });
                });
              } else {
                reject(new Error("LibreOffice.app not found in mounted DMG"));
              }
            } else {
              resolve();
            }
          }
        });
      });

      log.info("LibreOffice installed successfully");

      // Update progress to 100% and close immediately
      if (this.progressWindow && !this.progressWindow.isDestroyed()) {
        this.progressWindow.webContents.send("installation-progress", {
          percent: 100,
          message: "LibreOffice installed successfully!",
        });
        this.closeProgressWindow();
      }

      return true;
    } catch (error) {
      log.error("Error installing LibreOffice:", error);

      // Update progress window with error and close immediately
      if (this.progressWindow && !this.progressWindow.isDestroyed()) {
        this.progressWindow.webContents.send("installation-progress", {
          percent: 0,
          message: `Installation error: ${error.message}`,
        });
        this.closeProgressWindow();
      }

      throw error;
    } finally {
      // Clean up the installer file
      if (fs.existsSync(this.installerPath)) {
        fs.unlinkSync(this.installerPath);
      }

      // Make sure progress window is closed if it still exists
      this.closeProgressWindow();
    }
  }

  // Helper method to properly close the progress window
  closeProgressWindow() {
    if (this.progressWindow && !this.progressWindow.isDestroyed()) {
      log.info("Closing progress window");
      try {
        this.progressWindow.destroy();
      } catch (err) {
        log.error("Error closing progress window:", err);
      } finally {
        this.progressWindow = null;
      }
    }
  }
}

module.exports = new LibreOfficeInstaller();
