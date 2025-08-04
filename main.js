/*
* main.js - Electron Main Process Controller
* 
* Handles:
* - Application lifecycle (startup, window management, quit)
* - Main window creation with security settings
* - IPC communication handlers for image compression
* - Development tools and debugging setup
* - Cross-platform window behavior management
*/

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const ImageProcessor = require('./imageProcessor');

let mainWindow;

function createWindow() {
   mainWindow = new BrowserWindow({
       width: 900,
       height: 700,
       minWidth: 600,
       minHeight: 400,
       webPreferences: {
           nodeIntegration: false,
           contextIsolation: true,
           preload: path.join(__dirname, 'preload.js')
       },
       title: 'Elektron Fast Image Kompressor',
       show: false 
       
   });

   mainWindow.loadFile('index.html');
   
   // Pokaż okno gdy gotowe (smoother startup)
   mainWindow.once('ready-to-show', () => {
       mainWindow.show();
   });
   
   // DevTools tylko w development
   if (process.env.NODE_ENV === 'development' || process.argv.includes('--dev')) {
       mainWindow.webContents.openDevTools();
   }
}

app.whenReady().then(() => {
   createWindow();
});

app.on('window-all-closed', () => {
   if (process.platform !== 'darwin') {
       app.quit();
   }
});

app.on('activate', () => {
   if (BrowserWindow.getAllWindows().length === 0) {
       createWindow();
   }
});

// Handler kompresji obrazów
ipcMain.handle('compress-images', async (event, folderPath) => {
   const processor = new ImageProcessor();
   
   try {
       console.log('=== COMPRESSION DEBUG ===');
       console.log('Received folder path:', folderPath);
       console.log('Type of folderPath:', typeof folderPath);
       
       // Convert path if needed
       const fs = require('fs');
       const normalizedPath = require('path').resolve(folderPath);
       console.log('Normalized path:', normalizedPath);
       console.log('Normalized path exists?', fs.existsSync(normalizedPath));
       console.log('========================');
       
       if (!fs.existsSync(normalizedPath)) {
           throw new Error(`Selected folder does not exist: ${normalizedPath}`);
       }
       
       // Setup progress callback
       const progressCallback = (progressData) => {
           event.sender.send('compression-progress', progressData);
       };
       
       const result = await processor.processImages(normalizedPath, progressCallback);
       
       return {
           success: true,
           processedFiles: result.processedFiles,
           totalFiles: result.totalFiles,
           outputPath: result.outputPath,
           message: `Successfully compressed ${result.processedFiles} images!`,
           compressionStats: result.compressionStats
       };
       
   } catch (error) {
       console.error('Compression error:', error);
       return {
           success: false,
           error: error.message
       };
   }
});

// Handler wyboru folderu
ipcMain.handle('select-folder', async () => {
   try {
       const result = await dialog.showOpenDialog(mainWindow, {
           properties: ['openDirectory'],
           title: 'Select folder with images'
       });
       
       // Debug log
       console.log('=== FOLDER SELECTION DEBUG ===');
       console.log('Dialog result:', result);
       if (result.filePaths && result.filePaths.length > 0) {
           console.log('Selected path:', result.filePaths[0]);
           console.log('Path exists?', require('fs').existsSync(result.filePaths[0]));
       }
       console.log('==============================');
       
       return result;
   } catch (error) {
       console.error('Folder selection error:', error);
       return { canceled: true, error: error.message };
   }
});