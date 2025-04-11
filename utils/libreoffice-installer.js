const path = require("path");
const fs = require("fs");
const os = require("os");
const { app } = require("electron");
const { execFile } = require("child_process");
const fetch = require("node-fetch");
const log = require("electron-log");

// LibreOffice installer configuration
const LIBREOFFICE_VERSION = "7.6.4"; // Latest stable version

// Platform-specific installer URLs
const INSTALLER_URLS = {
  win32: `https://download.documentfoundation.org/libreoffice/stable/${LIBREOFFICE_VERSION}/win/x86_64/LibreOffice_${LIBREOFFICE_VERSION}_Win_x64.msi`,
  darwin: `https://download.documentfoundation.org/libreoffice/stable/${LIBREOFFICE_VERSION}/mac/x86_64/LibreOffice_${LIBREOFFICE_VERSION}_MacOS_x86-64.dmg`,
  linux: `https://download.documentfoundation.org/libreoffice/stable/${LIBREOFFICE_VERSION}/deb/x86_64/LibreOffice_${LIBREOFFICE_VERSION}_Linux_x86-64_deb.tar.gz`,
};

// Platform-specific installer file extensions
const INSTALLER_EXTENSIONS = {
  win32: ".msi",
  darwin: ".dmg",
  linux: ".tar.gz",
};

class LibreOfficeInstaller {
  constructor() {
    this.platform = process.platform;
    this.installerPath = path.join(
      app.getPath("temp"),
      `LibreOffice_installer${INSTALLER_EXTENSIONS[this.platform]}`
    );
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
      const response = await fetch(INSTALLER_URLS[this.platform]);
      if (!response.ok) {
        throw new Error(`Failed to download installer: ${response.statusText}`);
      }

      const fileStream = fs.createWriteStream(this.installerPath);
      await new Promise((resolve, reject) => {
        response.body.pipe(fileStream);
        response.body.on("error", reject);
        fileStream.on("finish", resolve);
      });

      log.info("LibreOffice installer downloaded successfully");
      return this.installerPath;
    } catch (error) {
      log.error("Error downloading LibreOffice installer:", error);
      throw error;
    }
  }

  async install() {
    try {
      if (await this.isLibreOfficeInstalled()) {
        log.info("LibreOffice is already installed");
        return true;
      }

      // Download the installer if it doesn't exist
      if (!fs.existsSync(this.installerPath)) {
        await this.downloadInstaller();
      }

      // Run the installer based on platform
      log.info("Installing LibreOffice...");
      await new Promise((resolve, reject) => {
        let command, args;

        switch (this.platform) {
          case "win32":
            command = "msiexec";
            args = ["/i", this.installerPath, "/qn", "/norestart"];
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

        execFile(command, args, (error) => {
          if (error) {
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
      return true;
    } catch (error) {
      log.error("Error installing LibreOffice:", error);
      throw error;
    } finally {
      // Clean up the installer file
      if (fs.existsSync(this.installerPath)) {
        fs.unlinkSync(this.installerPath);
      }
    }
  }
}

module.exports = new LibreOfficeInstaller();
