# Electron Printing Share

A cross-platform printing sharing application built with Electron that allows you to share printers across your network. This application consists of a server component (running on the computer with the physical printer) and a client component (running on computers that need to access the shared printer).

## Features

### Server Features

- Share local printers across your network
- Monitor connected clients
- Track print jobs
- Configure which printers are shared
- Adjust server network settings

### Client Features

- Connect to printer sharing servers
- View available shared printers
- Send documents to remote printers
- Configure print options (copies, orientation, color mode, paper size)
- Track your print jobs

## Installation

### Prerequisites

- Node.js (v14 or later)
- npm (v6 or later)

### Setup

1. Clone or download this repository
2. Install dependencies:
   ```
   npm install
   ```

## Usage

### Starting the Application

You can start the application in one of three ways:

1. **Main Interface** - Choose server or client mode:

   ```
   npm start
   ```

2. **Server Mode** - Start directly in server mode:

   ```
   npm run start:server
   ```

3. **Client Mode** - Start directly in client mode:
   ```
   npm run start:client
   ```

### Server Mode

1. Start the application in server mode
2. The server will automatically detect your local printers
3. Go to the Settings tab to select which printers you want to share
4. The server IP address and port will be displayed in the server info section
5. Share this information with client users who need to connect

### Client Mode

1. Start the application in client mode
2. Enter the server IP address and port
3. Enter a name for your client (defaults to your computer's hostname)
4. Click "Connect to Server"
5. Once connected, you can view available printers and send print jobs

## Printing a Document

1. In client mode, connect to a server
2. Go to the "Print Document" tab
3. Select a printer from the dropdown menu
4. Upload a document (supported formats: PDF, DOC, DOCX, TXT, PNG, JPG)
5. Configure print options as needed
6. Click "Print Document"

## Building for Distribution

To build the application for distribution:

```
npm run build
```

This will create distributable packages for your current platform in the `dist` directory.

## License

MIT
